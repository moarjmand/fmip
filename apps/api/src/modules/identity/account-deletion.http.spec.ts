import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  isDeletedMember,
  type ApiError,
  type CommunityAnalysesResponse,
  type ConversationPage,
  type MatchPanelPage,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { PanelModule } from '../panel/panel.module';
import { ReputationModule } from '../reputation/reputation.module';
import { ReputationService } from '../reputation/reputation.service';
import { deleteRatedAccounts, withTriggersOff } from '../../testing/cleanup';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from './identity.service';
import { IdentityModule } from './identity.module';

// T-812, D-094: what deleting an account does, category by category, against
// the real schema -- the tombstone, the retired username, the one transaction
// and its audit row are all the database's to decide. The rule-8 half: every
// other member's rating recomputes to the same number afterwards, and the
// deleted member's own settlements still reproduce theirs.
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PASSWORD = 'correct horse battery staple';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

type Name = 'gone' | 'keeper' | 'heir' | 'bystander' | 'admin';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('Deleting an account', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let reputation: ReputationService;
  const members = {} as Record<Name, { id: string; username: string; cookie: string }>;
  const teams = [randomUUID(), randomUUID()];
  const played = [randomUUID(), randomUUID()];
  const upcoming = randomUUID();
  const groups = { handed: randomUUID(), empty: randomUUID(), spoken: randomUUID() };
  const conversations: string[] = [];
  let direct = '';
  let secondSession = '';
  let analysisId = '';
  // T-842: a saved article, which deletion removes with the member's data.
  let savedSource = '';
  let savedStory = '';
  const before = new Map<Name, number>();

  const inject = (
    method: 'GET' | 'POST',
    url: string,
    cookie?: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      payload,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  const count = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await pool.query<{ n: string }>(sql, params)).rows[0]?.n ?? 0);

  async function register(name: Name): Promise<void> {
    const username = `ad_${RUN}${name.slice(0, 3)}`;
    const response = await inject('POST', '/auth/register', undefined, {
      username,
      display_name: `Deletion ${name}`,
      email: `${username}@example.test`,
      password: PASSWORD,
      country_id: ENGLAND,
      preferred_language: 'en',
      timezone: 'Europe/London',
      accept_rules: true,
    });
    expect(response.statusCode).toBe(201);
    const id = (response.json() as { user: { id: string } }).user.id;
    members[name] = { id, username, cookie: cookieValue(response.headers['set-cookie']) };
  }

  /** A settled prediction, written the way settlement leaves it; the lock trigger is why it is in here. */
  async function settled(
    name: Name,
    fixtureId: string,
    outcome: 'home' | 'away',
    correct: boolean,
  ): Promise<void> {
    await withTriggersOff(pool, async (client) => {
      const prediction = await client.query<{ id: string }>(
        `INSERT INTO user_prediction (user_id, fixture_id) VALUES ($1, $2) RETURNING id`,
        [members[name].id, fixtureId],
      );
      const predictionId = prediction.rows[0]!.id;
      const version = await client.query<{ id: string }>(
        `INSERT INTO prediction_version (prediction_id, version_number, outcome, confidence, submitted_at)
         VALUES ($1, 1, $2, 3, now() - interval '3 days') RETURNING id`,
        [predictionId, outcome],
      );
      const run = await client.query<{ id: string }>(
        `INSERT INTO settlement_run (fixture_id, settled) VALUES ($1, 1) RETURNING id`,
        [fixtureId],
      );
      await client.query(
        `INSERT INTO settlement
           (run_id, prediction_id, version_id, fixture_id, status, actual_home, actual_away,
            outcome_correct, score_predicted, score_correct, confidence)
         VALUES ($1, $2, $3, $4, 'settled', 2, 0, $5, false, NULL, 3)`,
        [run.rows[0]!.id, predictionId, version.rows[0]!.id, fixtureId, correct],
      );
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        IdentityModule,
        ReputationModule,
        PanelModule,
        AnalysisModule,
        ConversationsModule,
      ],
    })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(MODEL_CLIENT)
      .useValue(new ModelClient({ baseUrl: 'http://model.test' }))
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    reputation = moduleRef.get(ReputationService);
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const name of ['gone', 'keeper', 'heir', 'bystander', 'admin'] as Name[])
      await register(name);
    const id = (name: Name) => members[name].id;
    const login = await inject('POST', '/auth/login', undefined, {
      identifier: members.gone.username,
      password: PASSWORD,
    });
    secondSession = cookieValue(login.headers['set-cookie']);

    // Football: two matches already played, one to come.
    for (const [index, team] of teams.entries()) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, short_name, kind, gender)
         VALUES ($1, $2, $3, $4, 'club', 'men')`,
        [team, ENGLAND, `Deletion ${index}${RUN}`, `DL${index}`],
      );
    }
    for (const [fixtureId, when, status] of [
      [played[0], '5 days', 'finished'],
      [played[1], '4 days', 'finished'],
      [upcoming, '-2 days', 'scheduled'],
    ] as const) {
      await pool.query(
        `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
         VALUES ($1, $2, 'Deletion round', now() - $3::interval, $4)`,
        [fixtureId, PL_2025, when, status],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [fixtureId, teams[0], teams[1]],
      );
    }

    // Predictions and settlements for three members, and their ratings.
    await settled('gone', played[0]!, 'home', true);
    await settled('gone', played[1]!, 'away', false);
    await settled('keeper', played[0]!, 'home', true);
    await settled('keeper', played[1]!, 'home', true);
    await settled('bystander', played[0]!, 'away', false);
    await settled('bystander', played[1]!, 'home', true);
    for (const name of ['gone', 'keeper', 'bystander'] as Name[]) {
      const outcome = await reputation.recompute(id(name));
      expect(outcome.kind).toBe('snapshot');
      if (outcome.kind === 'snapshot') before.set(name, outcome.rating.rating);
    }

    // The profile, preferences and the social graph.
    await pool.query(`INSERT INTO profile (user_id, bio) VALUES ($1, 'A bio to be forgotten')`, [
      id('gone'),
    ]);
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
      [id('gone'), teams[0]],
    );
    await pool.query(
      `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, 'key', 'auth')`,
      [id('gone'), `https://push.example.test/${RUN}`],
    );
    savedSource = (
      await pool.query<{ id: string }>(
        // Licensed: no feed, so no ingestion spec ever reads it.
        `INSERT INTO news_source (name, homepage_url, kind, rights, language)
         VALUES ($1, 'https://news.example.test', 'licensed', 'headline', 'en') RETURNING id`,
        [`Deletion Test Source ${RUN}`],
      )
    ).rows[0]!.id;
    // One statement, so no other spec's sweep of empty stories can see it half made.
    savedStory = (
      await pool.query<{ story_id: string }>(
        `WITH s AS (INSERT INTO story DEFAULT VALUES RETURNING id),
              a AS (INSERT INTO article (source_id, story_id, external_id, url)
                    SELECT $2, s.id, $3, 'https://news.example.test/saved' FROM s
                    RETURNING id, story_id)
         INSERT INTO saved_article (user_id, story_id, article_id, source_id)
         SELECT $1, a.story_id, a.id, $2 FROM a RETURNING story_id`,
        [id('gone'), savedSource, `saved-${RUN}`],
      )
    ).rows[0]!.story_id;
    await pool.query(
      `INSERT INTO member_follow (follower_id, followed_id) VALUES ($1, $2), ($2, $1)`,
      [id('gone'), id('keeper')],
    );
    await pool.query(
      `INSERT INTO friendship (low_id, high_id) VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))`,
      [id('gone'), id('keeper')],
    );
    await pool.query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [
      id('gone'),
      id('bystander'),
    ]);
    await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [
      id('gone'),
      id('admin'),
    ]);

    // Three groups the member owns: one with a moderator to inherit it, one
    // with nobody else and nothing said, one with nobody else and a message.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [groupId, slug] of [
        [groups.handed, `dl-${RUN}-h`],
        [groups.empty, `dl-${RUN}-e`],
        [groups.spoken, `dl-${RUN}-s`],
      ] as const) {
        await client.query(
          `INSERT INTO user_group (id, slug, name, visibility, created_by)
           VALUES ($1, $2, $3, 'public', $4)`,
          [groupId, slug, `Deletion ${slug}`, id('gone')],
        );
        await client.query(
          `INSERT INTO group_member (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
          [groupId, id('gone')],
        );
      }
      await client.query(
        `INSERT INTO group_member (group_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', now() - interval '2 days'),
                ($1, $3, 'moderator', now() - interval '1 day')`,
        [groups.handed, id('keeper'), id('heir')],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await pool.query(
      `INSERT INTO group_invite (group_id, invitee_id, invited_by) VALUES ($1, $2, $3)`,
      [groups.handed, id('bystander'), id('gone')],
    );
    const spoken = await pool.query<{ id: string }>(
      `INSERT INTO conversation (kind, group_id) VALUES ('group', $1) RETURNING id`,
      [groups.spoken],
    );
    conversations.push(spoken.rows[0]!.id);
    await pool.query(
      `INSERT INTO message (conversation_id, author_id, body) VALUES ($1, $2, 'Anyone here?')`,
      [spoken.rows[0]!.id, id('gone')],
    );

    // A direct conversation with a message from the member.
    const pair = await pool.query<{ id: string }>(
      `INSERT INTO conversation (kind, pair_low, pair_high)
       VALUES ('direct', LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid)) RETURNING id`,
      [id('gone'), id('keeper')],
    );
    direct = pair.rows[0]!.id;
    conversations.push(direct);
    await pool.query(
      `INSERT INTO conversation_participant (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [direct, id('gone'), id('keeper')],
    );
    await pool.query(
      `INSERT INTO message (conversation_id, author_id, body) VALUES ($1, $2, 'See you Saturday')`,
      [direct, id('gone')],
    );

    // A contributor: a grant, a public panel post and a published analysis.
    await pool.query(
      `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
       VALUES ($1, $2, 'the deletion suite', 'contributor-rules@1.0.0', now())`,
      [id('gone'), id('admin')],
    );
    await pool.query(
      `INSERT INTO match_panel (fixture_id, opened_by, reason) VALUES ($1, $2, 'the deletion suite')`,
      [upcoming, id('admin')],
    );
    await withTriggersOff(pool, async (c) => {
      await c.query(
        `INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, 'Their press will tell')`,
        [upcoming, id('gone')],
      );
      const analysis = await c.query<{ id: string }>(
        `INSERT INTO community_analysis (fixture_id, author_id) VALUES ($1, $2) RETURNING id`,
        [upcoming, id('gone')],
      );
      analysisId = analysis.rows[0]!.id;
      const submission = await c.query<{ id: string }>(
        `INSERT INTO community_analysis_submission
           (analysis_id, attempt, predicted_outcome, confidence, reasoning)
         VALUES ($1, 1, 'home', 3, 'Because of the full-backs.') RETURNING id`,
        [analysisId],
      );
      await c.query(
        `INSERT INTO community_analysis_version
           (analysis_id, submission_id, version_number, predicted_outcome, confidence, reasoning)
         VALUES ($1, $2, 1, 'home', 3, 'Because of the full-backs.')`,
        [analysisId, submission.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO community_analysis_draft (analysis_id, predicted_outcome, confidence, reasoning)
         VALUES ($1, 'home', 4, 'A second thought never sent.')`,
        [analysisId],
      );
      await c.query(
        `INSERT INTO member_briefing
           (user_id, version_number, since, until, state, rejection, document, prompt_version, model)
         VALUES ($1, 1, now() - interval '1 day', now(), 'rejected', 'the deletion suite',
                 '{}'::jsonb, 'briefing@1.0.0', 'test-model')`,
        [id('gone')],
      );
    });

    // A report the member filed.
    await pool.query(
      `INSERT INTO report (reporter_id, subject_type, subject_id, reason)
       VALUES ($1, 'member', $2, 'spam')`,
      [id('gone'), id('keeper')],
    );
  });

  afterAll(async () => {
    const ids = Object.values(members).map((m) => m.id);
    const fixtures = [...played, upcoming];
    const groupIds = Object.values(groups);
    await withTriggersOff(pool, async (c) => {
      await c.query(`DELETE FROM panel_post WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await c.query(`DELETE FROM match_panel WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      for (const table of [
        'community_analysis_draft',
        'community_analysis_version',
        'community_analysis_submission',
      ])
        await c.query(
          `DELETE FROM ${table} WHERE analysis_id IN
             (SELECT id FROM community_analysis WHERE fixture_id = ANY($1::uuid[]))`,
          [fixtures],
        );
      await c.query(`DELETE FROM community_analysis WHERE fixture_id = ANY($1::uuid[])`, [
        fixtures,
      ]);
      await c.query(
        `DELETE FROM contributor_grant_event WHERE grant_id IN
           (SELECT id FROM contributor_grant WHERE user_id = ANY($1::uuid[]))`,
        [ids],
      );
      await c.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM report WHERE reporter_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM member_briefing WHERE user_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM message WHERE conversation_id = ANY($1::uuid[])`, [conversations]);
      await c.query(
        `DELETE FROM conversation_participant WHERE conversation_id = ANY($1::uuid[])`,
        [conversations],
      );
      await c.query(`DELETE FROM conversation WHERE id = ANY($1::uuid[])`, [conversations]);
      await c.query(`DELETE FROM group_invite WHERE group_id = ANY($1::uuid[])`, [groupIds]);
      await c.query(`DELETE FROM group_member WHERE group_id = ANY($1::uuid[])`, [groupIds]);
      await c.query(`DELETE FROM user_group WHERE id = ANY($1::uuid[])`, [groupIds]);
      await c.query(`DELETE FROM settlement WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await c.query(`DELETE FROM settlement_run WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await c.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE fixture_id = ANY($1::uuid[]))`,
        [fixtures],
      );
      await c.query(`DELETE FROM user_prediction WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await c.query(`DELETE FROM retired_username WHERE username LIKE $1`, [`ad\\_${RUN}%`]);
    });
    await deleteRatedAccounts(pool, ids);
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [savedSource]);
    await pool.query(`DELETE FROM story WHERE id = $1`, [savedStory]);
    await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
      fixtures,
    ]);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.end();
    await app.close();
  });

  describe('is refused', () => {
    it('without a session', async () => {
      const response = await inject('POST', '/auth/account/delete', undefined, {
        password: PASSWORD,
        confirm: members.gone.username,
      });
      expect(response.statusCode).toBe(401);
    });

    it('with the wrong password, naming the field', async () => {
      const response = await inject('POST', '/auth/account/delete', members.gone.cookie, {
        password: 'not the password at all',
        confirm: members.gone.username,
      });
      expect(response.statusCode).toBe(400);
      expect((response.json() as ApiError).fields).toEqual({ password: 'is not right' });
    });

    it('when the confirmation is not the username', async () => {
      const response = await inject('POST', '/auth/account/delete', members.gone.cookie, {
        password: PASSWORD,
        confirm: members.keeper.username,
      });
      expect(response.statusCode).toBe(400);
      expect((response.json() as ApiError).fields).toEqual({ confirm: 'must be your username' });
    });

    it('when a field is missing', async () => {
      const response = await inject('POST', '/auth/account/delete', members.gone.cookie, {});
      expect(response.statusCode).toBe(400);
      expect(Object.keys((response.json() as ApiError).fields ?? {}).sort()).toEqual([
        'confirm',
        'password',
      ]);
      // Nothing happened on any refusal.
      expect(
        await count(
          `SELECT count(*)::text AS n FROM user_account WHERE id = $1 AND status = 'active'`,
          [members.gone.id],
        ),
      ).toBe(1);
    });
  });

  describe('when confirmed', () => {
    beforeAll(async () => {
      const response = await inject('POST', '/auth/account/delete', members.gone.cookie, {
        password: PASSWORD,
        confirm: members.gone.username,
      });
      expect(response.statusCode).toBe(204);
      expect(String(response.headers['set-cookie'])).toMatch(/^fmip_session=;/);
    });

    it('signs out every session and nobody can sign in as it again', async () => {
      for (const cookie of [members.gone.cookie, secondSession])
        expect((await inject('GET', '/auth/me', cookie)).statusCode).toBe(401);
      const login = await inject('POST', '/auth/login', undefined, {
        identifier: members.gone.username,
        password: PASSWORD,
      });
      expect(login.statusCode).toBe(401);
      const id = [members.gone.id];
      expect(await count(`SELECT count(*)::text AS n FROM session WHERE user_id = $1`, id)).toBe(0);
      expect(await count(`SELECT count(*)::text AS n FROM credential WHERE user_id = $1`, id)).toBe(
        0,
      );
    });

    it('leaves a tombstone: no name, no address, no preferences', async () => {
      const { rows } = await pool.query<{
        username: string;
        display_name: string;
        email: string;
        status: string;
        email_verified_at: Date | null;
      }>(
        `SELECT username, display_name, email, status, email_verified_at FROM user_account WHERE id = $1`,
        [members.gone.id],
      );
      const row = rows[0]!;
      expect(row.status).toBe('deleted');
      expect(isDeletedMember(row.username)).toBe(true);
      expect(row.display_name).toBe('Deleted member');
      expect(row.email).toBe(`deleted-${members.gone.id}@deleted.invalid`);
      expect(row.email_verified_at).toBeNull();
      for (const table of [
        'profile',
        'followed_entity',
        'push_subscription',
        'member_briefing',
        'saved_article',
      ])
        expect(
          await count(`SELECT count(*)::text AS n FROM ${table} WHERE user_id = $1`, [
            members.gone.id,
          ]),
          table,
        ).toBe(0);
      expect(
        (await inject('GET', `/profiles/${row.username}`)).statusCode,
        'no public profile',
      ).toBe(404);
      expect((await inject('GET', `/users/${row.username}/rating`)).statusCode).toBe(404);
    });

    it('removes follows, friendships, requests and blocks in both directions', async () => {
      const id = [members.gone.id];
      expect(
        await count(
          `SELECT count(*)::text AS n FROM member_follow WHERE follower_id = $1 OR followed_id = $1`,
          id,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*)::text AS n FROM friendship WHERE low_id = $1 OR high_id = $1`,
          id,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*)::text AS n FROM friend_request WHERE requester_id = $1 OR addressee_id = $1`,
          id,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*)::text AS n FROM user_block WHERE blocker_id = $1 OR blocked_id = $1`,
          id,
        ),
      ).toBe(0);
    });

    it('hands a group on, deletes an empty one and closes one with history (D-057)', async () => {
      const { rows } = await pool.query<{ user_id: string; role: string }>(
        `SELECT user_id, role FROM group_member WHERE group_id = $1 ORDER BY role`,
        [groups.handed],
      );
      expect(rows).toEqual([
        { user_id: members.keeper.id, role: 'member' },
        { user_id: members.heir.id, role: 'owner' },
      ]);
      expect(
        await count(`SELECT count(*)::text AS n FROM user_group WHERE id = $1`, [groups.empty]),
      ).toBe(0);
      const closed = await pool.query<{ visibility: string }>(
        `SELECT visibility FROM user_group WHERE id = $1`,
        [groups.spoken],
      );
      expect(closed.rows[0]?.visibility).toBe('invite_only');
      expect(
        await count(
          `SELECT count(*)::text AS n FROM group_member WHERE user_id = $1 AND group_id <> $2`,
          [members.gone.id, groups.spoken],
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*)::text AS n FROM group_invite WHERE invited_by = $1 OR invitee_id = $1`,
          [members.gone.id],
        ),
      ).toBe(0);
    });

    it('keeps messages and panel posts, as a deleted member', async () => {
      const page = await inject('GET', `/me/conversations/${direct}`, members.keeper.cookie);
      expect(page.statusCode).toBe(200);
      const messages = (page.json() as ConversationPage).messages;
      expect(messages.map((m) => m.body)).toEqual(['See you Saturday']);
      expect(isDeletedMember(messages[0]!.author)).toBe(true);

      const panel = (await inject('GET', `/fixtures/${upcoming}/panel`)).json() as MatchPanelPage;
      expect(panel.posts).toHaveLength(1);
      expect(isDeletedMember(panel.posts[0]!.author.username)).toBe(true);
      expect(panel.posts[0]!.author.display_name).toBe('Deleted member');
      // The grant was withdrawn, so nothing calls the tombstone approved.
      expect(panel.posts[0]!.author.approved).toBe(false);
    });

    it('takes published community analysis down and drops the draft', async () => {
      const response = await inject('GET', `/fixtures/${upcoming}/community-analyses`);
      expect(response.statusCode).toBe(200);
      expect((response.json() as CommunityAnalysesResponse).analyses).toEqual([]);
      expect(
        await count(
          `SELECT count(*)::text AS n FROM community_analysis_draft WHERE analysis_id = $1`,
          [analysisId],
        ),
      ).toBe(0);
    });

    it('keeps the reports the member filed', async () => {
      expect(
        await count(`SELECT count(*)::text AS n FROM report WHERE reporter_id = $1`, [
          members.gone.id,
        ]),
      ).toBe(1);
    });

    it('writes one audit row: the member, the reason, the previous status', async () => {
      const { rows } = await pool.query<{
        actor_id: string;
        reason: string;
        previous: unknown;
        next: Record<string, unknown>;
      }>(
        `SELECT actor_id, reason, previous, next FROM audit_log
          WHERE action = 'account.delete' AND target_type = 'user_account' AND target_id = $1`,
        [members.gone.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_id).toBe(members.gone.id);
      expect(rows[0]!.reason).toBe('self-service deletion');
      expect(rows[0]!.previous).toEqual({ status: 'active' });
      expect(rows[0]!.next).toMatchObject({
        status: 'deleted',
        groups_handed_over: 1,
        groups_deleted: 1,
        groups_closed: 1,
        analyses_taken_down: 1,
        grants_withdrawn: 1,
      });
      // The audit row keeps no copy of what was deleted.
      expect(JSON.stringify(rows[0])).not.toContain(members.gone.username);
    });

    it('retires the username: nobody can register it, or a deleted_ one', async () => {
      for (const username of [members.gone.username, 'deleted_0123456789ab']) {
        const response = await inject('POST', '/auth/register', undefined, {
          username,
          display_name: 'Impersonator',
          email: `imp_${RUN}${username.length}@example.test`,
          password: PASSWORD,
          country_id: ENGLAND,
          preferred_language: 'en',
          timezone: 'Europe/London',
          accept_rules: true,
        });
        expect(response.statusCode, username).toBe(409);
        expect((response.json() as ApiError).fields).toEqual({ username: 'already taken' });
      }
    });

    it('cannot be undone, and a second request finds nothing to delete', async () => {
      await expect(
        pool.query(`UPDATE user_account SET status = 'active' WHERE id = $1`, [members.gone.id]),
      ).rejects.toThrow(/cannot be restored/);
      const again = await inject('POST', '/auth/account/delete', secondSession, {
        password: PASSWORD,
        confirm: members.gone.username,
      });
      expect(again.statusCode).toBe(401);
    });

    it('keeps predictions and settlements, and every rating recomputes to the same value (rule 8)', async () => {
      expect(
        await count(`SELECT count(*)::text AS n FROM user_prediction WHERE user_id = $1`, [
          members.gone.id,
        ]),
      ).toBe(2);
      for (const name of ['keeper', 'bystander'] as Name[]) {
        const outcome = await reputation.recompute(members[name].id);
        expect(outcome.kind, name).toBe('unchanged');
        if (outcome.kind === 'unchanged') expect(outcome.rating.rating).toBe(before.get(name));
      }
      // The deleted member's own number is still reproducible from the stored
      // rows alone -- it is simply shown nowhere, and no new snapshot is written.
      const history = await reputation.history(members.gone.id);
      expect(history?.points.at(-1)?.rating).toBe(before.get('gone'));
      expect((await reputation.recompute(members.gone.id)).kind).toBe('unknown_user');
    });
  });
});
