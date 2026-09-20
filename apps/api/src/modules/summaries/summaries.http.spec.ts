import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { MatchSummaryOutcome, MatchSummaryResponse } from '@fmip/contracts';
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
import { SummariesModule } from './summaries.module';

/**
 * Match summaries through the API (T-412, T-413), with a scripted model: a
 * finished match gets a version when the answer names only what the record
 * holds; a plausible name the record lacks is a rejected version the page
 * never shows; a refusal is a rejected version with its reason; a match that
 * is not over gets nothing; an editor's request is an audit row; and the
 * reader's endpoint says which of these it is.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const HOME = randomUUID();
const AWAY = randomUUID();
const MATCH = randomUUID();
const UPCOMING = randomUUID();
/** Finished, with a score and nothing else held: no summary is written from it (T-412). */
const THIN = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

/** The next answer the scripted model gives; tests set it before each call. */
let script: Completion = {
  text: '',
  model: 'scripted-1',
  stop: 'end_turn',
  input_tokens: 100,
  output_tokens: 20,
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('match summaries', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const editor = `sm_${RUN}e`;
  const member = `sm_${RUN}m`;
  const home = `Newsville ${RUN}`;
  const away = `Quietford ${RUN}`;

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

  const current = async (id: string) => {
    const response = await app.inject({ method: 'GET', url: `/fixtures/${id}/summary` });
    return { status: response.statusCode, body: response.json<MatchSummaryResponse>() };
  };

  const generate = async (id: string, reason: string, username = editor) => {
    const response = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${id}/summary`,
      headers: as(username),
      payload: { reason },
    });
    return { status: response.statusCode, body: response.json<MatchSummaryOutcome>() };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, SummariesModule],
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

    await register(editor);
    await register(member);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the summaries test')`,
      [ids.get(editor)],
    );
    await pool.query(
      `INSERT INTO team (id, country_id, name, short_name, kind, gender)
       VALUES ($1, $3, $4, 'NWV', 'club', 'men'), ($2, $3, $5, 'QTF', 'club', 'men')`,
      [HOME, AWAY, ENGLAND, home, away],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $3, $4, 'Matchday 23', now() - interval '2 hours', 'finished'),
              ($2, $3, $4, 'Matchday 24', now() + interval '5 days', 'scheduled'),
              ($5, $3, $4, 'Matchday 22', now() - interval '3 hours', 'finished')`,
      [MATCH, UPCOMING, PL_2025, REGULAR_SEASON, THIN],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away'), ($4, $2, 'home'), ($4, $3, 'away'),
              ($5, $2, 'home'), ($5, $3, 'away')`,
      [MATCH, HOME, AWAY, UPCOMING, THIN],
    );
    // MATCH holds one statistic, so its record is more than the score; THIN holds nothing else.
    await pool.query(
      `INSERT INTO fixture_stat (participant_id, metric, value)
       SELECT id, 'shots', 9 FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'`,
      [MATCH],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      // Summaries and audit rows are immutable by design; a test's own rows go with the triggers off.
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM match_summary WHERE fixture_id = ANY($1::uuid[])`, [
        [MATCH, UPCOMING, THIN],
      ]);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [
        [ids.get(editor), ids.get(member)],
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[MATCH, UPCOMING, THIN]]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, AWAY]]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`sm_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('says a finished match has no summary yet, a scheduled one is not over, and an unknown id is not a match', async () => {
    const before = await current(MATCH);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      fixture_id: MATCH,
      summary: { coverage: 'not_supplied', data: null },
      reason: 'not_generated',
      versions: 0,
    });
    expect((await current(UPCOMING)).body.reason).toBe('not_finished');
    expect((await current(randomUUID())).status).toBe(404);
    expect((await current('not-a-match')).status).toBe(404);
  });

  it('lets only an editor ask, insists on a reason, and refuses a match that is not over', async () => {
    const guest = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${MATCH}/summary`,
      payload: { reason: 'x' },
    });
    expect(guest.statusCode).toBe(401);
    expect((await generate(MATCH, 'x', member)).status).toBe(403);
    expect((await generate(MATCH, '   ')).status).toBe(400);
    expect((await generate(UPCOMING, 'first look')).body).toEqual({ outcome: 'not_finished' });
    expect((await generate(randomUUID(), 'first look')).status).toBe(404);
  });

  it('publishes an answer that names only what the record holds, with the facts as the prompt and an audit row', async () => {
    script = {
      ...script,
      text: `${home} and ${away} drew. Neither side scored.`,
      stop: 'end_turn',
    };
    const outcome = await generate(MATCH, 'first summary');
    expect(outcome.status).toBe(201);
    expect(outcome.body).toEqual({ outcome: 'published', version_number: 1, rejection: null });
    // The prompt is the facts document and nothing else; the standing instruction is separate.
    const request = asked[asked.length - 1]!;
    const facts = JSON.parse(request.prompt) as {
      home: { name: string };
      match: { status: string };
    };
    expect(facts.home.name).toBe(home);
    expect(facts.match.status).toBe('finished');
    expect(request.system).toContain('Use only what the record says');

    const shown = await current(MATCH);
    expect(shown.body.summary.coverage).toBe('available');
    expect(shown.body.summary.data).toMatchObject({
      text: `${home} and ${away} drew. Neither side scored.`,
      language: 'en',
      model: 'scripted-1',
      prompt_version: 'match-summary@2',
      version_number: 1,
      grounded_on: { timeline: 'not_supplied', statistics: 'limited' },
    });
    expect(shown.body.versions).toBe(1);
    const audit = await pool.query<{ action: string; reason: string }>(
      `SELECT action, reason FROM audit_log WHERE target_type = 'fixture' AND target_id = $1`,
      [MATCH],
    );
    expect(audit.rows).toEqual([{ action: 'summary.generate', reason: 'first summary' }]);
  });

  it('rejects a plausible name the record lacks, keeps the version, and goes on showing the published one', async () => {
    script = {
      ...script,
      text: `${home} won late through a Darwin Nunez header.`,
      stop: 'end_turn',
    };
    const outcome = await generate(MATCH, 'try again');
    expect(outcome.body).toEqual({
      outcome: 'rejected',
      version_number: 2,
      rejection: 'name not in the record: Darwin Nunez',
    });
    const shown = await current(MATCH);
    expect(shown.body.summary.data?.version_number).toBe(1);
    expect(shown.body.versions).toBe(2);
  });

  it('records a refusal and a truncation as rejected versions with their reasons, never as text', async () => {
    script = { ...script, text: '', stop: 'refusal' };
    expect((await generate(MATCH, 'refused')).body).toMatchObject({
      outcome: 'rejected',
      rejection: 'the model refused',
    });
    script = { ...script, text: 'The match', stop: 'max_tokens' };
    expect((await generate(MATCH, 'cut')).body).toMatchObject({
      outcome: 'rejected',
      rejection: 'the answer was cut off',
    });
    const rows = await pool.query<{ state: string; text: string | null }>(
      `SELECT state, text FROM match_summary WHERE fixture_id = $1 ORDER BY version_number`,
      [MATCH],
    );
    expect(rows.rows.map((r) => r.state)).toEqual([
      'published',
      'rejected',
      'rejected',
      'rejected',
    ]);
    // Immutable: nothing rewrites a version.
    await expect(
      pool.query(`UPDATE match_summary SET text = 'edited' WHERE fixture_id = $1`, [MATCH]),
    ).rejects.toThrow(/immutable/);
  });

  it('stops showing a published summary once a later version says the record cannot carry one', async () => {
    // The state a real deployment reaches: a summary published under an older
    // prompt, then the record re-examined and found to hold only the score.
    // The published text was written from that same record, so it goes too.
    const before = await current(MATCH);
    expect(before.body.summary.coverage).toBe('available');
    const published = before.body.summary.data?.text ?? '';
    expect(published).not.toBe('');

    await pool.query(
      `INSERT INTO match_summary
         (fixture_id, version_number, state, rejection, facts, facts_version, prompt_version, model)
       VALUES ($1, (SELECT max(version_number) + 1 FROM match_summary WHERE fixture_id = $1),
               'skipped', 'the record holds only the score', '{}'::jsonb, 'x', 'match-summary@2', 'test')`,
      [MATCH],
    );

    const after = await current(MATCH);
    expect(after.body.summary.coverage).toBe('not_supplied');
    expect(after.body.summary.data).toBeNull();
    expect(after.body.reason).toBe('thin_record');
    // The version is kept, never deleted: the count still climbs.
    expect(after.body.versions).toBe(before.body.versions + 1);

    // A rejected draft written after the verdict does not bring the old text
    // back. The record has not changed; one more bad draft says nothing about
    // it. The verdict stands until something is published from it again.
    await pool.query(
      `INSERT INTO match_summary
         (fixture_id, version_number, state, rejection, facts, facts_version, prompt_version, model)
       VALUES ($1, (SELECT max(version_number) + 1 FROM match_summary WHERE fixture_id = $1),
               'rejected', 'name not in the record: Someone', '{}'::jsonb, 'x', 'match-summary@2', 'test')`,
      [MATCH],
    );
    const later = await current(MATCH);
    expect(later.body.summary.coverage).toBe('not_supplied');
    expect(later.body.reason).toBe('thin_record');

    // Published again from the same record, through the same route as any
    // other summary, and the reader has one once more -- the new text, not the
    // old.
    script = { ...script, text: `${home} and ${away} drew again.`, stop: 'end_turn' };
    expect((await generate(MATCH, 'after the verdict')).body).toMatchObject({
      outcome: 'published',
    });
    const republished = await current(MATCH);
    expect(republished.body.summary.coverage).toBe('available');
    expect(republished.body.summary.data?.text).toBe(`${home} and ${away} drew again.`);
    expect(republished.body.summary.data?.text).not.toBe(published);
  });

  it('writes nothing from a record that holds only the score, says so, and does not ask the model again', async () => {
    const before = asked.length;
    const outcome = await generate(THIN, 'try anyway');
    expect([200, 201]).toContain(outcome.status);
    expect(outcome.body).toEqual({ outcome: 'thin_record' });
    expect(asked.length).toBe(before);
    const shown = await current(THIN);
    expect(shown.body.summary.coverage).toBe('not_supplied');
    expect(shown.body.reason).toBe('thin_record');
    expect(shown.body.versions).toBe(1);
    // Asked again: the decision stands as the one row, not a second.
    expect((await generate(THIN, 'again')).body).toEqual({ outcome: 'thin_record' });
    expect((await current(THIN)).body.versions).toBe(1);
    const { rows } = await pool.query<{ state: string; rejection: string }>(
      `SELECT state, rejection FROM match_summary WHERE fixture_id = $1`,
      [THIN],
    );
    expect(rows).toEqual([{ state: 'skipped', rejection: 'the record holds only the score' }]);
  });
});
