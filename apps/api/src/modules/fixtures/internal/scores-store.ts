import { Inject, Injectable } from '@nestjs/common';
import type {
  CoverageState,
  FixtureStatus,
  ScoreCard,
  ScoreCardIncident,
  ScoreLine,
  ScoresFilters,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { freshnessOf } from './freshness';

/** A card plus the country its competition belongs to, for grouping. */
export interface ScoredRow {
  card: ScoreCard;
  country: { id: string; name: string; code: string } | null;
}

interface Row {
  id: string;
  kickoff_at: Date;
  status: FixtureStatus;
  minute: number | null;
  round: string | null;
  leg: number | null;
  season_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_short_name: string | null;
  country_id: string | null;
  country_name: string | null;
  country_code: string | null;
  stage_id: string | null;
  stage_name: string | null;
  stage_kind: string | null;
  venue_id: string | null;
  venue_name: string | null;
  venue_city: string | null;
  scores_coverage: CoverageState | null;
  home_id: string;
  home_name: string;
  home_short_name: string | null;
  home_code: string | null;
  away_id: string;
  away_name: string;
  away_short_name: string | null;
  away_code: string | null;
  scores: Record<string, ScoreLine> | null;
  incidents: ScoreCardIncident[] | null;
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

function toRow(row: Row): ScoredRow {
  const incidents = row.incidents ?? [];
  const sentOff = (side: 'home' | 'away'): number =>
    incidents.filter(
      (i) => i.side === side && (i.kind === 'red_card' || i.kind === 'second_yellow_card'),
    ).length;
  const scores = Object.fromEntries(
    SCORE_KINDS.map((kind) => [kind, row.scores?.[kind] ?? null]),
  ) as ScoreCard['scores'];

  return {
    card: {
      id: row.id,
      kickoff_at: row.kickoff_at.toISOString(),
      status: row.status,
      minute: row.status === 'live' ? row.minute : null,
      competition: {
        id: row.competition_id,
        name: row.competition_name,
        short_name: row.competition_short_name,
        country_id: row.country_id,
      },
      season: { id: row.season_id, label: row.season_label },
      stage:
        row.stage_id !== null && row.stage_name !== null && row.stage_kind !== null
          ? { id: row.stage_id, name: row.stage_name, kind: row.stage_kind }
          : null,
      round: row.round,
      leg: row.leg === 1 || row.leg === 2 ? row.leg : null,
      home: {
        id: row.home_id,
        name: row.home_name,
        short_name: row.home_short_name,
        code: row.home_code,
      },
      away: {
        id: row.away_id,
        name: row.away_name,
        short_name: row.away_short_name,
        code: row.away_code,
      },
      scores,
      red_cards: { home: sentOff('home'), away: sentOff('away') },
      incidents,
      venue:
        row.venue_id !== null && row.venue_name !== null
          ? { id: row.venue_id, name: row.venue_name, city: row.venue_city }
          : null,
      // No recorded profile: the fixture exists but the depth of its data is
      // unknown, which is what `limited` says. Never `available` by default.
      coverage: row.scores_coverage ?? 'limited',
      last_updated_at: row.last_updated_at.toISOString(),
      freshness: freshnessOf(row.status, row.last_updated_at, new Date()),
      pinned: false,
    },
    country:
      row.country_id !== null && row.country_name !== null && row.country_code !== null
        ? { id: row.country_id, name: row.country_name, code: row.country_code }
        : null,
  };
}

/**
 * The scores list query (the `fixtures` boundary owns these tables). The date
 * range is turned into instants by Postgres in the user's zone, so a 23:30 UTC
 * kick-off lands on the next day for a viewer in Tehran, as it should.
 */
@Injectable()
export class PostgresScoresStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(filters: ScoresFilters): Promise<ScoredRow[]> {
    const { rows } = await this.pool.query<Row>(
      `WITH scope AS (
         SELECT f.id, f.kickoff_at, f.status, f.minute, f.round, f.leg, f.updated_at,
                se.id AS season_id, se.label AS season_label,
                c.id AS competition_id, c.name AS competition_name,
                c.short_name AS competition_short_name,
                c.country_id, co.name AS country_name, co.code AS country_code,
                f.stage_id, st.name AS stage_name, st.kind AS stage_kind,
                f.venue_id, v.name AS venue_name, v.city AS venue_city,
                cp.state AS scores_coverage
           FROM fixture f
           JOIN season se ON se.id = f.season_id
           JOIN competition c ON c.id = se.competition_id
           LEFT JOIN country co ON co.id = c.country_id
           LEFT JOIN stage st ON st.id = f.stage_id
           LEFT JOIN venue v ON v.id = f.venue_id
           LEFT JOIN coverage_profile cp ON cp.season_id = se.id AND cp.module = 'scores'
          WHERE f.kickoff_at >= ($1::date)::timestamp AT TIME ZONE $3
            AND f.kickoff_at < ($2::date + 1)::timestamp AT TIME ZONE $3
            AND (NOT $4::boolean OR f.status = 'live')
            AND ($5::uuid IS NULL OR c.country_id = $5)
            AND ($6::uuid IS NULL OR c.id = $6)
            AND ($7::uuid IS NULL OR f.stage_id = $7)
            AND ($8::text IS NULL OR c.gender = $8)
            AND ($9::text IS NULL OR ($9 = 'senior') = (c.age_group = 'senior'))
       )
       SELECT s.id, s.kickoff_at, s.status, s.minute, s.round, s.leg,
              s.season_id, s.season_label,
              s.competition_id, s.competition_name, s.competition_short_name,
              s.country_id, s.country_name, s.country_code,
              s.stage_id, s.stage_name, s.stage_kind,
              s.venue_id, s.venue_name, s.venue_city, s.scores_coverage,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              th.code AS home_code,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              ta.code AS away_code,
              (SELECT jsonb_object_agg(sc.kind, jsonb_build_object('home', sc.home, 'away', sc.away))
                 FROM fixture_score sc WHERE sc.fixture_id = s.id) AS scores,
              (SELECT jsonb_agg(jsonb_build_object(
                        'kind', i.kind, 'minute', i.minute, 'added_time', i.added_time,
                        'side', p.side, 'player', COALESCE(pe.known_as, pe.full_name))
                      ORDER BY i.sequence)
                 FROM incident i
                 LEFT JOIN fixture_participant p ON p.id = i.participant_id
                 LEFT JOIN person pe ON pe.id = i.person_id
                WHERE i.fixture_id = s.id
                  AND i.kind IN ('goal', 'own_goal', 'penalty_goal', 'penalty_missed',
                                 'red_card', 'second_yellow_card', 'var')) AS incidents,
              GREATEST(
                s.updated_at,
                (SELECT max(sc.updated_at) FROM fixture_score sc WHERE sc.fixture_id = s.id),
                (SELECT max(i.updated_at) FROM incident i WHERE i.fixture_id = s.id)
              ) AS last_updated_at
         FROM scope s
         JOIN fixture_participant h ON h.fixture_id = s.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = s.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
        ORDER BY s.kickoff_at, s.id`,
      [
        filters.from,
        filters.to,
        filters.timezone,
        filters.live,
        filters.country_id,
        filters.competition_id,
        filters.stage_id,
        filters.gender,
        filters.age,
      ],
    );
    return rows.map(toRow);
  }
}
