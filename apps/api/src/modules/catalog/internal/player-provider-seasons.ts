import type {
  CoverageState,
  PlayerProviderCareerTeam,
  PlayerProviderSeasonLine,
  PlayerProviderSeasons,
} from '@fmip/contracts';
import type { Pool } from 'pg';

/**
 * The player page's provider seasons and career (T-1431, D-223), read from
 * what the `player_seasons` job stored. Reads only.
 */

/** The name a reader is shown for each source the job writes. */
const SOURCE_NAMES: Record<string, string> = { api_football: 'API-Football' };
const SOURCE = 'api_football';

/**
 * The state of one part: nothing until the provider answered, `limited` when
 * its answer named competitions or teams we do not hold (left out, counted),
 * else `available`. Pure.
 */
export function providerCoverage(answeredAt: Date | null, unlisted: number): CoverageState {
  if (answeredAt === null) return 'not_supplied';
  return unlisted > 0 ? 'limited' : 'available';
}

/** The first four digits of a season label, as SQL: "2026/27" and "2026" are both 2026. */
const LABEL_YEAR = `substring(x.label FROM '^[0-9]{4}')`;

export async function readProviderSeasons(
  pool: Pool,
  personId: string,
): Promise<PlayerProviderSeasons> {
  const seasonFetch = await pool.query<{
    season_year: number;
    answered_at: Date;
    unmapped: number;
  }>(
    `SELECT season_year, answered_at, unmapped FROM player_season_fetch
      WHERE person_id = $1 AND provider = $2 AND answered_at IS NOT NULL
      ORDER BY season_year DESC LIMIT 1`,
    [personId, SOURCE],
  );
  const careerFetch = await pool.query<{ answered_at: Date; unmapped: number }>(
    `SELECT answered_at, unmapped FROM player_career_fetch
      WHERE person_id = $1 AND provider = $2 AND answered_at IS NOT NULL`,
    [personId, SOURCE],
  );
  const s = seasonFetch.rows[0];
  const c = careerFetch.rows[0];
  const seasons: PlayerProviderSeasons['seasons'] =
    s === undefined
      ? { coverage: 'not_supplied', last_updated_at: null, data: null }
      : {
          coverage: providerCoverage(s.answered_at, s.unmapped),
          last_updated_at: s.answered_at.toISOString(),
          data: { lines: await seasonLines(pool, personId, s.season_year), unlisted: s.unmapped },
        };
  const career: PlayerProviderSeasons['career'] =
    c === undefined
      ? { coverage: 'not_supplied', last_updated_at: null, data: null }
      : {
          coverage: providerCoverage(c.answered_at, c.unmapped),
          last_updated_at: c.answered_at.toISOString(),
          data: { teams: await careerTeams(pool, personId), unlisted: c.unmapped },
        };
  return { source_name: SOURCE_NAMES[SOURCE] ?? SOURCE, seasons, career };
}

/**
 * The provider's lines for one season: the ones our own record does not count
 * first, then by appearances. `counted_by_us` is whether our own record holds
 * this player's line-ups in that competition's season -- then the record,
 * from the matches, is the authority there.
 */
async function seasonLines(
  pool: Pool,
  personId: string,
  seasonYear: number,
): Promise<PlayerProviderSeasonLine[]> {
  const { rows } = await pool.query<{
    season_year: number;
    season_label: string | null;
    competition_id: string;
    competition_name: string;
    competition_short_name: string | null;
    team_id: string;
    team_name: string;
    team_short_name: string | null;
    counted_by_us: boolean;
    appearances: number;
    starts: number | null;
    minutes: number | null;
    goals: number | null;
    assists: number | null;
    yellow_cards: number | null;
    second_yellow_cards: number | null;
    red_cards: number | null;
    saves: number | null;
    goals_conceded: number | null;
    rating: number | null;
  }>(
    `SELECT s.season_year, se.label AS season_label,
            c.id AS competition_id, c.name AS competition_name,
            c.short_name AS competition_short_name,
            t.id AS team_id, t.name AS team_name, t.short_name AS team_short_name,
            EXISTS (SELECT 1 FROM season x
                      JOIN fixture f ON f.season_id = x.id
                      JOIN fixture_participant fp ON fp.fixture_id = f.id
                      JOIN lineup l ON l.participant_id = fp.id AND l.person_id = s.person_id
                     WHERE x.competition_id = s.competition_id
                       AND ${LABEL_YEAR} = s.season_year::text) AS counted_by_us,
            s.appearances, s.starts, s.minutes, s.goals, s.assists, s.yellow_cards,
            s.second_yellow_cards, s.red_cards, s.saves, s.goals_conceded,
            s.rating::float8 AS rating
       FROM player_season_stat s
       JOIN competition c ON c.id = s.competition_id
       JOIN team t ON t.id = s.team_id
       LEFT JOIN LATERAL (
         SELECT x.label FROM season x
          WHERE x.competition_id = s.competition_id AND ${LABEL_YEAR} = s.season_year::text
          ORDER BY x.start_date DESC LIMIT 1
       ) se ON TRUE
      WHERE s.person_id = $1 AND s.source = $2 AND s.season_year = $3
      ORDER BY counted_by_us, s.appearances DESC, c.name, t.name`,
    [personId, SOURCE, seasonYear],
  );
  return rows.map((r) => ({
    season: { year: r.season_year, label: r.season_label },
    competition: {
      id: r.competition_id,
      name: r.competition_name,
      short_name: r.competition_short_name,
    },
    team: { id: r.team_id, name: r.team_name, short_name: r.team_short_name },
    counted_by_us: r.counted_by_us,
    appearances: r.appearances,
    starts: r.starts,
    minutes: r.minutes,
    goals: r.goals,
    assists: r.assists,
    yellow_cards: r.yellow_cards,
    second_yellow_cards: r.second_yellow_cards,
    red_cards: r.red_cards,
    saves: r.saves,
    goals_conceded: r.goals_conceded,
    rating: r.rating,
  }));
}

/** Each team once, with its seasons newest first; the most recent team first. */
async function careerTeams(pool: Pool, personId: string): Promise<PlayerProviderCareerTeam[]> {
  const { rows } = await pool.query<{
    team_id: string;
    team_name: string;
    team_short_name: string | null;
    season_years: number[];
  }>(
    `SELECT t.id AS team_id, t.name AS team_name, t.short_name AS team_short_name,
            array_agg(cs.season_year::int ORDER BY cs.season_year DESC) AS season_years
       FROM player_career_season cs
       JOIN team t ON t.id = cs.team_id
      WHERE cs.person_id = $1 AND cs.source = $2
      GROUP BY t.id
      ORDER BY max(cs.season_year) DESC, min(cs.season_year) DESC, t.name`,
    [personId, SOURCE],
  );
  return rows.map((r) => ({
    team: { id: r.team_id, name: r.team_name, short_name: r.team_short_name },
    season_years: r.season_years,
  }));
}
