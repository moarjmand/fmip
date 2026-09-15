import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  CommunityAnalysesResponse,
  CommunityAnalysisWorkspace,
  CommunitySubmission,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { AnalysisModule } from './analysis.module';

/**
 * The analysis workflow over HTTP (T-261).
 *
 * The acceptance criterion is **every transition is audited and every published
 * version is immutable**, so these do not stop at status codes: each decision is
 * followed by a read of `audit_log`, and the immutability is checked against the
 * table rather than against the absence of an endpoint.
 *
 * The other half is the gate. `editor` is a different role from `moderator` on
 * purpose, and a moderator is refused here — which is the kind of thing a
 * reasonable refactor "fixes" by reusing a role that already exists.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const DRAFT = {
  predicted_outcome: 'home',
  predicted_home: null,
  predicted_away: null,
  confidence: 4,
  reasoning: 'The visitors have not kept a clean sheet away since August.',
  lineup_impact: null,
  key_players: null,
  form_and_context: null,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the analysis workflow', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const analyst = `an${RUN}a`;
  const editor = `an${RUN}e`;
  const moderator = `an${RUN}m`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const teams = [randomUUID(), randomUUID()];
  const fixtures: string[] = [];
  let match = '';

  const as = (who?: string) =>
    who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
  const get = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: as(who) });
  const send = (method: 'POST' | 'PUT', url: string, payload: unknown, who?: string) =>
    app.inject({
      method,
      url,
      payload: payload as Record<string, unknown>,
      headers: as(who),
    });

  const workspace = (fixtureId = match, who = analyst) =>
    get(`/me/analyses/${fixtureId}`, who).then((r) => r.json() as CommunityAnalysisWorkspace);

  const auditFor = (analysisId: string) =>
    pool
      .query<{ action: string; reason: string; actor: string; target_type: string }>(
        `SELECT a.action, a.reason, a.target_type, actor.username AS actor
             FROM audit_log a JOIN user_account actor ON actor.id = a.actor_id
            WHERE a.target_id = $1 ORDER BY a.created_at`,
        [analysisId],
      )
      .then(({ rows }) => rows);

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
    ids.set(username, rows[0]?.id ?? '');
  }

  async function fixture(kickoff = `now() + interval '2 days'`): Promise<string> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', ${kickoff}, 'scheduled')`,
      [id, PL_2025, REGULAR_SEASON],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, teams[0], teams[1]],
    );
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AnalysisModule],
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
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const username of [analyst, editor, moderator]) await register(username);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
         VALUES ($1, 'editor', $1, 'the analysis workflow test'),
                ($2, 'moderator', $2, 'the analysis workflow test')`,
      [ids.get(editor), ids.get(moderator)],
    );
    for (const [index, id] of teams.entries()) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, short_name, kind, gender)
           VALUES ($1, $2, $3, $4, 'club', 'men')`,
        [id, ENGLAND, `Workflow Team ${index}${RUN}`, `WT${index}`],
      );
    }
    await pool.query(
      `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, 'the analysis workflow test', 'contributor-rules@1.0.0', now())`,
      [ids.get(analyst), ids.get(editor)],
    );
    match = await fixture();
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `DELETE FROM community_analysis_version WHERE analysis_id IN
             (SELECT id FROM community_analysis WHERE author_id = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(
        `DELETE FROM community_analysis_review WHERE reviewer_id = ANY($1::uuid[])`,
        [everyone],
      );
      await client.query(
        `DELETE FROM community_analysis_submission WHERE analysis_id IN
             (SELECT id FROM community_analysis WHERE author_id = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(`DELETE FROM community_analysis WHERE author_id = ANY($1::uuid[])`, [
        everyone,
      ]);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
        everyone,
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
      fixtures,
    ]);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.end();
    await app.close();
  });

  describe('writing needs a grant, and a reason', () => {
    it('refuses a member nobody approved', async () => {
      const response = await send('PUT', `/me/analyses/${match}`, DRAFT, moderator);
      expect(response.statusCode).toBe(400);
      expect((response.json() as { message: string }).message).toMatch(/contributor grant/i);
    });

    it('refuses an analysis with no reasoning, naming every bad field at once', async () => {
      const response = await send(
        'PUT',
        `/me/analyses/${match}`,
        { ...DRAFT, reasoning: '   ', confidence: 9, predicted_outcome: 'maybe' },
        analyst,
      );
      expect(response.statusCode).toBe(400);
      const body = response.json() as { fields: Record<string, string> };
      // All three at once, so an analyst fixes one thing and not four.
      expect(Object.keys(body.fields).sort()).toEqual([
        'confidence',
        'predicted_outcome',
        'reasoning',
      ]);
      expect(body.fields.reasoning).toMatch(/is a prediction/i);
    });

    it('saves a draft and reads it back', async () => {
      expect((await send('PUT', `/me/analyses/${match}`, DRAFT, analyst)).statusCode).toBe(204);
      const mine = await workspace();
      expect(mine.state).toBe('draft');
      expect(mine.draft?.reasoning).toBe(DRAFT.reasoning);
      expect(mine.submissions).toEqual([]);
    });

    it('replaces the draft rather than keeping a history of half-finished thoughts', async () => {
      await send('PUT', `/me/analyses/${match}`, { ...DRAFT, confidence: 2 }, analyst);
      expect((await workspace()).draft?.confidence).toBe(2);
    });
  });

  describe('review is the editor role, not the moderator one', () => {
    it('refuses a moderator, and an analyst, and a guest', async () => {
      expect((await get('/admin/analysis-reviews')).statusCode).toBe(401);
      expect((await get('/admin/analysis-reviews', moderator)).statusCode).toBe(403);
      expect((await get('/admin/analysis-reviews', analyst)).statusCode).toBe(403);
    });

    it('admits an editor', async () => {
      expect((await get('/admin/analysis-reviews', editor)).statusCode).toBe(200);
    });
  });

  describe('draft, submit, changes, resubmit, approve, publish', () => {
    let firstSubmission = '';
    let analysisId = '';

    it('submits what the draft says, and nothing more', async () => {
      expect((await send('POST', `/me/analyses/${match}/submit`, {}, analyst)).statusCode).toBe(
        204,
      );
      const mine = await workspace();
      analysisId = mine.id;
      expect(mine.state).toBe('submitted');
      expect(mine.submissions).toHaveLength(1);
      expect(mine.submissions[0]?.attempt).toBe(1);
      expect(mine.submissions[0]?.confidence).toBe(2);
      firstSubmission = mine.submissions[0]?.id ?? '';
    });

    it('shows it to a reviewer, with the author beside it', async () => {
      const body = (await get('/admin/analysis-reviews', editor)).json() as {
        submissions: CommunitySubmission[];
        authors: string[];
      };
      const index = body.submissions.findIndex((s) => s.id === firstSubmission);
      expect(index).toBeGreaterThanOrEqual(0);
      // A reviewer deciding blind is a reviewer guessing.
      expect(body.authors[index]).toBe(analyst);
    });

    it('refuses a decision with no reason, even an approval', async () => {
      const response = await send(
        'POST',
        `/admin/analysis-reviews/${firstSubmission}`,
        { decision: 'approved', reason: '  ' },
        editor,
      );
      expect(response.statusCode).toBe(400);
    });

    it('asks for changes, and writes the audit row in the same act', async () => {
      expect(
        (
          await send(
            'POST',
            `/admin/analysis-reviews/${firstSubmission}`,
            { decision: 'changes_requested', reason: 'Say more about the away form.' },
            editor,
          )
        ).statusCode,
      ).toBe(204);

      const mine = await workspace();
      expect(mine.state).toBe('changes_requested');
      expect(mine.submissions[0]?.review).toMatchObject({
        decision: 'changes_requested',
        reviewer: editor,
        reason: 'Say more about the away form.',
      });

      const audited = await auditFor(analysisId);
      expect(audited.map((a) => a.action)).toEqual(['analysis.changes']);
      expect(audited[0]?.actor).toBe(editor);
      // Filed against the analysis: "who decided about this analysis" is the
      // only question the row is ever asked.
      expect(audited[0]?.target_type).toBe('community_analysis');
    });

    it('takes one decision per submission and no second opinion', async () => {
      const again = await send(
        'POST',
        `/admin/analysis-reviews/${firstSubmission}`,
        { decision: 'approved', reason: 'changed my mind' },
        editor,
      );
      expect(again.statusCode).toBe(400);
    });

    it('resubmits as a second attempt, keeping the first and its decision', async () => {
      await send(
        'PUT',
        `/me/analyses/${match}`,
        { ...DRAFT, reasoning: 'Rewritten, with the away form spelled out.' },
        analyst,
      );
      expect((await send('POST', `/me/analyses/${match}/submit`, {}, analyst)).statusCode).toBe(
        204,
      );

      const mine = await workspace();
      expect(mine.state).toBe('submitted');
      expect(mine.submissions.map((s) => s.attempt)).toEqual([1, 2]);
      // The first attempt is still there, still carrying what was said about
      // it. An analyst asked for changes needs to see what they submitted.
      expect(mine.submissions[0]?.review?.decision).toBe('changes_requested');
    });

    it('approves, publishes and audits in one act', async () => {
      const second = (await workspace()).submissions[1]?.id ?? '';
      expect(
        (
          await send(
            'POST',
            `/admin/analysis-reviews/${second}`,
            { decision: 'approved', reason: 'Clear and well argued.' },
            editor,
          )
        ).statusCode,
      ).toBe(204);

      const mine = await workspace();
      expect(mine.state).toBe('published');
      expect(mine.versions).toHaveLength(1);
      expect(mine.versions[0]?.version_number).toBe(1);
      expect(mine.versions[0]?.reasoning).toMatch(/spelled out/);

      const audited = await auditFor(analysisId);
      expect(audited.map((a) => a.action)).toEqual(['analysis.changes', 'analysis.approved']);
    });

    it('publishes to anybody, with the author standing attached and no session needed', async () => {
      const body = (
        await get(`/fixtures/${match}/community-analyses`)
      ).json() as CommunityAnalysesResponse;
      expect(body.analyses).toHaveLength(1);
      expect(body.analyses[0]?.author.username).toBe(analyst);
      // Blueprint 10.3: the name and the rating travel with it, because on a
      // public page they are what separates one analyst's call from another's.
      expect(body.analyses[0]?.author.approved).toBe(true);
      expect(body.analyses[0]?.author.rating).toBeNull();
      expect(body.analyses[0]?.versions[0]?.version_number).toBe(1);
    });

    it('keeps the published version immutable', async () => {
      await expect(
        pool.query(
          `UPDATE community_analysis_version SET reasoning = 'quietly revised' WHERE analysis_id = $1`,
          [analysisId],
        ),
      ).rejects.toThrow();
    });
  });

  describe('the kick-off wall, over HTTP', () => {
    it('refuses a submission once the match has started', async () => {
      const started = await fixture(`now() + interval '1 hour'`);
      await send('PUT', `/me/analyses/${started}`, DRAFT, analyst);
      await pool.query(
        `UPDATE fixture SET kickoff_at = now() - interval '1 minute' WHERE id = $1`,
        [started],
      );

      const response = await send('POST', `/me/analyses/${started}/submit`, {}, analyst);
      expect(response.statusCode).toBe(400);
      expect((response.json() as { message: string }).message).toMatch(/kicked off/i);
    });

    it('says there is nothing to submit when there is not', async () => {
      const empty = await fixture();
      // The analysis is created by saving a draft, so submitting before one
      // exists is "no such analysis" rather than a silent success.
      expect((await send('POST', `/me/analyses/${empty}/submit`, {}, analyst)).statusCode).toBe(
        404,
      );
    });
  });
});
