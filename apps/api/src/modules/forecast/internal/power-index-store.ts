/**
 * What the Power Index needs from the database (T-111).
 *
 * All the SQL, none of the arithmetic. Two sources, and they are kept apart on
 * purpose: the **training store** supplies the match history the components are
 * measured against (it is the only place we hold enough seasons to place a team
 * in a distribution), while **our own fixture table** supplies the schedule,
 * because rest is a fact about the real calendar and not about history.
 *
 * Teams cross between the two through `training.team_alias`, which maps a
 * catalog UUID to the name the training data uses for that division (T-063).
 * Never by name (rule 1): a team with no alias is a team we cannot measure, and
 * the caller says so rather than guessing at a spelling.
 */

import type { Pool } from 'pg';
import type { HistoryMatch, RestInput } from './power-index-measure';

export interface IndexSubject {
  fixtureId: string;
  kickoffAt: Date;
  division: string | null;
  home: { participantId: string; teamId: string; name: string };
  away: { participantId: string; teamId: string; name: string };
}

export class PowerIndexStore {
  constructor(private readonly pool: Pool) {}

  /** The fixture, both participants, and the division its competition maps to. */
  async subject(fixtureId: string): Promise<IndexSubject | null> {
    const { rows } = await this.pool.query<{
      kickoff_at: Date;
      division: string | null;
      home_participant: string;
      home_team: string;
      home_name: string;
      away_participant: string;
      away_team: string;
      away_name: string;
    }>(
      `SELECT f.kickoff_at, c.football_data_division AS division,
              hp.id AS home_participant, hp.team_id AS home_team, ht.name AS home_name,
              ap.id AS away_participant, ap.team_id AS away_team, at.name AS away_name
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN fixture_participant hp ON hp.fixture_id = f.id AND hp.side = 'home'
         JOIN fixture_participant ap ON ap.fixture_id = f.id AND ap.side = 'away'
         JOIN team ht ON ht.id = hp.team_id
         JOIN team at ON at.id = ap.team_id
        WHERE f.id = $1`,
      [fixtureId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      fixtureId,
      kickoffAt: row.kickoff_at,
      division: row.division,
      home: { participantId: row.home_participant, teamId: row.home_team, name: row.home_name },
      away: { participantId: row.away_participant, teamId: row.away_team, name: row.away_name },
    };
  }

  /** The name this team goes by in the training data for this division, or `null`. */
  async trainingName(teamId: string, division: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ training_name: string }>(
      `SELECT training_name FROM training.team_alias WHERE team_id = $1 AND division = $2`,
      [teamId, division],
    );
    return rows[0]?.training_name ?? null;
  }

  /**
   * Every finished match of the division before this kick-off, newest first.
   *
   * Before the kick-off, not simply "recent": an index computed for a match is
   * a statement about what was knowable then, and a window that reached past it
   * would make yesterday's index unreproducible tomorrow (rule 5's point).
   */
  async history(division: string, before: Date, limit = 400): Promise<HistoryMatch[]> {
    const { rows } = await this.pool.query<{
      match_date: Date;
      home_team: string;
      away_team: string;
      home_goals: number;
      away_goals: number;
    }>(
      `SELECT match_date, home_team, away_team, home_goals, away_goals
         FROM training.match
        WHERE division = $1 AND match_date < $2
        ORDER BY match_date DESC
        LIMIT $3`,
      [division, before, limit],
    );
    return rows.map((row) => ({
      date: row.match_date.toISOString().slice(0, 10),
      home: row.home_team,
      away: row.away_team,
      homeGoals: row.home_goals,
      awayGoals: row.away_goals,
    }));
  }

  /**
   * The team's real schedule before this kick-off: how long since it last
   * played, and how many matches it has had in the congestion window.
   *
   * From our own fixtures, in any competition — congestion that comes from a
   * cup replay is congestion all the same, which is the whole point of the
   * component.
   */
  async rest(teamId: string, kickoffAt: Date, windowDays: number): Promise<RestInput> {
    const { rows } = await this.pool.query<{ previous: Date | null; in_window: string }>(
      `SELECT
         (SELECT max(f.kickoff_at)
            FROM fixture f
            JOIN fixture_participant p ON p.fixture_id = f.id
           WHERE p.team_id = $1 AND f.kickoff_at < $2
             AND f.status IN ('finished', 'live', 'awarded')) AS previous,
         (SELECT count(*)
            FROM fixture f
            JOIN fixture_participant p ON p.fixture_id = f.id
           WHERE p.team_id = $1 AND f.kickoff_at < $2
             AND f.kickoff_at >= $2::timestamptz - ($3 || ' days')::interval
             AND f.status IN ('finished', 'live', 'awarded')) AS in_window`,
      [teamId, kickoffAt, windowDays],
    );
    const row = rows[0];
    const previous = row?.previous ?? null;
    return {
      daysSincePrevious:
        previous === null
          ? null
          : Math.floor((kickoffAt.getTime() - previous.getTime()) / (24 * 60 * 60 * 1000)),
      matchesInWindow: Number(row?.in_window ?? 0),
    };
  }

  /** Writes one computed index. The table refuses a rewrite (rule 5). */
  async record(input: {
    participantId: string;
    formulaVersion: string;
    value: number;
    completeness: number;
    components: unknown;
    inputsHash: string;
    computedAt: Date;
  }): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO power_index
         (participant_id, formula_version, value, completeness, components, inputs_hash, computed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (participant_id, formula_version, computed_at) DO NOTHING
       RETURNING id`,
      [
        input.participantId,
        input.formulaVersion,
        input.value,
        input.completeness,
        JSON.stringify(input.components),
        input.inputsHash,
        input.computedAt,
      ],
    );
    return rows[0]?.id ?? '';
  }

  /** The newest index for each side of a fixture, under one formula version. */
  async latest(
    fixtureId: string,
    formulaVersion: string,
  ): Promise<{ side: 'home' | 'away'; row: PowerIndexRow }[]> {
    const { rows } = await this.pool.query<PowerIndexRow & { side: 'home' | 'away' }>(
      `SELECT DISTINCT ON (p.side)
              p.side, pi.value, pi.completeness, pi.components, pi.formula_version,
              pi.computed_at, t.id AS team_id, t.name AS team_name
         FROM power_index pi
         JOIN fixture_participant p ON p.id = pi.participant_id
         JOIN team t ON t.id = p.team_id
        WHERE p.fixture_id = $1 AND pi.formula_version = $2
        ORDER BY p.side, pi.computed_at DESC`,
      [fixtureId, formulaVersion],
    );
    return rows.map((row) => ({ side: row.side, row }));
  }
}

export interface PowerIndexRow {
  value: string;
  completeness: string;
  components: unknown;
  formula_version: string;
  computed_at: Date;
  team_id: string;
  team_name: string;
}
