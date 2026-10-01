import { Inject, Injectable } from '@nestjs/common';
import type { CoverageState, Leader, TableRow } from '@fmip/contracts';

import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { Result } from './table';

/** A leader as the standings boundary knows it: goals, not minutes (T-824 adds those in the catalog). */
export type Scorer = Omit<Leader, 'minutes'>;

/** A row of a board beyond goals (T-943) before the catalog adds minutes. */
export type BoardRow<T> = {
  person: { id: string; name: string };
  team: { id: string; name: string } | null;
} & T;

type RawBoardRow = {
  person_id: string;
  person_name: string;
  team_id: string | null;
  team_name: string | null;
  updated_at: Date;
};

function boardRow(r: RawBoardRow): BoardRow<object> {
  return {
    person: { id: r.person_id, name: r.person_name },
    team: r.team_id !== null && r.team_name !== null ? { id: r.team_id, name: r.team_name } : null,
  };
}

function latest(rows: { updated_at: Date | null }[]): string | null {
  let last: Date | null = null;
  for (const r of rows)
    if (r.updated_at !== null && (last === null || r.updated_at > last)) last = r.updated_at;
  return last === null ? null : last.toISOString();
}

/**
 * SQL for the standings boundary (D-025). Everything here reads what the
 * fixtures boundary stores; nothing is written.
 */
@Injectable()
export class PostgresStandingsStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Finished league-stage results of a season with their full-time score:
   * fixtures whose stage is a league (or, in a league competition, fixtures
   * with no stage), status `finished`, a `full_time` score row present.
   */
  async leagueResults(
    seasonId: string,
    before: string | null = null,
  ): Promise<{ results: Result[]; lastUpdatedAt: string | null }> {
    return this.results(
      `f.season_id = $1 AND (st.kind = 'league' OR (f.stage_id IS NULL AND c.kind = 'league'))`,
      [seasonId],
      before,
    );
  }

  /**
   * Finished results of one group of a group stage (T-840): the stage's
   * fixtures carrying that group's name.
   */
  async groupResults(
    stageId: string,
    groupName: string,
    before: string | null,
  ): Promise<{ results: Result[]; lastUpdatedAt: string | null }> {
    return this.results(`f.stage_id = $1 AND f.group_name = $2`, [stageId, groupName], before);
  }

  /**
   * The groups of a season's group stages (T-1333): each stage and group name
   * its fixtures carry. A fixture with no group is in none of them.
   */
  async seasonGroups(seasonId: string): Promise<{ stageId: string; name: string }[]> {
    const { rows } = await this.pool.query<{ stage_id: string; group_name: string }>(
      `SELECT DISTINCT f.stage_id, f.group_name
         FROM fixture f
         JOIN stage st ON st.id = f.stage_id AND st.kind = 'group'
        WHERE f.season_id = $1 AND f.group_name IS NOT NULL
        ORDER BY f.stage_id, f.group_name`,
      [seasonId],
    );
    return rows.map((r) => ({ stageId: r.stage_id, name: r.group_name }));
  }

  /** Every team of one group, finished or not. */
  async groupParticipants(stageId: string, groupName: string): Promise<TableRow['team'][]> {
    const { rows } = await this.pool.query<{ id: string; name: string; short_name: string | null }>(
      `SELECT DISTINCT t.id, t.name, t.short_name
         FROM fixture f
         JOIN fixture_participant p ON p.fixture_id = f.id
         JOIN team t ON t.id = p.team_id
        WHERE f.stage_id = $1 AND f.group_name = $2
        ORDER BY t.name`,
      [stageId, groupName],
    );
    return rows;
  }

  /**
   * Finished results matching `where` (over `f`, `c` and `st`) with their
   * full-time score, kicked off before `before` when one is given.
   */
  private async results(
    where: string,
    params: unknown[],
    before: string | null,
  ): Promise<{ results: Result[]; lastUpdatedAt: string | null }> {
    const at = params.length + 1;
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      updated_at: Date;
      home_id: string;
      home_name: string;
      home_short_name: string | null;
      away_id: string;
      away_name: string;
      away_short_name: string | null;
      home_goals: number;
      away_goals: number;
    }>(
      `SELECT f.id, f.kickoff_at, GREATEST(f.updated_at, sc.updated_at) AS updated_at,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              sc.home AS home_goals, sc.away AS away_goals
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN stage st ON st.id = f.stage_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
        WHERE ${where}
          AND f.status = 'finished'
          AND ($${at}::timestamptz IS NULL OR f.kickoff_at < $${at}::timestamptz)
        ORDER BY f.kickoff_at, f.id`,
      [...params, before],
    );
    let last: Date | null = null;
    for (const r of rows) if (last === null || r.updated_at > last) last = r.updated_at;
    return {
      lastUpdatedAt: last === null ? null : last.toISOString(),
      results: rows.map((r) => ({
        fixtureId: r.id,
        kickoffAt: r.kickoff_at.toISOString(),
        home: { id: r.home_id, name: r.home_name, shortName: r.home_short_name },
        away: { id: r.away_id, name: r.away_name, shortName: r.away_short_name },
        homeGoals: r.home_goals,
        awayGoals: r.away_goals,
      })),
    };
  }

  /** Every team that appears in a league-stage fixture of the season, finished or not. */
  async leagueParticipants(seasonId: string): Promise<TableRow['team'][]> {
    const { rows } = await this.pool.query<{ id: string; name: string; short_name: string | null }>(
      `SELECT DISTINCT t.id, t.name, t.short_name
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN stage st ON st.id = f.stage_id
         JOIN fixture_participant p ON p.fixture_id = f.id
         JOIN team t ON t.id = p.team_id
        WHERE f.season_id = $1
          AND (st.kind = 'league' OR (f.stage_id IS NULL AND c.kind = 'league'))
        ORDER BY t.name`,
      [seasonId],
    );
    return rows;
  }

  /**
   * Goals (open play and penalties; own goals are not the scorer's) per person
   * in the season; every scorer when `limit` is null.
   */
  async scorers(
    seasonId: string,
    limit: number | null,
  ): Promise<{ leaders: Scorer[]; lastUpdatedAt: string | null }> {
    const { rows } = await this.pool.query<{
      person_id: string;
      person_name: string;
      team_id: string | null;
      team_name: string | null;
      goals: string;
      updated_at: Date;
    }>(
      `SELECT i.person_id, COALESCE(pe.known_as, pe.full_name) AS person_name,
              p.team_id, t.name AS team_name,
              count(*)::text AS goals, max(i.updated_at) AS updated_at
         FROM incident i
         JOIN fixture f ON f.id = i.fixture_id
         JOIN person pe ON pe.id = i.person_id
         LEFT JOIN fixture_participant p ON p.id = i.participant_id
         LEFT JOIN team t ON t.id = p.team_id
        WHERE f.season_id = $1
          AND i.kind IN ('goal', 'penalty_goal')
          AND i.person_id IS NOT NULL
        GROUP BY i.person_id, person_name, p.team_id, t.name
        ORDER BY count(*) DESC, person_name ASC
        LIMIT $2`,
      [seasonId, limit],
    );
    let last: Date | null = null;
    for (const r of rows) if (last === null || r.updated_at > last) last = r.updated_at;
    return {
      lastUpdatedAt: last === null ? null : last.toISOString(),
      leaders: rows.map((r) => ({
        person: { id: r.person_id, name: r.person_name },
        team:
          r.team_id !== null && r.team_name !== null ? { id: r.team_id, name: r.team_name } : null,
        goals: Number(r.goals),
      })),
    };
  }

  /**
   * Assists per person and team in the season (T-943): the `related_person_id`
   * of a goal or penalty goal, credited to the scoring side. `goals` and
   * `assisted` count the season's goals and how many of them name an
   * assist, so a season whose feed never names one can say so.
   */
  async assisters(seasonId: string): Promise<{
    rows: BoardRow<{ assists: number }>[];
    goals: number;
    assisted: number;
    lastUpdatedAt: string | null;
  }> {
    const [{ rows }, totals] = await Promise.all([
      this.pool.query<RawBoardRow & { assists: string }>(
        `SELECT i.related_person_id AS person_id, COALESCE(pe.known_as, pe.full_name) AS person_name,
                p.team_id, t.name AS team_name,
                count(*)::text AS assists, max(i.updated_at) AS updated_at
           FROM incident i
           JOIN fixture f ON f.id = i.fixture_id
           JOIN person pe ON pe.id = i.related_person_id
           LEFT JOIN fixture_participant p ON p.id = i.participant_id
           LEFT JOIN team t ON t.id = p.team_id
          WHERE f.season_id = $1
            AND i.kind IN ('goal', 'penalty_goal')
            AND i.related_person_id IS NOT NULL
          GROUP BY i.related_person_id, person_name, p.team_id, t.name
          ORDER BY count(*) DESC, person_name ASC`,
        [seasonId],
      ),
      this.pool.query<{ goals: string; assisted: string; updated_at: Date | null }>(
        `SELECT count(*)::text AS goals,
                count(*) FILTER (WHERE i.related_person_id IS NOT NULL)::text AS assisted,
                max(i.updated_at) AS updated_at
           FROM incident i
           JOIN fixture f ON f.id = i.fixture_id
          WHERE f.season_id = $1 AND i.kind IN ('goal', 'penalty_goal')`,
        [seasonId],
      ),
    ]);
    const t = totals.rows[0]!;
    return {
      rows: rows.map((r) => ({ ...boardRow(r), assists: Number(r.assists) })),
      goals: Number(t.goals),
      assisted: Number(t.assisted),
      lastUpdatedAt: t.updated_at === null ? null : t.updated_at.toISOString(),
    };
  }

  /**
   * Cards per person and team in the season (T-943): `yellow_card` is a
   * yellow; `red_card` and `second_yellow_card` are reds, as the player page
   * counts them. Ranked by reds, then yellows, then name.
   */
  async booked(seasonId: string): Promise<{
    rows: BoardRow<{ yellow_cards: number; red_cards: number }>[];
    lastUpdatedAt: string | null;
  }> {
    const { rows } = await this.pool.query<
      RawBoardRow & { yellow_cards: string; red_cards: string }
    >(
      `SELECT i.person_id, COALESCE(pe.known_as, pe.full_name) AS person_name,
              p.team_id, t.name AS team_name,
              count(*) FILTER (WHERE i.kind = 'yellow_card')::text AS yellow_cards,
              count(*) FILTER (WHERE i.kind IN ('red_card', 'second_yellow_card'))::text AS red_cards,
              max(i.updated_at) AS updated_at
         FROM incident i
         JOIN fixture f ON f.id = i.fixture_id
         JOIN person pe ON pe.id = i.person_id
         LEFT JOIN fixture_participant p ON p.id = i.participant_id
         LEFT JOIN team t ON t.id = p.team_id
        WHERE f.season_id = $1
          AND i.kind IN ('yellow_card', 'second_yellow_card', 'red_card')
          AND i.person_id IS NOT NULL
        GROUP BY i.person_id, person_name, p.team_id, t.name
        ORDER BY count(*) FILTER (WHERE i.kind IN ('red_card', 'second_yellow_card')) DESC,
                 count(*) FILTER (WHERE i.kind = 'yellow_card') DESC,
                 person_name ASC`,
      [seasonId],
    );
    return {
      rows: rows.map((r) => ({
        ...boardRow(r),
        yellow_cards: Number(r.yellow_cards),
        red_cards: Number(r.red_cards),
      })),
      lastUpdatedAt: latest(rows),
    };
  }

  /**
   * Clean sheets per goalkeeper and team in the season (T-943, D-118). A
   * side of a finished match with a score is judged when its line-up names
   * exactly one starter in goal. That keeper keeps a clean sheet when the
   * other side's latest score (`current`, else `full_time`: extra time
   * counts, a shoot-out does not) is nil and the keeper finished the match:
   * not substituted off, not sent off. `sides` and `judged` say how many
   * sides the season has and how many could be judged.
   */
  async keepers(seasonId: string): Promise<{
    rows: BoardRow<{ clean_sheets: number; starts_in_goal: number }>[];
    sides: number;
    judged: number;
    lastUpdatedAt: string | null;
  }> {
    const { rows } = await this.pool.query<{
      person_id: string | null;
      person_name: string | null;
      team_id: string;
      team_name: string;
      keepers: string;
      conceded: number | null;
      finished: boolean | null;
      updated_at: Date;
    }>(
      `WITH sides AS (
         SELECT f.id AS fixture_id, p.id AS participant_id, p.team_id, p.side,
                CASE WHEN p.side = 'home' THEN COALESCE(cur.away, ft.away)
                     ELSE COALESCE(cur.home, ft.home) END AS conceded,
                GREATEST(f.updated_at, COALESCE(cur.updated_at, ft.updated_at)) AS updated_at
           FROM fixture f
           JOIN fixture_participant p ON p.fixture_id = f.id
           LEFT JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
           LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
          WHERE f.season_id = $1 AND f.status = 'finished'
            AND (ft.id IS NOT NULL OR cur.id IS NOT NULL)
       ), keeper AS (
         SELECT l.participant_id, count(*) AS keepers, min(l.person_id::text)::uuid AS person_id,
                max(l.updated_at) AS updated_at
           FROM lineup l
           JOIN sides s ON s.participant_id = l.participant_id
          WHERE l.role = 'starter' AND l.position = 'goalkeeper'
          GROUP BY l.participant_id
       )
       SELECT CASE WHEN k.keepers = 1 THEN k.person_id END AS person_id,
              CASE WHEN k.keepers = 1 THEN COALESCE(pe.known_as, pe.full_name) END AS person_name,
              s.team_id, t.name AS team_name, COALESCE(k.keepers, 0)::text AS keepers,
              s.conceded,
              CASE WHEN k.keepers = 1 THEN NOT EXISTS (
                SELECT 1 FROM incident i
                 WHERE i.fixture_id = s.fixture_id AND i.person_id = k.person_id
                   AND i.kind IN ('substitution', 'red_card', 'second_yellow_card')) END AS finished,
              GREATEST(s.updated_at, k.updated_at) AS updated_at
         FROM sides s
         JOIN team t ON t.id = s.team_id
         LEFT JOIN keeper k ON k.participant_id = s.participant_id
         LEFT JOIN person pe ON pe.id = k.person_id`,
      [seasonId],
    );
    const byKeeper = new Map<string, BoardRow<{ clean_sheets: number; starts_in_goal: number }>>();
    let judged = 0;
    for (const r of rows) {
      if (r.person_id === null || r.person_name === null) continue;
      judged += 1;
      const key = `${r.person_id}:${r.team_id}`;
      const row = byKeeper.get(key) ?? {
        person: { id: r.person_id, name: r.person_name },
        team: { id: r.team_id, name: r.team_name },
        clean_sheets: 0,
        starts_in_goal: 0,
      };
      row.starts_in_goal += 1;
      if (r.conceded === 0 && r.finished === true) row.clean_sheets += 1;
      byKeeper.set(key, row);
    }
    const ranked = [...byKeeper.values()]
      .filter((r) => r.clean_sheets > 0)
      .sort(
        (a, b) =>
          b.clean_sheets - a.clean_sheets ||
          (a.person.name < b.person.name ? -1 : a.person.name > b.person.name ? 1 : 0),
      );
    return { rows: ranked, sides: rows.length, judged, lastUpdatedAt: latest(rows) };
  }

  /** What the season's coverage profile declares for one module, or null when nothing is declared. */
  async declared(seasonId: string, module: string): Promise<CoverageState | null> {
    const { rows } = await this.pool.query<{ state: CoverageState }>(
      `SELECT state FROM coverage_profile WHERE season_id = $1 AND module = $2`,
      [seasonId, module],
    );
    return rows[0]?.state ?? null;
  }
}
