import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { BriefingOutcome, BriefingResponse } from '@fmip/contracts';
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
import { BriefingsModule } from './briefings.module';

/**
 * Briefings through the API (T-430, T-431), with a scripted model: a member
 * who follows a team with a match in the window gets a document with that
 * match on its day; a briefing that names it is published; one that reads
 * more into the feed than it carries -- a paragraph about nobody, a number
 * from nowhere -- is a rejected version the page never shows; the reasons
 * for having none are sentences; and a guest has no briefing to ask for.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const HOME = randomUUID();
const AWAY = randomUUID();
const MATCH = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('briefings', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const follower = `br_${RUN}f`;
  const nobody = `br_${RUN}n`;
  const home = `Briefton ${RUN}`;
  const away = `Digestham ${RUN}`;
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

  const current = async (username: string) => {
    const response = await app.inject({
      method: 'GET',
      url: '/me/briefing',
      headers: as(username),
    });
    return { status: response.statusCode, body: response.json<BriefingResponse>() };
  };

  const write = async (username: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/me/briefing',
      headers: as(username),
    });
    return { status: response.statusCode, body: response.json<BriefingOutcome>() };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, BriefingsModule],
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
    await register(follower);
    await register(nobody);
    await pool.query(
      `INSERT INTO team (id, country_id, name, short_name, kind, gender)
       VALUES ($1, $3, $4, 'BRF', 'club', 'men'), ($2, $3, $5, 'DGH', 'club', 'men')`,
      [HOME, AWAY, ENGLAND, home, away],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday 25', now() + interval '12 hours', 'scheduled')`,
      [MATCH, PL_2025, REGULAR_SEASON],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [MATCH, HOME, AWAY],
    );
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id, favourite) VALUES ($1, 'team', $2, true)`,
      [ids.get(follower), HOME],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM member_briefing WHERE user_id = ANY($1::uuid[])`, [
        [ids.get(follower), ids.get(nobody)],
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [MATCH]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, AWAY]]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`br_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('documents the feed by day and says why there is no prose yet, and a guest has no briefing', async () => {
    const { status, body } = await current(follower);
    expect(status).toBe(200);
    expect(body.digest.days).toHaveLength(1);
    expect(body.digest.days[0]?.items.map((i) => i.kind)).toEqual(['fixture']);
    expect(body.prose).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    expect(body.reason).toBe('not_written');
    expect(body.versions).toBe(0);
    expect((await current(nobody)).body.reason).toBe('nothing_to_brief');
    expect((await write(nobody)).body).toEqual({ outcome: 'nothing_to_brief' });
    const guest = await app.inject({ method: 'GET', url: '/me/briefing' });
    expect(guest.statusCode).toBe(401);
  });

  it('publishes a briefing that stays inside the feed, with the document as the whole prompt', async () => {
    script = {
      ...script,
      text: `${home} play ${away} tomorrow, the one match around what you follow this week.`,
      stop: 'end_turn',
    };
    const outcome = await write(follower);
    expect(outcome.status).toBe(201);
    expect(outcome.body).toEqual({ outcome: 'published', version_number: 1, rejection: null });
    const request = asked[asked.length - 1]!;
    const document = JSON.parse(request.prompt) as { days: { items: { kind: string }[] }[] };
    expect(document.days[0]?.items[0]?.kind).toBe('fixture');
    expect(request.system).toContain('Every paragraph must be about items in the document');

    const shown = await current(follower);
    expect(shown.body.prose.coverage).toBe('available');
    expect(shown.body.prose.data).toMatchObject({
      text: `${home} play ${away} tomorrow, the one match around what you follow this week.`,
      model: 'scripted-1',
      prompt_version: 'briefing@1',
      version_number: 1,
    });
    expect(shown.body.reason).toBeNull();
  });

  it('rejects a paragraph that points at nothing in the feed and a number from nowhere, and keeps showing the published one', async () => {
    script = {
      ...script,
      text: `${home} play ${away} tomorrow.\n\nElsewhere, the title race tightened after a dramatic weekend.`,
      stop: 'end_turn',
    };
    const wandering = await write(follower);
    expect(wandering.body).toMatchObject({
      outcome: 'rejected',
      version_number: 2,
      rejection: expect.stringContaining('points at nothing in the feed'),
    });
    script = { ...script, text: `${home} have won 7 of their last games.`, stop: 'end_turn' };
    expect((await write(follower)).body).toMatchObject({
      outcome: 'rejected',
      version_number: 3,
      rejection: 'number not in the feed: 7',
    });
    script = { ...script, text: '', stop: 'refusal' };
    expect((await write(follower)).body).toMatchObject({
      outcome: 'rejected',
      version_number: 4,
      rejection: 'the model refused',
    });
    const shown = await current(follower);
    expect(shown.body.prose.data?.version_number).toBe(1);
    expect(shown.body.versions).toBe(4);
    await expect(
      pool.query(`UPDATE member_briefing SET text = 'edited' WHERE user_id = $1`, [
        ids.get(follower),
      ]),
    ).rejects.toThrow(/immutable/);
  });
});
