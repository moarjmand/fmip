import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { BoxScoreFeedHealth, HighlightsFeedHealth } from '@fmip/contracts';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { BoxScoreFeedService } from './box-score-feed.service';
import { HIGHLIGHT_FEED_CONFIG } from './highlight-feed.service';
import { HIGHLIGHT_FEED_TRANSPORT } from './internal/highlight-feed-transport';
import { ViewingModule } from './viewing.module';

/**
 * The box-score job against a real database (T-1432, D-224): our match is
 * found on the source's list through the mapping table, its box score asked
 * once, each player placed through `provider_mapping` (never a name), the
 * figures stored as their own source with the record of the answer; an
 * unmapped player is queued for review with the line-up's shirt as a hint,
 * and mapped by the line-up rule only when the name agrees too (T-1436); a
 * box score with players unplaced is asked again only after the re-ask
 * interval, and replaced whole; the schema refuses what the rules refuse.
 *
 * Everything here is this file's own, and the provider is a scripted
 * transport: no network.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
// Numeric ids the source would use, unique to this run.
const BASE = 800_000_000 + (Date.now() % 90_000_000);
const LEAGUE = String(BASE);
const HOME = String(BASE + 1);
const AWAY = String(BASE + 2);
const MATCH = String(BASE + 3);
const SCORER = String(BASE + 4);
const KEEPER = String(BASE + 5);
const STRANGER = String(BASE + 6);
const BENCH = String(BASE + 7);

class ScriptedProvider implements Transport {
  readonly urls: string[] = [];
  constructor(private readonly answer: (url: string) => unknown) {}
  request(url: string): Promise<TransportResponse> {
    this.urls.push(url);
    return Promise.resolve({
      status: 200,
      body: this.answer(url),
      receivedAt: new Date().toISOString(),
    });
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the box-score job', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let jobs: BoxScoreFeedService;
  const competition = randomUUID();
  const season = randomUUID();
  const teams = [randomUUID(), randomUUID()];
  const people = {
    scorer: randomUUID(),
    keeper: randomUUID(),
    stranger: randomUUID(),
    bench: randomUUID(),
  };
  const fixture = randomUUID();
  const kickoff = new Date(Date.now() - 5 * 60 * 60 * 1000);
  kickoff.setUTCMilliseconds(0);
  let scorerXg = 0.38;

  const player = (id: string, name: string, shirt: number, minutes: number, stats: object) => ({
    id: Number(id),
    name,
    shirtNumber: shirt,
    minutesPlayed: minutes,
    matchRating: '7.10',
    statistics: stats,
  });
  const provider = new ScriptedProvider((url) => {
    if (url.endsWith(`/box-score/${MATCH}`)) {
      return [
        {
          team: { id: Number(HOME), name: `Home ${RUN}` },
          players: [
            player(SCORER, 'A. Scorer', 9, 90, { expectedGoals: scorerXg, expectedAssists: 0.12 }),
            player(BENCH, 'B. Bench', 14, 0, { expectedGoals: 0.38 }),
          ],
        },
        {
          team: { id: Number(AWAY), name: `Away ${RUN}` },
          players: [
            player(KEEPER, 'C. Keeper', 1, 90, {
              expectedGoals: null,
              expectedGoalsOnTargetConceded: 1.2,
              expectedGoalsPrevented: -1.75,
            }),
            player(STRANGER, 'D. Stranger', 7, 70, { expectedGoals: 0.2 }),
          ],
        },
      ];
    }
    if (url.includes('/box-score/')) return [];
    // Another suite's mapped league (or one a crashed run left behind) hears nothing.
    if (!url.includes(`leagueId=${LEAGUE}&`)) return { data: [] };
    return {
      data: [
        {
          id: Number(MATCH),
          date: kickoff.toISOString(),
          state: { description: 'Finished', score: { current: '2 - 1' } },
          homeTeam: { id: Number(HOME), name: `Home ${RUN}` },
          awayTeam: { id: Number(AWAY), name: `Away ${RUN}` },
          league: { id: Number(LEAGUE), name: 'Box League', season: 2026 },
        },
      ],
    };
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, ViewingModule] })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(HIGHLIGHT_FEED_CONFIG)
      .useValue({ state: 'configured', apiKey: 'test-key', dailyBudget: 500 })
      .overrideProvider(HIGHLIGHT_FEED_TRANSPORT)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    jobs = app.get(BoxScoreFeedService);
    pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(
      `INSERT INTO competition (id, name, kind, scope, gender)
       VALUES ($1, $2, 'league', 'international', 'men')`,
      [competition, `Box League ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2026', '2026-01-01', '2026-12-31', true)`,
      [season, competition],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
      [teams[0], teams[1], `Home ${RUN}`, `Away ${RUN}`],
    );
    // The stranger's name on our side is not the one the source gives: the shirt alone maps nobody.
    await pool.query(
      `INSERT INTO person (id, full_name) VALUES ($1, $5), ($2, $6), ($3, $7), ($4, $8)`,
      [
        people.scorer,
        people.keeper,
        people.stranger,
        people.bench,
        `Scorer ${RUN}`,
        `Keeper ${RUN}`,
        `Outsider ${RUN}`,
        `Billy Bench ${RUN}`,
      ],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, 'Round 7', $3, 'finished')`,
      [fixture, season, kickoff],
    );
    const { rows } = await pool.query<{ id: string; side: string }>(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
      [fixture, teams[0], teams[1]],
    );
    const away = rows.find((r) => r.side === 'away')!.id;
    // Our line-up names the stranger with the shirt the source gives them: a hint, not a mapping.
    await pool.query(
      `INSERT INTO lineup (participant_id, person_id, role, shirt_number) VALUES ($1, $2, 'starter', 7)`,
      [away, people.stranger],
    );
    await pool.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id) VALUES
         ('highlightly', 'competition', $1, $4),
         ('highlightly', 'team', $2, $5),
         ('highlightly', 'team', $3, $6),
         ('highlightly', 'person', $7, $8),
         ('highlightly', 'person', $9, $10)`,
      [
        LEAGUE,
        HOME,
        AWAY,
        competition,
        teams[0],
        teams[1],
        SCORER,
        people.scorer,
        KEEPER,
        people.keeper,
      ],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
    await pool.query(
      `DELETE FROM provider_mapping WHERE provider = 'highlightly' AND external_id = ANY($1::text[])`,
      [[LEAGUE, HOME, AWAY, SCORER, KEEPER, STRANGER, BENCH]],
    );
    await pool.query(
      `DELETE FROM unresolved_entity WHERE provider = 'highlightly' AND external_id = ANY($1::text[])`,
      [[HOME, AWAY, STRANGER, BENCH]],
    );
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [Object.values(people)]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [season]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.end();
    await app.close();
  });

  const figures = async () =>
    (
      await pool.query<{ person_id: string; metric: string; value: number; source: string }>(
        `SELECT e.person_id, e.metric, e.value::float8 AS value, e.source
           FROM fixture_player_expected e JOIN fixture_participant p ON p.id = e.participant_id
          WHERE p.fixture_id = $1 ORDER BY e.person_id, e.metric`,
        [fixture],
      )
    ).rows;

  it('says it is on, with its batch and the ceiling it shares with the highlights feed', async () => {
    const box = (
      await app.inject({ method: 'GET', url: '/health/box-scores' })
    ).json<BoxScoreFeedHealth>();
    expect(box).toMatchObject({ feed: 'configured', batch: 60, daily_budget: 500, last_run: null });
  });

  it("stores the placed players' figures as their own source, and queues the stranger with a hint", async () => {
    const run = await jobs.run();
    expect(run).toMatchObject({ stored: 1, players_unresolved: 2, stopped: null });
    expect(provider.urls.filter((u) => u.endsWith(`/box-score/${MATCH}`))).toHaveLength(1);
    const sorted = (rows: { person_id: string; metric: string; value: number; source: string }[]) =>
      rows.map((r) => [r.person_id, r.metric, r.value, r.source]).sort();
    expect(sorted(await figures())).toEqual(
      [
        [people.scorer, 'xa', 0.12, 'highlightly'],
        [people.scorer, 'xg', 0.38, 'highlightly'],
        [people.keeper, 'xgot_conceded', 1.2, 'highlightly'],
        [people.keeper, 'xgp', -1.75, 'highlightly'],
      ].sort(),
    );
    const record = await pool.query<{ players: number; unresolved: number }>(
      `SELECT players, unresolved FROM fixture_box_score WHERE fixture_id = $1 AND source = 'highlightly'`,
      [fixture],
    );
    expect(record.rows).toEqual([{ players: 4, unresolved: 2 }]);

    const queued = await pool.query<{ external_id: string; payload: Record<string, unknown> }>(
      `SELECT external_id, payload FROM unresolved_entity
        WHERE provider = 'highlightly' AND entity_type = 'person' AND external_id = ANY($1::text[])
        ORDER BY external_id`,
      [[STRANGER, BENCH]],
    );
    expect(queued.rows.map((r) => r.external_id)).toEqual([STRANGER, BENCH].sort());
    expect(queued.rows.find((r) => r.external_id === STRANGER)?.payload).toEqual({
      name: 'D. Stranger',
      seenIn: competition,
      fixture,
      team: teams[1],
      shirtNumber: 7,
      lineupPerson: people.stranger,
    });
    // Rule 1: the hint is never a mapping.
    const mapped = await pool.query(
      `SELECT 1 FROM provider_mapping WHERE provider = 'highlightly' AND external_id = $1`,
      [STRANGER],
    );
    expect(mapped.rowCount).toBe(0);
  });

  it('shares one count with the highlights feed', async () => {
    const box = (
      await app.inject({ method: 'GET', url: '/health/box-scores' })
    ).json<BoxScoreFeedHealth>();
    const feed = (
      await app.inject({ method: 'GET', url: '/health/highlights' })
    ).json<HighlightsFeedHealth>();
    expect(box.requests_today).toBeGreaterThanOrEqual(2);
    expect(feed.requests_today).toBe(box.requests_today);
    expect(box.last_run).toMatchObject({ stored: 1 });
  });

  it('holds a box score with players unplaced until the re-ask interval, then replaces it whole', async () => {
    const asked = provider.urls.length;
    expect(await jobs.run()).toMatchObject({ asked: 0, stored: 0 });
    expect(provider.urls.slice(asked).some((u) => u.includes('/box-score/'))).toBe(false);

    // The stranger is mapped by a reviewer, and the interval has passed.
    await pool.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ('highlightly', 'person', $1, $2)`,
      [STRANGER, people.stranger],
    );
    await pool.query(
      `UPDATE fixture_box_score SET fetched_at = now() - interval '13 hours' WHERE fixture_id = $1`,
      [fixture],
    );
    scorerXg = 0.41;
    expect(await jobs.run()).toMatchObject({ asked: 1, stored: 1, players_unresolved: 1 });
    const after = await figures();
    expect(after.find((r) => r.person_id === people.scorer && r.metric === 'xg')?.value).toBe(0.41);
    expect(after.filter((r) => r.person_id === people.stranger)).toEqual([
      { person_id: people.stranger, metric: 'xg', value: 0.2, source: 'highlightly' },
    ]);
    expect(after.filter((r) => r.person_id === people.scorer && r.metric === 'xg')).toHaveLength(1);
  });

  it('maps a player by the line-up rule when the match, side, shirt and name agree (T-1436)', async () => {
    // Our line-up puts Billy Bench in the home shirt 14 the source gives "B. Bench".
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'`,
      [fixture],
    );
    await pool.query(
      `INSERT INTO lineup (participant_id, person_id, role, shirt_number) VALUES ($1, $2, 'bench', 14)`,
      [rows[0]!.id, people.bench],
    );
    await pool.query(
      `UPDATE fixture_box_score SET fetched_at = now() - interval '13 hours' WHERE fixture_id = $1`,
      [fixture],
    );
    expect(await jobs.run()).toMatchObject({
      asked: 1,
      stored: 1,
      players_linked: 1,
      players_unresolved: 0,
    });
    const mapped = await pool.query<{ internal_id: string }>(
      `SELECT internal_id FROM provider_mapping
        WHERE provider = 'highlightly' AND entity_type = 'person' AND external_id = $1`,
      [BENCH],
    );
    expect(mapped.rows).toEqual([{ internal_id: people.bench }]);
    const queue = await pool.query<{ status: string }>(
      `SELECT status FROM unresolved_entity
        WHERE provider = 'highlightly' AND entity_type = 'person' AND external_id = $1`,
      [BENCH],
    );
    expect(queue.rows).toEqual([{ status: 'resolved' }]);
    // A substitute who never came on has no figures to keep; the mapping is what the rule adds.
  });

  it('refuses, in the schema, another source, an unknown metric, and a negative expectation', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'`,
      [fixture],
    );
    const home = rows[0]!.id;
    const insert = (source: string, metric: string, value: number) =>
      pool.query(
        `INSERT INTO fixture_player_expected (participant_id, person_id, source, metric, value)
         VALUES ($1, $2, $3, $4, $5)`,
        [home, people.keeper, source, metric, value],
      );
    for (const [source, metric, value] of [
      ['api_football', 'xg', 0.1],
      ['highlightly', 'rating', 7],
      ['highlightly', 'xg', -0.1],
    ] as const) {
      await expect(insert(source, metric, value)).rejects.toSatisfy(
        (e) => (e as { code?: string }).code === '23514',
      );
    }
  });
});
