import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { ModerationQueueResponse, SuggestionOutcome } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import {
  type Completion,
  type CompletionRequest,
  type Intelligence,
  LANGUAGE_MODEL,
} from '../intelligence/intelligence.port';
import { ModerationModule } from '../moderation/moderation.module';
import { readSuggestion } from './moderation-assist.service';

/**
 * Moderation assistance through the API (T-440 to T-442), with a scripted
 * model: a suggestion is a row beside the report that the queue carries with
 * the assistant's state; an answer that is not a suggestion is a rejected
 * row the queue never shows; only a moderator may ask; and the prompt is
 * the report's reason and the reporter's words and nothing about anybody.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe('readSuggestion', () => {
  it('accepts exactly a known category and some reasoning, and names why anything else is not a suggestion', () => {
    expect(readSuggestion('{"category":"spam","reasoning":"Link-dropping, twice."}')).toEqual({
      category: 'spam',
      reasoning: 'Link-dropping, twice.',
    });
    expect(
      readSuggestion('```json\n{"category":"no_action","reasoning":"A disagreement."}\n```'),
    ).toMatchObject({ category: 'no_action' });
    expect(readSuggestion('Spam, probably.')).toEqual({ rejection: 'the answer was not JSON' });
    expect(readSuggestion('{"category":"ban","reasoning":"x"}')).toMatchObject({
      rejection: expect.stringContaining('ban'),
    });
    expect(readSuggestion('{"category":"abuse","reasoning":"","extra":1}')).toMatchObject({
      rejection: expect.stringContaining('exactly'),
    });
    expect(readSuggestion('{"category":"abuse","reasoning":" "}')).toEqual({
      rejection: 'the reasoning was empty',
    });
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('moderation assistance', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let reportId = '';
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const moderator = `ma_${RUN}m`;
  const reporter = `ma_${RUN}r`;
  const subject = `ma_${RUN}s`;
  let script: Completion = {
    text: '',
    model: 'scripted-1',
    stop: 'end_turn',
    input_tokens: 10,
    output_tokens: 5,
  };
  const asked: CompletionRequest[] = [];
  const scripted: Intelligence = {
    model: {
      provider: 'scripted',
      model: 'scripted-1',
      complete: async (request) => {
        asked.push(request);
        return script;
      },
    },
  };

  async function register(username: string): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    cookies.set(username, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(username, rows[0]!.id);
  }

  const as = (username: string) => ({ cookie: `fmip_session=${cookies.get(username) ?? ''}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ModerationModule],
    })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(LANGUAGE_MODEL)
      .useValue(scripted)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    await register(moderator);
    await register(reporter);
    await register(subject);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'moderator', $1, 'the assistance test')`,
      [ids.get(moderator)],
    );
    const filed = await pool.query<{ id: string }>(
      `INSERT INTO report (reporter_id, subject_type, subject_id, reason, detail)
       VALUES ($1, 'member', $2, 'spam', 'Posted the same betting link in four threads.') RETURNING id`,
      [ids.get(reporter), ids.get(subject)],
    );
    reportId = filed.rows[0]!.id;
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM moderation_suggestion WHERE report_id = $1`, [reportId]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM report WHERE id = $1`, [reportId]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`ma_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  const suggest = async (username: string, id = reportId) => {
    const response = await app.inject({
      method: 'POST',
      url: `/admin/moderation/reports/${id}/suggest`,
      headers: as(username),
    });
    return { status: response.statusCode, body: response.json<SuggestionOutcome>() };
  };

  const queue = async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/moderation/queue',
      headers: as(moderator),
    });
    return response.json<ModerationQueueResponse>();
  };

  it('lets only a moderator ask, and 404s a report that is not one', async () => {
    expect((await suggest(reporter)).status).toBe(403);
    const guest = await app.inject({
      method: 'POST',
      url: `/admin/moderation/reports/${reportId}/suggest`,
    });
    expect(guest.statusCode).toBe(401);
    expect((await suggest(moderator, '00000000-0000-4000-8000-00000000dead')).status).toBe(404);
  });

  it('shows the queue with the assistant present and no suggestion yet, then the suggestion beside the report', async () => {
    const before = await queue();
    expect(before.assistant).toEqual({
      state: 'configured',
      provider: 'scripted',
      model: 'scripted-1',
    });
    const mine = before.subjects.find((s) => s.username === subject);
    expect(mine?.reports[0]?.suggestion).toBeNull();

    script = {
      ...script,
      text: '{"category":"spam","reasoning":"The same link in four threads is link-dropping."}',
      stop: 'end_turn',
    };
    const outcome = await suggest(moderator);
    expect(outcome.status).toBe(201);
    expect(outcome.body).toEqual({ outcome: 'published', version_number: 1, rejection: null });
    // What the assistant saw: the reason and the reporter's words, nothing about anybody (T-442).
    const request = asked[asked.length - 1]!;
    expect(JSON.parse(request.prompt)).toEqual({
      reason: 'spam',
      detail: 'Posted the same betting link in four threads.',
    });
    expect(request.prompt).not.toContain(subject);
    expect(request.prompt).not.toContain(reporter);
    expect(request.system).toContain('Impersonation');

    const after = await queue();
    const report = after.subjects.find((s) => s.username === subject)?.reports[0];
    expect(report?.suggestion).toMatchObject({
      category: 'spam',
      reasoning: 'The same link in four threads is link-dropping.',
      model: 'scripted-1',
      prompt_version: 'moderation-assist@1',
      version_number: 1,
    });
  });

  it('keeps an answer that is not a suggestion as a rejected version the queue never shows', async () => {
    script = { ...script, text: 'Ban them.', stop: 'end_turn' };
    expect((await suggest(moderator)).body).toMatchObject({
      outcome: 'rejected',
      version_number: 2,
      rejection: 'the answer was not JSON',
    });
    script = { ...script, text: '', stop: 'refusal' };
    expect((await suggest(moderator)).body).toMatchObject({
      outcome: 'rejected',
      version_number: 3,
      rejection: 'the model refused',
    });
    const report = (await queue()).subjects.find((s) => s.username === subject)?.reports[0];
    expect(report?.suggestion?.version_number).toBe(1);
    await expect(
      pool.query(`UPDATE moderation_suggestion SET category = 'abuse' WHERE report_id = $1`, [
        reportId,
      ]),
    ).rejects.toThrow(/immutable/);
  });
});
