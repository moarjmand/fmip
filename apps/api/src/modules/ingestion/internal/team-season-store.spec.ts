import { randomUUID } from 'node:crypto';
import type { NormalisedTeamSeasonStats } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TeamSeasonStore } from './team-season-store';
import type { TeamSeasonAsk } from './team-seasons';

/**
 * The `team_seasons` job's SQL on a database (T-1437, D-228): which teams and
 * seasons are owed an ask -- past seasons once, current ones again after a
 * week or a match -- the replacing write, and the ask records that pace the
 * retries.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PROVIDER = 'api_football' as const;
const LATER = '2999-01-01T00:00:00Z';
const EARLIER = '2000-01-01T00:00:00Z';

function teamStats(over: Partial<NormalisedTeamSeasonStats> = {}): NormalisedTeamSeasonStats {
  return {
    competition: { externalId: '39', name: 'League' },
    team: { externalId: '33', name: 'Home' },
    seasonYear: 2026,
    played: { home: 19, away: 19 },
    wins: { home: 13, away: 7 },
    draws: { home: 3, away: 8 },
    losses: { home: 3, away: 4 },
    goalsFor: { home: 39, away: 30 },
    goalsAgainst: { home: 24, away: 26 },
    cleanSheets: { home: 4, away: 4 },
    failedToScore: { home: 2, away: null },
    form: 'WDLWW',
    goalsForByMinute: [{ from: 0, to: 15, goals: 9 }],
    goalsAgainstByMinute: [{ from: 76, to: 90, goals: 15 }],
    bandsWithheld: false,
    penaltiesScored: 4,
    penaltiesMissed: 0,
    biggestWin: { home: { for: 4, against: 2 }, away: null },
    biggestDefeat: { home: null, away: { for: 0, against: 3 } },
    longestRun: { wins: 4, draws: 3, losses: 1 },
    formations: [{ formation: '4-2-3-1', played: 20 }],
    ...over,
  };
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the team seasons store', () => {
  let pool: Pool;
  let store: TeamSeasonStore;
  const id = {
    league: randomUUID(),
    current: randomUUID(),
    past: randomUUID(),
    home: randomUUID(),
    away: randomUUID(),
    unmapped: randomUUID(),
    fixtures: [randomUUID(), randomUUID(), randomUUID()],
    later: randomUUID(),
  };
  const teams: string[] = [id.home, id.away, id.unmapped];
  const ext = (n: string) => `t1437-${RUN}-${n}`;
  const at = (
    over: Partial<Record<'settledBeforeIso' | 'refreshBeforeIso' | 'retryBeforeIso', string>> = {},
  ) => ({
    settledBeforeIso: LATER,
    refreshBeforeIso: EARLIER,
    retryBeforeIso: EARLIER,
    ...over,
  });
  const due = async (over = {}, maxFailures = 5) =>
    (await store.due(PROVIDER, at(over), maxFailures, 50_000)).filter((a) =>
      teams.includes(a.teamId),
    );
  const pairs = (asks: TeamSeasonAsk[]) => asks.map((a) => [a.teamId, a.seasonId]);
  const ask = (teamId: string, seasonId: string): TeamSeasonAsk => ({
    teamId,
    seasonId,
    teamExternalId: ext(teamId === id.home ? 'home' : 'away'),
    competitionExternalId: ext('league'),
    seasonLabel: seasonId === id.current ? '2026/27' : '2024/25',
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new TeamSeasonStore(pool);
    await pool.query(
      `INSERT INTO competition (id, name, kind, scope, gender)
         VALUES ($1, 'T-1437 League', 'league', 'international', 'men')`,
      [id.league],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
         ($1, $3, '2026/27', '2026-08-01', '2027-05-31', true),
         ($2, $3, '2024/25', '2024-08-01', '2025-05-31', false)`,
      [id.current, id.past, id.league],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES
         ($1, 'T-1437 Home', 'club', 'men'), ($2, 'T-1437 Away', 'club', 'men'),
         ($3, 'T-1437 Unmapped', 'club', 'men')`,
      teams,
    );
    const mappings: [string, string, string][] = [
      ['competition', ext('league'), id.league],
      ['team', ext('home'), id.home],
      ['team', ext('away'), id.away],
    ];
    for (const [type, external, internal] of mappings) {
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
           VALUES ('api_football', $1, $2, $3)`,
        [type, external, internal],
      );
    }
    // Two days ago by the database's clock (the answers are stamped with it):
    // home v away this season, home v unmapped this season, home v away in 2024.
    const [f1, f2, f3] = id.fixtures;
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES
         ($1, $4, now() - interval '2 days', 'finished'),
         ($2, $4, now() - interval '3 days', 'finished'),
         ($3, $5, '2025-03-01T15:00:00Z', 'finished')`,
      [f1, f2, f3, id.current, id.past],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES
         ($1, $4, 'home'), ($1, $5, 'away'),
         ($2, $4, 'home'), ($2, $6, 'away'),
         ($3, $4, 'home'), ($3, $5, 'away')`,
      [f1, f2, f3, id.home, id.away, id.unmapped],
    );
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [
      [...id.fixtures, id.later],
    ]);
    await pool.query(`DELETE FROM provider_mapping WHERE external_id LIKE $1`, [`t1437-${RUN}-%`]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [[id.current, id.past]]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [id.league]);
    await pool.end();
  });

  it('owes an ask to each mapped team with a settled match, current seasons first', async () => {
    expect(await due({ settledBeforeIso: EARLIER })).toEqual([]);
    const asks = await due();
    expect(pairs(asks.slice(0, 2)).sort()).toEqual(
      [
        [id.home, id.current],
        [id.away, id.current],
      ].sort(),
    );
    expect(pairs(asks.slice(2)).sort()).toEqual(
      [
        [id.home, id.past],
        [id.away, id.past],
      ].sort(),
    );
    expect(asks.find((a) => a.teamId === id.home && a.seasonId === id.current)).toEqual(
      ask(id.home, id.current),
    );
  });

  it('stores an answer whole, and the season is not owed again until a week or a match', async () => {
    await store.save(PROVIDER, ask(id.home, id.current), teamStats(), '2026-10-21T10:00:00Z');
    await store.save(PROVIDER, ask(id.home, id.past), teamStats(), '2026-10-21T10:00:00Z');
    const { rows } = await pool.query(
      `SELECT played_home, failed_to_score_away, form, goals_for_by_minute, bands_withheld,
                penalties_scored, biggest, formations
           FROM team_season_stat WHERE team_id = $1 AND season_id = $2`,
      [id.home, id.current],
    );
    expect(rows).toEqual([
      {
        played_home: 19,
        failed_to_score_away: null,
        form: 'WDLWW',
        goals_for_by_minute: [{ from: 0, to: 15, goals: 9 }],
        bands_withheld: false,
        penalties_scored: 4,
        biggest: {
          win: { home: { for: 4, against: 2 }, away: null },
          defeat: { home: null, away: { for: 0, against: 3 } },
          run: { wins: 4, draws: 3, losses: 1 },
        },
        formations: [{ formation: '4-2-3-1', played: 20 }],
      },
    ]);
    const owed = pairs(await due());
    expect(owed).not.toContainEqual([id.home, id.current]);
    expect(owed).not.toContainEqual([id.home, id.past]);
    // A week on, the current season is owed again; the past one never.
    const weekly = pairs(await due({ refreshBeforeIso: LATER }));
    expect(weekly).toContainEqual([id.home, id.current]);
    expect(weekly).not.toContainEqual([id.home, id.past]);
  });

  it('owes a current season again after a match the team played', async () => {
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status)
         VALUES ($1, $2, now() + interval '1 hour', 'finished')`,
      [id.later, id.current],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id.later, id.home, id.unmapped],
    );
    expect(pairs(await due())).toContainEqual([id.home, id.current]);
    // Not before the match has settled.
    const settled = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(pairs(await due({ settledBeforeIso: settled }))).not.toContainEqual([
      id.home,
      id.current,
    ]);
  });

  it('replaces the row with nothing when the provider has no statistics any more', async () => {
    await store.save(PROVIDER, ask(id.home, id.current), null, '2026-10-21T11:00:00Z');
    const stat = await pool.query(
      `SELECT 1 FROM team_season_stat WHERE team_id = $1 AND season_id = $2`,
      [id.home, id.current],
    );
    expect(stat.rowCount).toBe(0);
    const fetch = await pool.query<{ supplied: boolean; failures: number }>(
      `SELECT supplied, failures FROM team_season_fetch WHERE team_id = $1 AND season_id = $2`,
      [id.home, id.current],
    );
    expect(fetch.rows).toEqual([{ supplied: false, failures: 0 }]);
  });

  it('withholds bands and penalties together, as the schema demands', async () => {
    await expect(
      pool.query(
        `UPDATE team_season_stat SET bands_withheld = true WHERE team_id = $1 AND season_id = $2`,
        [id.home, id.past],
      ),
    ).rejects.toThrow(/team_season_stat_withheld/);
    await store.save(
      PROVIDER,
      ask(id.home, id.past),
      teamStats({
        bandsWithheld: true,
        goalsForByMinute: null,
        goalsAgainstByMinute: null,
        penaltiesScored: null,
        penaltiesMissed: null,
      }),
      '2026-10-21T10:00:00Z',
    );
    const { rows } = await pool.query(
      `SELECT bands_withheld FROM team_season_stat WHERE team_id = $1 AND season_id = $2`,
      [id.home, id.past],
    );
    expect(rows).toEqual([{ bands_withheld: true }]);
  });

  it('asks an unanswered season again after the retry wait, and gives up after the most failures', async () => {
    const away = ask(id.away, id.past);
    await store.markAsked(PROVIDER, away);
    expect(pairs(await due())).not.toContainEqual([id.away, id.past]);
    expect(pairs(await due({ retryBeforeIso: LATER }))).toContainEqual([id.away, id.past]);
    await store.markAsked(PROVIDER, away);
    expect(pairs(await due({ retryBeforeIso: LATER }, 2))).not.toContainEqual([id.away, id.past]);
  });

  it('accepts a team_seasons run in the job log', async () => {
    const { rows } = await pool.query<{ ok: boolean }>(
      `SELECT pg_get_constraintdef(oid) LIKE '%''team_seasons''%' AS ok
           FROM pg_constraint WHERE conname = 'ingest_run_job_check'`,
    );
    expect(rows).toEqual([{ ok: true }]);
  });
});
