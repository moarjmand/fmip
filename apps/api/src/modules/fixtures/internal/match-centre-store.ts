import { Inject, Injectable } from '@nestjs/common';
import { freshnessOf } from './freshness';
import type {
  CoverageModule,
  CoverageState,
  FixtureStatus,
  FormEntry,
  HeadToHeadEntry,
  MatchHeader,
  MatchIncident,
  MatchLineupPlayer,
  MatchPeriod,
  MatchStatMetric,
  MatchStatRow,
  ScoreLine,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** The window of recent matches the form and head-to-head modules show. */
export const FORM_WINDOW = 5;

export interface HeaderRow {
  header: MatchHeader;
  homeParticipantId: string;
  awayParticipantId: string;
}

export interface Stamped<T> {
  rows: T[];
  /** Newest `updated_at` among the rows, or null when there are none. */
  lastUpdatedAt: string | null;
}

interface RawHeader {
  id: string;
  kickoff_at: Date;
  status: FixtureStatus;
  minute: number | null;
  round: string | null;
  group_name: string | null;
  leg: number | null;
  is_neutral_venue: boolean;
  attendance: number | null;
  updated_at: Date;
  season_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_short_name: string | null;
  country_id: string | null;
  stage_id: string | null;
  stage_name: string | null;
  stage_kind: string | null;
  venue_id: string | null;
  venue_name: string | null;
  venue_city: string | null;
  referee_id: string | null;
  referee_name: string | null;
  home_pid: string;
  home_id: string;
  home_name: string;
  home_short_name: string | null;
  home_code: string | null;
  home_formation: string | null;
  home_coach_id: string | null;
  home_coach_name: string | null;
  away_pid: string;
  away_id: string;
  away_name: string;
  away_short_name: string | null;
  away_code: string | null;
  away_formation: string | null;
  away_coach_id: string | null;
  away_coach_name: string | null;
  scores: Record<string, ScoreLine> | null;
  periods:
    | (Omit<MatchPeriod, 'started_at' | 'ended_at'> & {
        started_at: string;
        ended_at: string | null;
      })[]
    | null;
  last_updated_at: Date;
}

const SCORE_KINDS = [
  'current',
  'half_time',
  'full_time',
  'extra_time',
  'penalties',
  'aggregate',
] as const;

const ref = (id: string | null, name: string | null): { id: string; name: string } | null =>
  id !== null && name !== null ? { id, name } : null;

/** SQL for the match centre. Reads only; the `fixtures` boundary owns these tables. */
@Injectable()
export class PostgresMatchCentreStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async header(fixtureId: string): Promise<HeaderRow | null> {
    const { rows } = await this.pool.query<RawHeader>(
      `SELECT f.id, f.kickoff_at, f.status, f.minute, f.round, f.group_name, f.leg,
              f.is_neutral_venue, f.attendance, f.updated_at,
              se.id AS season_id, se.label AS season_label,
              c.id AS competition_id, c.name AS competition_name,
              c.short_name AS competition_short_name, c.country_id,
              f.stage_id, st.name AS stage_name, st.kind AS stage_kind,
              f.venue_id, v.name AS venue_name, v.city AS venue_city,
              f.referee_id, COALESCE(r.known_as, r.full_name) AS referee_name,
              h.id AS home_pid, th.id AS home_id, th.name AS home_name,
              th.short_name AS home_short_name, th.code AS home_code, h.formation AS home_formation,
              hc.id AS home_coach_id, COALESCE(hc.known_as, hc.full_name) AS home_coach_name,
              a.id AS away_pid, ta.id AS away_id, ta.name AS away_name,
              ta.short_name AS away_short_name, ta.code AS away_code, a.formation AS away_formation,
              ac.id AS away_coach_id, COALESCE(ac.known_as, ac.full_name) AS away_coach_name,
              (SELECT jsonb_object_agg(sc.kind, jsonb_build_object('home', sc.home, 'away', sc.away))
                 FROM fixture_score sc WHERE sc.fixture_id = f.id) AS scores,
              (SELECT jsonb_agg(jsonb_build_object(
                        'kind', p.kind, 'sequence', p.sequence,
                        'started_at', to_char(p.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                        'ended_at', to_char(p.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                        'added_minutes', p.added_minutes) ORDER BY p.sequence)
                 FROM fixture_period p WHERE p.fixture_id = f.id) AS periods,
              GREATEST(
                f.updated_at, h.updated_at, a.updated_at,
                (SELECT max(sc.updated_at) FROM fixture_score sc WHERE sc.fixture_id = f.id),
                (SELECT max(p.updated_at) FROM fixture_period p WHERE p.fixture_id = f.id),
                (SELECT max(i.updated_at) FROM incident i WHERE i.fixture_id = f.id),
                (SELECT max(l.updated_at) FROM lineup l WHERE l.participant_id IN (h.id, a.id)),
                (SELECT max(s.updated_at) FROM fixture_stat s WHERE s.participant_id IN (h.id, a.id))
              ) AS last_updated_at
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN stage st ON st.id = f.stage_id
         LEFT JOIN venue v ON v.id = f.venue_id
         LEFT JOIN person r ON r.id = f.referee_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         LEFT JOIN person hc ON hc.id = h.coach_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         LEFT JOIN person ac ON ac.id = a.coach_id
        WHERE f.id = $1`,
      [fixtureId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    const scores = Object.fromEntries(
      SCORE_KINDS.map((kind) => [kind, r.scores?.[kind] ?? null]),
    ) as MatchHeader['scores'];
    return {
      homeParticipantId: r.home_pid,
      awayParticipantId: r.away_pid,
      header: {
        id: r.id,
        kickoff_at: r.kickoff_at.toISOString(),
        status: r.status,
        minute: r.status === 'live' ? r.minute : null,
        competition: {
          id: r.competition_id,
          name: r.competition_name,
          short_name: r.competition_short_name,
          country_id: r.country_id,
        },
        season: { id: r.season_id, label: r.season_label },
        stage:
          r.stage_id !== null && r.stage_name !== null && r.stage_kind !== null
            ? { id: r.stage_id, name: r.stage_name, kind: r.stage_kind }
            : null,
        round: r.round,
        group_name: r.group_name,
        leg: r.leg === 1 || r.leg === 2 ? r.leg : null,
        home: {
          id: r.home_id,
          name: r.home_name,
          short_name: r.home_short_name,
          code: r.home_code,
          formation: r.home_formation,
          coach: ref(r.home_coach_id, r.home_coach_name),
        },
        away: {
          id: r.away_id,
          name: r.away_name,
          short_name: r.away_short_name,
          code: r.away_code,
          formation: r.away_formation,
          coach: ref(r.away_coach_id, r.away_coach_name),
        },
        scores,
        venue:
          r.venue_id !== null && r.venue_name !== null
            ? { id: r.venue_id, name: r.venue_name, city: r.venue_city }
            : null,
        is_neutral_venue: r.is_neutral_venue,
        referee: ref(r.referee_id, r.referee_name),
        attendance: r.attendance,
        periods: (r.periods ?? []).map((p) => ({
          kind: p.kind,
          sequence: p.sequence,
          started_at: p.started_at,
          ended_at: p.ended_at,
          added_minutes: p.added_minutes,
        })),
        last_updated_at: r.last_updated_at.toISOString(),
        freshness: freshnessOf(r.status, r.last_updated_at, new Date()),
      },
    };
  }

  async coverage(seasonId: string): Promise<Record<CoverageModule, CoverageState>> {
    const { rows } = await this.pool.query<{ module: CoverageModule; state: CoverageState }>(
      `SELECT module, state FROM coverage_profile WHERE season_id = $1`,
      [seasonId],
    );
    const out: Record<CoverageModule, CoverageState> = {
      scores: 'not_supplied',
      incidents: 'not_supplied',
      lineups: 'not_supplied',
      statistics: 'not_supplied',
      standings: 'not_supplied',
      availability: 'not_supplied',
      advanced_statistics: 'not_supplied',
    };
    for (const row of rows) out[row.module] = row.state;
    return out;
  }

  async incidents(fixtureId: string, homeParticipantId: string): Promise<Stamped<MatchIncident>> {
    const { rows } = await this.pool.query<{
      id: string;
      sequence: number;
      minute: number;
      added_time: number | null;
      kind: MatchIncident['kind'];
      participant_id: string | null;
      person_id: string | null;
      person_name: string | null;
      related_id: string | null;
      related_name: string | null;
      detail: string | null;
      updated_at: Date;
    }>(
      `SELECT i.id, i.sequence, i.minute, i.added_time, i.kind, i.participant_id,
              i.person_id, COALESCE(p.known_as, p.full_name) AS person_name,
              i.related_person_id AS related_id, COALESCE(q.known_as, q.full_name) AS related_name,
              i.detail, i.updated_at
         FROM incident i
         LEFT JOIN person p ON p.id = i.person_id
         LEFT JOIN person q ON q.id = i.related_person_id
        WHERE i.fixture_id = $1
        ORDER BY i.sequence`,
      [fixtureId],
    );
    return {
      rows: rows.map((r) => ({
        id: r.id,
        sequence: r.sequence,
        minute: r.minute,
        added_time: r.added_time,
        kind: r.kind,
        side:
          r.participant_id === null
            ? null
            : r.participant_id === homeParticipantId
              ? 'home'
              : 'away',
        player: ref(r.person_id, r.person_name),
        related_player: ref(r.related_id, r.related_name),
        detail: r.detail,
      })),
      lastUpdatedAt: newest(rows.map((r) => r.updated_at)),
    };
  }

  async statistics(
    homeParticipantId: string,
    awayParticipantId: string,
  ): Promise<Stamped<MatchStatRow>> {
    const { rows } = await this.pool.query<{
      participant_id: string;
      metric: MatchStatMetric;
      value: string;
      updated_at: Date;
    }>(
      `SELECT participant_id, metric, value, updated_at
         FROM fixture_stat WHERE participant_id IN ($1, $2)
        ORDER BY metric`,
      [homeParticipantId, awayParticipantId],
    );
    const byMetric = new Map<MatchStatMetric, MatchStatRow>();
    for (const r of rows) {
      const row = byMetric.get(r.metric) ?? { metric: r.metric, home: null, away: null };
      if (r.participant_id === homeParticipantId) row.home = Number(r.value);
      else row.away = Number(r.value);
      byMetric.set(r.metric, row);
    }
    return { rows: [...byMetric.values()], lastUpdatedAt: newest(rows.map((r) => r.updated_at)) };
  }

  async lineups(
    homeParticipantId: string,
    awayParticipantId: string,
  ): Promise<{
    home: MatchLineupPlayer[];
    away: MatchLineupPlayer[];
    lastUpdatedAt: string | null;
  }> {
    const { rows } = await this.pool.query<{
      participant_id: string;
      person_id: string;
      name: string;
      role: MatchLineupPlayer['role'];
      shirt_number: number | null;
      position: MatchLineupPlayer['position'];
      is_captain: boolean;
      updated_at: Date;
    }>(
      `SELECT l.participant_id, l.person_id, COALESCE(p.known_as, p.full_name) AS name,
              l.role, l.shirt_number, l.position, l.is_captain, l.updated_at
         FROM lineup l JOIN person p ON p.id = l.person_id
        WHERE l.participant_id IN ($1, $2)
        ORDER BY l.role DESC, l.shirt_number NULLS LAST, name`,
      [homeParticipantId, awayParticipantId],
    );
    const player = (r: (typeof rows)[number]): MatchLineupPlayer => ({
      id: r.person_id,
      name: r.name,
      role: r.role,
      shirt_number: r.shirt_number,
      position: r.position,
      is_captain: r.is_captain,
    });
    return {
      home: rows.filter((r) => r.participant_id === homeParticipantId).map(player),
      away: rows.filter((r) => r.participant_id === awayParticipantId).map(player),
      lastUpdatedAt: newest(rows.map((r) => r.updated_at)),
    };
  }

  /** A team's last competitive finished matches before `before`, newest first. */
  async form(teamId: string, before: string, excludeFixtureId: string): Promise<FormEntry[]> {
    const { rows } = await this.pool.query<{
      fixture_id: string;
      kickoff_at: Date;
      competition_id: string;
      competition_name: string;
      opponent_id: string;
      opponent_name: string;
      home: boolean;
      goals_for: number;
      goals_against: number;
    }>(
      `SELECT f.id AS fixture_id, f.kickoff_at, c.id AS competition_id, c.name AS competition_name,
              o.team_id AS opponent_id, t.name AS opponent_name,
              (me.side = 'home') AS home,
              CASE WHEN me.side = 'home' THEN sc.home ELSE sc.away END AS goals_for,
              CASE WHEN me.side = 'home' THEN sc.away ELSE sc.home END AS goals_against
         FROM fixture_participant me
         JOIN fixture f ON f.id = me.fixture_id
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN fixture_participant o ON o.fixture_id = f.id AND o.side <> me.side
         JOIN team t ON t.id = o.team_id
         JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
        WHERE me.team_id = $1 AND f.status = 'finished' AND f.kickoff_at < $2 AND f.id <> $3
          AND c.kind <> 'friendly'
        ORDER BY f.kickoff_at DESC
        LIMIT $4`,
      [teamId, before, excludeFixtureId, FORM_WINDOW],
    );
    return rows.map((r) => ({
      fixture_id: r.fixture_id,
      kickoff_at: r.kickoff_at.toISOString(),
      competition: { id: r.competition_id, name: r.competition_name },
      opponent: { id: r.opponent_id, name: r.opponent_name },
      home: r.home,
      goals_for: r.goals_for,
      goals_against: r.goals_against,
      result: r.goals_for > r.goals_against ? 'W' : r.goals_for < r.goals_against ? 'L' : 'D',
    }));
  }

  /** Finished meetings of the two teams before `before`, newest first. */
  async headToHead(
    teamA: string,
    teamB: string,
    before: string,
    excludeFixtureId: string,
  ): Promise<HeadToHeadEntry[]> {
    const { rows } = await this.pool.query<{
      fixture_id: string;
      kickoff_at: Date;
      competition_id: string;
      competition_name: string;
      home_id: string;
      home_name: string;
      away_id: string;
      away_name: string;
      ft_home: number;
      ft_away: number;
      venue: string | null;
    }>(
      `SELECT f.id AS fixture_id, f.kickoff_at, c.id AS competition_id, c.name AS competition_name,
              h.team_id AS home_id, th.name AS home_name, a.team_id AS away_id, ta.name AS away_name,
              sc.home AS ft_home, sc.away AS ft_away, v.name AS venue
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
         LEFT JOIN venue v ON v.id = f.venue_id
        WHERE f.status = 'finished' AND f.kickoff_at < $3 AND f.id <> $4
          AND ((h.team_id = $1 AND a.team_id = $2) OR (h.team_id = $2 AND a.team_id = $1))
        ORDER BY f.kickoff_at DESC
        LIMIT $5`,
      [teamA, teamB, before, excludeFixtureId, FORM_WINDOW],
    );
    return rows.map((r) => ({
      fixture_id: r.fixture_id,
      kickoff_at: r.kickoff_at.toISOString(),
      competition: { id: r.competition_id, name: r.competition_name },
      home: { id: r.home_id, name: r.home_name },
      away: { id: r.away_id, name: r.away_name },
      full_time: { home: r.ft_home, away: r.ft_away },
      venue: r.venue,
    }));
  }
}

function newest(dates: Date[]): string | null {
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString();
}
