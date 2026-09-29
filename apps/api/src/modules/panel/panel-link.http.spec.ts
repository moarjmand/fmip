import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, MatchPanelPage, PanelPermission, PanelPost } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PanelModule } from './panel.module';

/**
 * A panel post's link over HTTP (T-1030, D-136): one thing of the post's own
 * match, refused by the schema for any other match, and a card that says when
 * the feed changed or removed what was linked rather than showing the old
 * value, with a linked prediction shown only where the author's own history
 * visibility shows it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('panel post links', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const writer = `pk${RUN}w`;
  const reader = `pk${RUN}r`;
  const admin = `pk${RUN}a`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const teams = [randomUUID(), randomUUID()];
  const match = randomUUID();
  const other = randomUUID();
  const players = [randomUUID(), randomUUID()];
  const participants = new Map<string, string>();
  let goal = '';
  let card = '';
  let otherGoal = '';

  const as = (who?: string) =>
    who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
  const write = (link: unknown, who = writer) =>
    app.inject({
      method: 'POST',
      url: `/fixtures/${match}/panel`,
      payload: { body: `about this ${randomUUID()}`, link } as Record<string, unknown>,
      headers: as(who),
    });
  const panel = () =>
    app
      .inject({ method: 'GET', url: `/fixtures/${match}/panel?limit=100` })
      .then((r) => r.json() as MatchPanelPage);
  const postOn = async (id: string) => (await panel()).posts.find((p) => p.id === id);
  const permission = (who: string) =>
    app
      .inject({ method: 'GET', url: `/fixtures/${match}/panel/permission`, headers: as(who) })
      .then((r) => r.json() as PanelPermission);

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

  const historyVisibility = (visibility: string) =>
    pool.query(
      `INSERT INTO privacy_setting (user_id, prediction_history_visibility) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET prediction_history_visibility = EXCLUDED.prediction_history_visibility`,
      [ids.get(writer), visibility],
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, PanelModule] })
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
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const username of [writer, reader, admin]) await register(username);
    for (const [index, id] of teams.entries()) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, short_name, kind, gender)
         VALUES ($1, $2, $3, $4, 'club', 'men')`,
        [id, ENGLAND, `Panel Link ${index}${RUN}`, `PK${index}`],
      );
    }
    for (const [index, id] of players.entries()) {
      await pool.query(`INSERT INTO person (id, full_name) VALUES ($1, $2)`, [
        id,
        `Link Player ${index} ${RUN}`,
      ]);
    }
    for (const fixture of [match, other]) {
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', now() + interval '1 hour', 'scheduled')`,
        [fixture, PL_2025, REGULAR_SEASON],
      );
      const { rows } = await pool.query<{ id: string; side: string }>(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
        [fixture, teams[0], teams[1]],
      );
      for (const r of rows) participants.set(`${fixture}:${r.side}`, r.id);
    }
    // Player 0 is in this match's home line-up; player 1 only in the other's.
    await pool.query(
      `INSERT INTO lineup (participant_id, person_id, role) VALUES ($1, $2, 'starter'), ($3, $4, 'starter')`,
      [
        participants.get(`${match}:home`),
        players[0],
        participants.get(`${other}:away`),
        players[1],
      ],
    );
    const incidents = await pool.query<{ id: string; fixture_id: string; sequence: number }>(
      `INSERT INTO incident (fixture_id, participant_id, person_id, kind, minute, sequence)
       VALUES ($1, $2, $3, 'goal', 23, 1), ($1, $2, $3, 'yellow_card', 40, 2),
              ($4, $5, $6, 'goal', 10, 1)
       RETURNING id, fixture_id, sequence`,
      [
        match,
        participants.get(`${match}:home`),
        players[0],
        other,
        participants.get(`${other}:away`),
        players[1],
      ],
    );
    for (const r of incidents.rows) {
      if (r.fixture_id === other) otherGoal = r.id;
      else if (r.sequence === 1) goal = r.id;
      else card = r.id;
    }
    await pool.query(
      `INSERT INTO fixture_stat (participant_id, metric, value) VALUES ($1, 'possession_pct', 55)`,
      [participants.get(`${match}:home`)],
    );
    await pool.query(
      `INSERT INTO match_panel (fixture_id, opened_by, reason) VALUES ($1, $2, 'panel link suite')`,
      [match, ids.get(admin)],
    );
    await pool.query(
      `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
       VALUES ($1, $2, 'panel link suite', 'contributor-rules@1.0.0', now())`,
      [ids.get(writer), ids.get(admin)],
    );
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM panel_post WHERE fixture_id = ANY($1::uuid[])`, [
        [match, other],
      ]);
      await client.query(`DELETE FROM match_panel WHERE fixture_id = $1`, [match]);
      await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE user_id = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(`DELETE FROM user_prediction WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
        everyone,
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM incident WHERE fixture_id = ANY($1::uuid[])`, [[match, other]]);
    await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
      [match, other],
    ]);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[match, other]]);
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [players]);
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.end();
    await app.close();
  });

  it('refuses a link to another match, with words, and writes nothing', async () => {
    const before = (await panel()).total;
    const refused = [
      [{ kind: 'incident', incident_id: otherGoal }, 'That incident is not one of this match.'],
      [
        { kind: 'player', person_id: players[1] },
        'That player is in neither line-up of this match.',
      ],
      [{ kind: 'prediction' }, 'You have no prediction on this match to link.'],
      [
        { kind: 'statistic', side: 'away', metric: 'possession_pct' },
        'That statistic is not supplied for this match.',
      ],
    ] as const;
    for (const [link, words] of refused) {
      const response = await write(link);
      expect(response.statusCode).toBe(400);
      expect((response.json() as ApiError).message).toBe(words);
    }
    expect((await panel()).total).toBe(before);
  });

  it('refuses a malformed link before asking the database', async () => {
    const response = await write({ kind: 'forecast' });
    expect(response.statusCode).toBe(400);
    expect((response.json() as ApiError).message).toMatch(/kind is one of/);
  });

  it('carries each kind of link as a card on the public panel', async () => {
    const incident = (await write({ kind: 'incident', incident_id: goal })).json() as PanelPost;
    expect(incident.link).toMatchObject({
      kind: 'incident',
      state: 'as_linked',
      incident: { kind: 'goal', minute: 23, side: 'home' },
    });

    const player = (await write({ kind: 'player', person_id: players[0] })).json() as PanelPost;
    expect(player.link).toEqual({
      kind: 'player',
      player: { id: players[0], name: `Link Player 0 ${RUN}` },
      side: 'home',
      in_lineup: true,
    });

    const stat = (
      await write({ kind: 'statistic', side: 'home', metric: 'possession_pct' })
    ).json() as PanelPost;
    await pool.query(
      `UPDATE fixture_stat SET value = 61 WHERE participant_id = $1 AND metric = 'possession_pct'`,
      [participants.get(`${match}:home`)],
    );
    expect((await postOn(stat.id))?.link).toEqual({
      kind: 'statistic',
      side: 'home',
      metric: 'possession_pct',
      value_at_post: 55,
      current: 61,
    });

    const plain = (await write(undefined)).json() as PanelPost;
    expect(plain.link).toBeNull();
  });

  it('says when the feed changed or removed a linked incident, never showing the old value', async () => {
    const changed = (await write({ kind: 'incident', incident_id: card })).json() as PanelPost;
    const removed = (await write({ kind: 'incident', incident_id: goal })).json() as PanelPost;

    await pool.query(`UPDATE incident SET kind = 'red_card', minute = 41 WHERE id = $1`, [card]);
    expect((await postOn(changed.id))?.link).toMatchObject({
      kind: 'incident',
      state: 'changed',
      incident: { kind: 'red_card', minute: 41 },
    });

    await pool.query(`DELETE FROM incident WHERE id = $1`, [goal]);
    expect((await postOn(removed.id))?.link).toEqual({
      kind: 'incident',
      state: 'removed',
      incident: null,
    });
  });

  it("links the author's own prediction and shows it only where their visibility does", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_prediction (user_id, fixture_id) VALUES ($1, $2) RETURNING id`,
      [ids.get(writer), match],
    );
    await pool.query(
      `INSERT INTO prediction_version (prediction_id, version_number, outcome, home_goals, away_goals, confidence)
       VALUES ($1, 1, 'home', 2, 1, 4)`,
      [rows[0]?.id],
    );
    await historyVisibility('public');
    const linked = (await write({ kind: 'prediction' })).json() as PanelPost;
    expect(linked.link).toMatchObject({
      kind: 'prediction',
      state: 'visible',
      prediction: { outcome: 'home', home_goals: 2, away_goals: 1, revised_since: false },
    });

    // Private: the public document withholds it and names why; the author
    // still sees their own call, and another member does not.
    await historyVisibility('private');
    expect((await postOn(linked.id))?.link).toEqual({
      kind: 'prediction',
      state: 'withheld',
      visibility: 'private',
      prediction: null,
    });
    const own = await permission(writer);
    expect(own.linked_predictions).toEqual([
      { post_id: linked.id, prediction: expect.objectContaining({ outcome: 'home' }) },
    ]);
    expect((await permission(reader)).linked_predictions).toEqual([]);

    // A later call does not rewrite the card: it says the author changed it.
    await pool.query(
      `INSERT INTO prediction_version (prediction_id, version_number, outcome, confidence)
       VALUES ($1, 2, 'away', 3)`,
      [rows[0]?.id],
    );
    await historyVisibility('public');
    expect((await postOn(linked.id))?.link).toMatchObject({
      state: 'visible',
      prediction: { outcome: 'home', revised_since: true },
    });
  });

  it('holds one link at most, and never changes one', async () => {
    const post = (await write({ kind: 'player', person_id: players[0] })).json() as PanelPost;
    await expect(
      pool.query(`UPDATE panel_post SET link_person_id = $2 WHERE id = $1`, [post.id, players[1]]),
    ).rejects.toMatchObject({ code: 'PL007' });
    await expect(
      pool.query(
        `INSERT INTO panel_post (fixture_id, author_id, body, link_kind, link_person_id, link_incident_id)
         VALUES ($1, $2, 'two links', 'player', $3, $4)`,
        [match, ids.get(writer), players[0], card],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    // The tombstone still works, and the card goes with the words.
    await app.inject({
      method: 'DELETE',
      url: `/fixtures/${match}/panel/${post.id}`,
      headers: as(writer),
    });
    expect((await postOn(post.id))?.link).toBeNull();
  });
});
