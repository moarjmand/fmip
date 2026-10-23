import type {
  CoverageState,
  TeamSeasonCount,
  TeamSeasonScore,
  TeamSeasonStats,
  TeamSeasonStatsChoice,
  TeamSeasonStatsLine,
} from '@fmip/contracts';
import type { Pool } from 'pg';

/**
 * The team page's season statistics (T-1437, D-228), read from what the
 * `team_seasons` job stored. Reads only.
 */

/** The name a reader is shown for each source the job writes. */
const SOURCE_NAMES: Record<string, string> = { api_football: 'API-Football' };
const SOURCE = 'api_football';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored row, as `pg` returns it. */
export interface TeamSeasonStatRow {
  played_home: number | null;
  played_away: number | null;
  wins_home: number | null;
  wins_away: number | null;
  draws_home: number | null;
  draws_away: number | null;
  losses_home: number | null;
  losses_away: number | null;
  goals_for_home: number | null;
  goals_for_away: number | null;
  goals_against_home: number | null;
  goals_against_away: number | null;
  clean_sheets_home: number | null;
  clean_sheets_away: number | null;
  failed_to_score_home: number | null;
  failed_to_score_away: number | null;
  form: string | null;
  goals_for_by_minute: { from: number; to: number; goals: number }[] | null;
  goals_against_by_minute: { from: number; to: number; goals: number }[] | null;
  bands_withheld: boolean;
  penalties_scored: number | null;
  penalties_missed: number | null;
  biggest: {
    win?: { home?: TeamSeasonScore | null; away?: TeamSeasonScore | null };
    defeat?: { home?: TeamSeasonScore | null; away?: TeamSeasonScore | null };
    run?: { wins?: number | null; draws?: number | null; losses?: number | null };
  };
  formations: { formation: string; played: number }[];
  fetched_at: Date;
}

/** Home, away, and their sum when both are known. Pure. */
export function seasonCount(home: number | null, away: number | null): TeamSeasonCount {
  return { home, away, total: home === null || away === null ? null : home + away };
}

/** The stored row as the contract's line. Pure. */
export function toLine(r: TeamSeasonStatRow): TeamSeasonStatsLine {
  const b = r.biggest;
  return {
    played: seasonCount(r.played_home, r.played_away),
    wins: seasonCount(r.wins_home, r.wins_away),
    draws: seasonCount(r.draws_home, r.draws_away),
    losses: seasonCount(r.losses_home, r.losses_away),
    goals_for: seasonCount(r.goals_for_home, r.goals_for_away),
    goals_against: seasonCount(r.goals_against_home, r.goals_against_away),
    clean_sheets: seasonCount(r.clean_sheets_home, r.clean_sheets_away),
    failed_to_score: seasonCount(r.failed_to_score_home, r.failed_to_score_away),
    form: r.form,
    goals_for_by_minute: r.goals_for_by_minute,
    goals_against_by_minute: r.goals_against_by_minute,
    bands_withheld: r.bands_withheld,
    penalties: { scored: r.penalties_scored, missed: r.penalties_missed },
    biggest_win: { home: b.win?.home ?? null, away: b.win?.away ?? null },
    biggest_defeat: { home: b.defeat?.home ?? null, away: b.defeat?.away ?? null },
    longest_run: {
      wins: b.run?.wins ?? null,
      draws: b.run?.draws ?? null,
      losses: b.run?.losses ?? null,
    },
    formations: r.formations,
  };
}

/**
 * `available` when the provider gave the season whole; `limited` when its
 * minute bands were withheld, or any count, the form or the bands were left
 * out. Pure.
 */
export function lineCoverage(line: TeamSeasonStatsLine): CoverageState {
  const counts = [
    line.played,
    line.wins,
    line.draws,
    line.losses,
    line.goals_for,
    line.goals_against,
    line.clean_sheets,
    line.failed_to_score,
  ];
  const whole =
    !line.bands_withheld &&
    counts.every((c) => c.total !== null) &&
    line.form !== null &&
    line.goals_for_by_minute !== null &&
    line.goals_against_by_minute !== null &&
    line.penalties.scored !== null &&
    line.penalties.missed !== null;
  return whole ? 'available' : 'limited';
}

interface ChoiceRow {
  season_id: string;
  label: string;
  is_current: boolean;
  competition_id: string;
  competition_name: string;
  competition_short_name: string | null;
}

const toChoice = (r: ChoiceRow): TeamSeasonStatsChoice => ({
  season_id: r.season_id,
  label: r.label,
  is_current: r.is_current,
  competition: {
    id: r.competition_id,
    name: r.competition_name,
    short_name: r.competition_short_name,
  },
});

const CHOICE_COLUMNS = `se.id AS season_id, season_display_label(se.label, se.start_date) AS label, se.is_current,
  c.id AS competition_id, c.name AS competition_name, c.short_name AS competition_short_name`;

/** The seasons a team played a match in, current first, then newest. */
const PLAYED_SEASONS = `
  SELECT ${CHOICE_COLUMNS}
    FROM season se
    JOIN competition c ON c.id = se.competition_id
   WHERE EXISTS (SELECT 1 FROM fixture f
                   JOIN fixture_participant fp ON fp.fixture_id = f.id
                  WHERE f.season_id = se.id AND fp.team_id = $1)`;

export async function readTeamSeasonStats(
  pool: Pool,
  teamId: string,
  requestedSeasonId: string | null,
): Promise<TeamSeasonStats> {
  const choices = await pool.query<ChoiceRow>(
    `SELECT ${CHOICE_COLUMNS}
       FROM team_season_stat ts
       JOIN season se ON se.id = ts.season_id
       JOIN competition c ON c.id = se.competition_id
      WHERE ts.team_id = $1 AND ts.source = $2
      ORDER BY se.is_current DESC, se.start_date DESC,
               coalesce(ts.played_home, 0) + coalesce(ts.played_away, 0) DESC, c.name`,
    [teamId, SOURCE],
  );
  const seasons = choices.rows.map(toChoice);
  let selected: TeamSeasonStatsChoice | null = null;
  if (requestedSeasonId !== null && UUID.test(requestedSeasonId)) {
    const wanted = requestedSeasonId.toLowerCase();
    selected = seasons.find((s) => s.season_id === wanted) ?? null;
    if (selected === null) {
      const played = await pool.query<ChoiceRow>(`${PLAYED_SEASONS} AND se.id = $2`, [
        teamId,
        wanted,
      ]);
      selected = played.rows[0] === undefined ? null : toChoice(played.rows[0]);
    }
  }
  if (selected === null) selected = seasons[0] ?? null;
  if (selected === null) {
    const latest = await pool.query<ChoiceRow>(
      `${PLAYED_SEASONS} ORDER BY se.is_current DESC, se.start_date DESC, c.name LIMIT 1`,
      [teamId],
    );
    selected = latest.rows[0] === undefined ? null : toChoice(latest.rows[0]);
  }
  const source_name = SOURCE_NAMES[SOURCE] ?? SOURCE;
  const none = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
  if (selected === null) return { source_name, seasons, selected, asked: false, stats: none };

  const fetch = await pool.query<{ answered_at: Date | null }>(
    `SELECT answered_at FROM team_season_fetch
      WHERE provider = $1 AND team_id = $2 AND season_id = $3`,
    [SOURCE, teamId, selected.season_id],
  );
  const answeredAt = fetch.rows[0]?.answered_at ?? null;
  const stat = await pool.query<TeamSeasonStatRow>(
    `SELECT * FROM team_season_stat WHERE source = $1 AND team_id = $2 AND season_id = $3`,
    [SOURCE, teamId, selected.season_id],
  );
  const row = stat.rows[0];
  if (row === undefined) {
    return {
      source_name,
      seasons,
      selected,
      asked: answeredAt !== null,
      stats: { ...none, last_updated_at: answeredAt?.toISOString() ?? null },
    };
  }
  const line = toLine(row);
  return {
    source_name,
    seasons,
    selected,
    asked: true,
    stats: {
      coverage: lineCoverage(line),
      last_updated_at: row.fetched_at.toISOString(),
      data: line,
    },
  };
}
