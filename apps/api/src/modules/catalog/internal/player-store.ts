import { Inject, Injectable } from '@nestjs/common';
import type {
  Covered,
  PlayerAvailability,
  PlayerMatch,
  PlayerPage,
  PlayerPosition,
  PlayerSeasonMinutes,
  PlayerSeasonRecord,
  PlayerSpell,
  SquadPosition,
} from '@fmip/contracts';
import { absenceReason } from '@fmip/ingestion';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { mainPhaseSql, mainPhaseStartSql } from '../../../database/main-phase';

/**
 * The minutes of one season row (T-823): whole only when every match the
 * player played carries the feed's minutes; a partial sum is never `total`.
 */
export function seasonMinutes(
  matches: number,
  matchesWithMinutes: number,
  suppliedMinutes: number,
): PlayerSeasonMinutes {
  const coverage: PlayerSeasonMinutes['coverage'] =
    matchesWithMinutes >= matches
      ? 'available'
      : matchesWithMinutes === 0
        ? 'not_supplied'
        : 'limited';
  return {
    coverage,
    total: coverage === 'available' ? suppliedMinutes : null,
    matches,
    matches_with_minutes: matchesWithMinutes,
    supplied_minutes: suppliedMinutes,
  };
}

/**
 * Minutes for a player no line-up of ours names (T-824): nothing on record,
 * which is `not_supplied` with no matches -- never a total of zero, which
 * would say the player sat out a season we simply do not hold.
 */
export const NO_LINEUPS: PlayerSeasonMinutes = {
  coverage: 'not_supplied',
  total: null,
  matches: 0,
  matches_with_minutes: 0,
  supplied_minutes: 0,
};

/** One row of the availability query, before it is said (T-1007). */
export interface AvailabilityRow {
  team_id: string;
  team_name: string;
  team_short_name: string | null;
  basis: 'spell' | 'lineup';
  fixture_id: string | null;
  kickoff_at: Date | null;
  opponent_id: string | null;
  opponent_name: string | null;
  opponent_short_name: string | null;
  asked_at: Date | null;
  status: 'out' | 'doubtful' | null;
  kind: 'injury' | 'suspension' | 'illness' | 'other' | null;
  reason: string | null;
  reported_at: Date | null;
}

/**
 * What the player page says about availability (T-1007, D-127). Pure, for
 * tests. Nothing is said without a team, a scheduled match and an ask of the
 * feed for it; once asked, a player the feed does not list is "not listed"
 * (`not_listed`), never "fit" -- the feed never says fit (T-103).
 */
export function availabilityOf(row: AvailabilityRow | null): PlayerAvailability {
  const none = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;
  if (row === null) return { team: null, fixture: null, listing: none, reason: 'no_team' };
  const team = {
    id: row.team_id,
    name: row.team_name,
    short_name: row.team_short_name,
    basis: row.basis,
  };
  if (row.fixture_id === null || row.kickoff_at === null) {
    return { team, fixture: null, listing: none, reason: 'no_next_match' };
  }
  const fixture = {
    id: row.fixture_id,
    kickoff_at: row.kickoff_at.toISOString(),
    opponent:
      row.opponent_id === null || row.opponent_name === null
        ? null
        : { id: row.opponent_id, name: row.opponent_name, short_name: row.opponent_short_name },
  };
  const askedAt = row.asked_at ?? (row.status === null ? null : row.reported_at);
  if (askedAt === null) return { team, fixture, listing: none, reason: 'not_asked' };
  return {
    team,
    fixture,
    listing: {
      coverage: 'available',
      last_updated_at: askedAt.toISOString(),
      data: {
        status: row.status ?? 'not_listed',
        kind: row.status === null ? null : row.kind,
        reason: row.status === null ? null : row.reason,
        // The provider's words in ours, read at read time (T-1601): no backfill.
        reason_code: row.status === null ? null : absenceReason(row.reason),
        reported_at: row.status === null ? null : (row.reported_at?.toISOString() ?? null),
      },
    },
    reason: null,
  };
}

/**
 * SQL for the player page (T-037). Reads only; everything comes from
 * line-ups, incidents and spells, and minutes from the feed's per-player
 * statistics (T-823).
 */
@Injectable()
export class PostgresPlayerStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async person(id: string, locale: string | null = null): Promise<PlayerPage['person'] | null> {
    const { rows } = await this.pool.query<{
      id: string;
      full_name: string;
      known_as: string | null;
      localised_name: string | null;
      date_of_birth: string | null;
      height_cm: number | null;
      preferred_foot: PlayerPage['person']['preferred_foot'];
      nationality_id: string | null;
      nationality_name: string | null;
      nationality_code: string | null;
    }>(
      `SELECT p.id, p.full_name, p.known_as, localised_name('person', p.id, $2) AS localised_name,
              p.date_of_birth::text, p.height_cm, p.preferred_foot,
              co.id AS nationality_id, co.name AS nationality_name, co.code AS nationality_code
         FROM person p
         LEFT JOIN country co ON co.id = p.nationality_id
        WHERE p.id = $1`,
      [id, locale],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: r.id,
      full_name: r.full_name,
      known_as: r.known_as,
      localised_name: r.localised_name,
      date_of_birth: r.date_of_birth,
      nationality:
        r.nationality_id !== null && r.nationality_name !== null && r.nationality_code !== null
          ? { id: r.nationality_id, name: r.nationality_name, code: r.nationality_code }
          : null,
      height_cm: r.height_cm,
      preferred_foot: r.preferred_foot,
    };
  }

  /**
   * The row `availabilityOf` reads (T-1007, D-127): the player's team -- every
   * open spell's, else the team of the latest stored line-up naming them --
   * with its next scheduled match still ahead, whether the feed was asked
   * who misses it, and what it lists for this player. With several teams,
   * the one whose next match comes first. Null when there is no team.
   */
  async availability(personId: string): Promise<AvailabilityRow | null> {
    const { rows } = await this.pool.query<AvailabilityRow>(
      `WITH spell AS (
         SELECT DISTINCT ps.team_id, 'spell' AS basis
           FROM player_spell ps
          WHERE ps.person_id = $1 AND ps.end_date IS NULL
       ),
       lineup_team AS (
         SELECT fp.team_id, 'lineup' AS basis
           FROM lineup l
           JOIN fixture_participant fp ON fp.id = l.participant_id
           JOIN fixture f ON f.id = fp.fixture_id
          WHERE l.person_id = $1 AND NOT EXISTS (SELECT 1 FROM spell)
          ORDER BY f.kickoff_at DESC
          LIMIT 1
       ),
       chosen AS (SELECT * FROM spell UNION ALL SELECT * FROM lineup_team)
       SELECT c.team_id, t.name AS team_name, t.short_name AS team_short_name, c.basis,
              nx.id AS fixture_id, nx.kickoff_at,
              o.id AS opponent_id, o.name AS opponent_name, o.short_name AS opponent_short_name,
              ask.fetched_at AS asked_at,
              ab.status, ab.kind, ab.reason, ab.reported_at
         FROM chosen c
         JOIN team t ON t.id = c.team_id
         LEFT JOIN LATERAL (
           SELECT f.id, f.kickoff_at
             FROM fixture f
             JOIN fixture_participant p ON p.fixture_id = f.id AND p.team_id = c.team_id
            WHERE f.status = 'scheduled' AND f.kickoff_at > now()
            ORDER BY f.kickoff_at, f.id
            LIMIT 1
         ) nx ON TRUE
         LEFT JOIN LATERAL (
           SELECT op.team_id FROM fixture_participant op
            WHERE op.fixture_id = nx.id AND op.team_id <> c.team_id
            LIMIT 1
         ) opp ON TRUE
         LEFT JOIN team o ON o.id = opp.team_id
         LEFT JOIN fixture_availability_fetch ask ON ask.fixture_id = nx.id
         LEFT JOIN fixture_absence ab ON ab.fixture_id = nx.id AND ab.person_id = $1
        ORDER BY nx.kickoff_at ASC NULLS LAST, t.name, c.team_id
        LIMIT 1`,
      [personId],
    );
    return rows[0] ?? null;
  }

  /**
   * What our other records say the player's position is (T-1603), for a
   * player with no open spell naming one: the newest squad listing that names
   * one, and the position most often held in the last ten line-ups that name
   * one (ties to the most recent).
   */
  async positionSources(personId: string): Promise<PositionSources> {
    const [squad, lineup] = await Promise.all([
      this.pool.query<{ position: SquadPosition; listed_at: Date }>(
        `SELECT position, listed_at FROM team_squad_member
          WHERE person_id = $1 AND position IS NOT NULL
          ORDER BY listed_at DESC LIMIT 1`,
        [personId],
      ),
      this.pool.query<{ position: SquadPosition; newest: Date }>(
        `WITH recent AS (
           SELECT l.position, f.kickoff_at
             FROM lineup l
             JOIN fixture_participant p ON p.id = l.participant_id
             JOIN fixture f ON f.id = p.fixture_id
            WHERE l.person_id = $1 AND l.position IS NOT NULL
            ORDER BY f.kickoff_at DESC
            LIMIT 10)
         SELECT position, (SELECT max(kickoff_at) FROM recent) AS newest
           FROM recent
          GROUP BY position
          ORDER BY count(*) DESC, max(kickoff_at) DESC
          LIMIT 1`,
        [personId],
      ),
    ]);
    const s = squad.rows[0];
    const l = lineup.rows[0];
    return {
      squad: s === undefined ? null : { position: s.position, at: s.listed_at.toISOString() },
      lineup: l === undefined ? null : { position: l.position, at: l.newest.toISOString() },
    };
  }

  /** Newest first; an open spell (no end) before any closed one starting the same day. */
  async spells(personId: string): Promise<PlayerSpell[]> {
    const { rows } = await this.pool.query<{
      team_id: string;
      team_name: string;
      team_short_name: string | null;
      team_colour: string | null;
      start_date: string;
      end_date: string | null;
      shirt_number: number | null;
      position: PlayerSpell['position'];
      on_loan: boolean;
    }>(
      `SELECT t.id AS team_id, t.name AS team_name, t.short_name AS team_short_name,
              t.colour AS team_colour,
              ps.start_date::text, ps.end_date::text, ps.shirt_number, ps.position, ps.on_loan
         FROM player_spell ps JOIN team t ON t.id = ps.team_id
        WHERE ps.person_id = $1
        ORDER BY ps.start_date DESC, ps.end_date DESC NULLS FIRST`,
      [personId],
    );
    return rows.map((r) => ({
      team: {
        id: r.team_id,
        name: r.team_name,
        short_name: r.team_short_name,
        colour: r.team_colour,
      },
      start_date: r.start_date,
      end_date: r.end_date,
      shirt_number: r.shirt_number,
      position: r.position,
      on_loan: r.on_loan,
    }));
  }

  /**
   * One row per season, competition and team the player was named for:
   * starts, bench appearances that became a substitution on, goals (open play
   * and penalties), assists, cards — each counted only for the team of the
   * line-up, so a mid-season move gives two honest rows. Minutes (T-823):
   * over the matches the player played (a start, on from the bench, or
   * minutes above zero on record), how many carry the feed's `minutes` and
   * their sum; `seasonMinutes` turns that into a coverage state.
   */
  async record(personId: string): Promise<PlayerSeasonRecord[]> {
    const { rows } = await this.pool.query<{
      season_id: string;
      season_label: string;
      competition_id: string;
      competition_name: string;
      competition_short_name: string | null;
      team_id: string;
      team_name: string;
      starts: string;
      sub_appearances: string;
      goals: string;
      assists: string;
      yellow_cards: string;
      red_cards: string;
      matches_played: string;
      matches_with_minutes: string;
      supplied_minutes: string;
    }>(
      `WITH lined AS (
         SELECT f.id AS fixture_id, f.season_id, p.id AS participant_id, p.team_id, l.role,
                EXISTS (SELECT 1 FROM incident s
                         WHERE s.fixture_id = f.id AND s.kind = 'substitution'
                           AND s.related_person_id = l.person_id) AS came_on,
                m.value AS minutes
           FROM lineup l
           JOIN fixture_participant p ON p.id = l.participant_id
           JOIN fixture f ON f.id = p.fixture_id
           LEFT JOIN fixture_player_stat m
             ON m.participant_id = p.id AND m.person_id = l.person_id AND m.metric = 'minutes'
          WHERE l.person_id = $1
       ), named AS (
         SELECT lined.*,
                (lined.role = 'starter' OR lined.came_on OR COALESCE(lined.minutes, 0) > 0) AS played
           FROM lined
       ), counted AS (
         SELECT n.season_id, n.team_id,
                count(*) FILTER (WHERE n.role = 'starter') AS starts,
                count(*) FILTER (WHERE n.role = 'bench' AND n.came_on) AS sub_appearances,
                (SELECT count(*) FROM incident i
                  WHERE i.participant_id = ANY(array_agg(n.participant_id))
                    AND i.person_id = $1 AND i.kind IN ('goal', 'penalty_goal')) AS goals,
                (SELECT count(*) FROM incident i
                  WHERE i.participant_id = ANY(array_agg(n.participant_id))
                    AND i.related_person_id = $1 AND i.kind IN ('goal', 'penalty_goal')) AS assists,
                (SELECT count(*) FROM incident i
                  WHERE i.participant_id = ANY(array_agg(n.participant_id))
                    AND i.person_id = $1 AND i.kind = 'yellow_card') AS yellow_cards,
                (SELECT count(*) FROM incident i
                  WHERE i.participant_id = ANY(array_agg(n.participant_id))
                    AND i.person_id = $1 AND i.kind IN ('red_card', 'second_yellow_card')) AS red_cards,
                count(*) FILTER (WHERE n.played) AS matches_played,
                count(*) FILTER (WHERE n.played AND n.minutes IS NOT NULL) AS matches_with_minutes,
                COALESCE(sum(n.minutes) FILTER (WHERE n.played), 0) AS supplied_minutes
           FROM named n
          GROUP BY n.season_id, n.team_id
       )
       SELECT se.id AS season_id, season_display_label(se.label, se.start_date) AS season_label,
              c.id AS competition_id, c.name AS competition_name, c.short_name AS competition_short_name,
              t.id AS team_id, t.name AS team_name,
              k.starts::text, k.sub_appearances::text, k.goals::text, k.assists::text,
              k.yellow_cards::text, k.red_cards::text, k.matches_played::text,
              k.matches_with_minutes::text, k.supplied_minutes::text
         FROM counted k
         JOIN season se ON se.id = k.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN team t ON t.id = k.team_id
        ORDER BY se.start_date DESC, c.name, t.name`,
      [personId],
    );
    return rows.map((r) => ({
      season: { id: r.season_id, label: r.season_label },
      competition: {
        id: r.competition_id,
        name: r.competition_name,
        short_name: r.competition_short_name,
      },
      team: { id: r.team_id, name: r.team_name },
      starts: Number(r.starts),
      sub_appearances: Number(r.sub_appearances),
      goals: Number(r.goals),
      assists: Number(r.assists),
      yellow_cards: Number(r.yellow_cards),
      red_cards: Number(r.red_cards),
      minutes: seasonMinutes(
        Number(r.matches_played),
        Number(r.matches_with_minutes),
        Number(r.supplied_minutes),
      ),
    }));
  }

  /**
   * Minutes per person over the given seasons (T-824), counted exactly as
   * `record` counts them -- the matches played, how many carry the feed's
   * minutes, their sum -- and turned into a state by `seasonMinutes`. With a
   * `teamId`, only that team's line-ups count (the squad); without, every
   * team's (a competition's leaders). A person no line-up names is absent
   * from the map; the caller says `NO_LINEUPS`.
   */
  async minutesByPerson(
    seasonIds: string[],
    personIds: string[],
    teamId: string | null,
    /** The seasons' main competition only, as the competition page's boards count (D-209). */
    mainPhaseOnly = false,
  ): Promise<Map<string, PlayerSeasonMinutes>> {
    if (seasonIds.length === 0 || personIds.length === 0) return new Map();
    const { rows } = await this.pool.query<{
      person_id: string;
      matches_played: string;
      matches_with_minutes: string;
      supplied_minutes: string;
    }>(
      `WITH starts AS (
         SELECT picked.id AS season_id, ${mainPhaseStartSql('picked.id')} AS main_from
           FROM unnest($1::uuid[]) AS picked(id)
       ), lined AS (
         SELECT l.person_id, l.role,
                EXISTS (SELECT 1 FROM incident s
                         WHERE s.fixture_id = f.id AND s.kind = 'substitution'
                           AND s.related_person_id = l.person_id) AS came_on,
                m.value AS minutes
           FROM lineup l
           JOIN fixture_participant p ON p.id = l.participant_id
           JOIN fixture f ON f.id = p.fixture_id
           JOIN starts st ON st.season_id = f.season_id
           LEFT JOIN fixture_player_stat m
             ON m.participant_id = p.id AND m.person_id = l.person_id AND m.metric = 'minutes'
          WHERE l.person_id = ANY($2::uuid[])
            AND ($3::uuid IS NULL OR p.team_id = $3::uuid)
            AND (NOT $4::boolean OR ${mainPhaseSql('f', 'st.main_from')})
       ), named AS (
         SELECT lined.*,
                (lined.role = 'starter' OR lined.came_on OR COALESCE(lined.minutes, 0) > 0) AS played
           FROM lined
       )
       SELECT person_id,
              count(*) FILTER (WHERE played)::text AS matches_played,
              count(*) FILTER (WHERE played AND minutes IS NOT NULL)::text AS matches_with_minutes,
              COALESCE(sum(minutes) FILTER (WHERE played), 0)::text AS supplied_minutes
         FROM named
        GROUP BY person_id`,
      [seasonIds, personIds, teamId, mainPhaseOnly],
    );
    return new Map(
      rows.map((r) => [
        r.person_id,
        seasonMinutes(
          Number(r.matches_played),
          Number(r.matches_with_minutes),
          Number(r.supplied_minutes),
        ),
      ]),
    );
  }

  /** The last `limit` matches the player was named for, newest kick-off first. */
  async recent(
    personId: string,
    limit: number,
  ): Promise<{ matches: PlayerMatch[]; lastUpdatedAt: string | null }> {
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      status: string;
      round: string | null;
      stage_id: string | null;
      stage_name: string | null;
      competition_id: string;
      competition_name: string;
      competition_short_name: string | null;
      season_id: string;
      season_label: string;
      home_id: string;
      home_name: string;
      home_short_name: string | null;
      away_id: string;
      away_name: string;
      away_short_name: string | null;
      score_home: number | null;
      score_away: number | null;
      extra_time: boolean;
      pen_home: number | null;
      pen_away: number | null;
      team_id: string;
      team_name: string;
      role: 'starter' | 'bench';
      came_on: boolean;
      goals: string;
      assists: string;
      yellow_cards: string;
      red_cards: string;
      expected: Record<string, number> | null;
      updated_at: Date;
    }>(
      `SELECT f.id, f.kickoff_at, f.status, f.round, f.stage_id, st.name AS stage_name,
              c.id AS competition_id, c.name AS competition_name, c.short_name AS competition_short_name,
              se.id AS season_id, season_display_label(se.label, se.start_date) AS season_label,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              -- The latest score, so extra time counts, as the team page reads
              -- it (T-632, T-822); the shoot-out beside it, never in it.
              COALESCE(cur.home, ft.home) AS score_home, COALESCE(cur.away, ft.away) AS score_away,
              et.id IS NOT NULL AS extra_time,
              pen.home AS pen_home, pen.away AS pen_away,
              me.team_id, tm.name AS team_name, l.role,
              EXISTS (SELECT 1 FROM incident s WHERE s.fixture_id = f.id AND s.kind = 'substitution'
                        AND s.related_person_id = $1) AS came_on,
              (SELECT count(*) FROM incident i WHERE i.fixture_id = f.id AND i.person_id = $1
                  AND i.kind IN ('goal', 'penalty_goal'))::text AS goals,
              (SELECT count(*) FROM incident i WHERE i.fixture_id = f.id AND i.related_person_id = $1
                  AND i.kind IN ('goal', 'penalty_goal'))::text AS assists,
              (SELECT count(*) FROM incident i WHERE i.fixture_id = f.id AND i.person_id = $1
                  AND i.kind = 'yellow_card')::text AS yellow_cards,
              (SELECT count(*) FROM incident i WHERE i.fixture_id = f.id AND i.person_id = $1
                  AND i.kind IN ('red_card', 'second_yellow_card'))::text AS red_cards,
              -- Expected goals from their one source (T-1432): its figures for
              -- this player in this match, or null when it has none.
              (SELECT jsonb_object_agg(e.metric, e.value::float8) FROM fixture_player_expected e
                WHERE e.participant_id = me.id AND e.person_id = $1
                  AND e.source = 'highlightly') AS expected,
              GREATEST(f.updated_at, l.updated_at,
                (SELECT max(i.updated_at) FROM incident i WHERE i.fixture_id = f.id
                    AND (i.person_id = $1 OR i.related_person_id = $1))) AS updated_at
         FROM lineup l
         JOIN fixture_participant me ON me.id = l.participant_id
         JOIN team tm ON tm.id = me.team_id
         JOIN fixture f ON f.id = me.fixture_id
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN stage st ON st.id = f.stage_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         LEFT JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
         LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
         LEFT JOIN fixture_score et ON et.fixture_id = f.id AND et.kind = 'extra_time'
         LEFT JOIN fixture_score pen ON pen.fixture_id = f.id AND pen.kind = 'penalties'
        WHERE l.person_id = $1
        ORDER BY f.kickoff_at DESC, f.id
        LIMIT $2`,
      [personId, limit],
    );
    let last: Date | null = null;
    for (const r of rows) if (last === null || r.updated_at > last) last = r.updated_at;
    return {
      lastUpdatedAt: last === null ? null : last.toISOString(),
      matches: rows.map((r) => ({
        fixture: {
          id: r.id,
          kickoff_at: r.kickoff_at.toISOString(),
          status: r.status,
          round: r.round,
          stage:
            r.stage_id !== null && r.stage_name !== null
              ? { id: r.stage_id, name: r.stage_name }
              : null,
          competition: {
            id: r.competition_id,
            name: r.competition_name,
            short_name: r.competition_short_name,
          },
          season: { id: r.season_id, label: r.season_label },
          home: { id: r.home_id, name: r.home_name, short_name: r.home_short_name },
          away: { id: r.away_id, name: r.away_name, short_name: r.away_short_name },
          score:
            r.score_home !== null && r.score_away !== null
              ? { home: r.score_home, away: r.score_away }
              : null,
          after_extra_time: r.extra_time,
          penalties:
            r.pen_home !== null && r.pen_away !== null
              ? { home: r.pen_home, away: r.pen_away }
              : null,
        },
        team: { id: r.team_id, name: r.team_name },
        role: r.role,
        came_on: r.came_on,
        goals: Number(r.goals),
        assists: Number(r.assists),
        yellow_cards: Number(r.yellow_cards),
        red_cards: Number(r.red_cards),
        expected_goals: r.expected === null ? null : { source: 'highlightly', figures: r.expected },
      })),
    };
  }
}

/** The squad listing's and the line-ups' word on a player's position (T-1603). */
export interface PositionSources {
  squad: { position: SquadPosition; at: string } | null;
  lineup: { position: SquadPosition; at: string } | null;
}

/**
 * A player's position, and what says so (T-1603): the open spell, else the
 * newest squad listing (both a registration: `available`), else the line-ups
 * (`limited`: what the player played, not what they are registered as).
 * `not_supplied` when none names one; never guessed (rule 3).
 */
export function positionOf(
  spell: PlayerSpell | null,
  sources: PositionSources,
): Covered<PlayerPosition> {
  if (spell !== null && spell.position !== null) {
    return {
      coverage: 'available',
      last_updated_at: null,
      data: { value: spell.position, basis: 'spell' },
    };
  }
  if (sources.squad !== null) {
    return {
      coverage: 'available',
      last_updated_at: sources.squad.at,
      data: { value: sources.squad.position, basis: 'squad' },
    };
  }
  if (sources.lineup !== null) {
    return {
      coverage: 'limited',
      last_updated_at: sources.lineup.at,
      data: { value: sources.lineup.position, basis: 'lineup' },
    };
  }
  return { coverage: 'not_supplied', last_updated_at: null, data: null };
}
