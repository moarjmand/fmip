import { Inject, Injectable } from '@nestjs/common';
import type { ForecastKind } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { UpsetDay, UpsetDayRow } from './upset';

/**
 * The day's least likely result, in one read (T-1507, D-265). Writes nothing:
 * forecasts are immutable (rule 5), and this only reads them.
 *
 * - **The day** is `[date 00:00, date + 1 00:00)` in the zone asked, as
 *   `GET /scores` draws it.
 * - **Full coverage** is a season whose `scores` coverage is `available`
 *   (computed from our rows, T-027), and a forecast the model made on
 *   complete data (`data_completeness = 'available'`, what `coverageOf`
 *   calls `available`).
 * - **The forecast** is the match's last published version computed before
 *   kick-off, as `preKickoffSummaries` picks it (T-940, D-114). If that
 *   version is unavailable or limited the match does not qualify: an earlier
 *   version was not the model's last word before the match.
 * - **A void match** never qualifies: only `finished` with a full-time
 *   score. Postponed, cancelled, abandoned and awarded matches were not
 *   played to the result the forecast was about.
 * - **Ties** go to the earlier kick-off, then the fixture id.
 */
@Injectable()
export class PostgresUpsetStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async day(day: UpsetDay): Promise<UpsetDayRow> {
    const { rows } = await this.pool.query<{
      finished_matches: number;
      still_to_play: number;
      last_updated_at: Date | null;
      fixture_id: string | null;
      kickoff_at: Date;
      season_id: string;
      competition_id: string;
      competition_name: string;
      competition_short_name: string | null;
      home_id: string;
      home_name: string;
      home_short_name: string | null;
      away_id: string;
      away_name: string;
      away_short_name: string | null;
      home_goals: number;
      away_goals: number;
      p_home: string;
      p_draw: string;
      p_away: string;
      version_number: number;
      kind: ForecastKind;
      model_id: string;
      computed_at: Date;
    }>(
      `WITH day AS (
         SELECT f.id, f.kickoff_at, f.status, f.updated_at, f.season_id, se.competition_id
           FROM fixture f
           JOIN season se ON se.id = f.season_id
           JOIN coverage_profile cp
             ON cp.season_id = se.id AND cp.module = 'scores' AND cp.state = 'available'
          WHERE f.kickoff_at >= ($1::date)::timestamp AT TIME ZONE $2
            AND f.kickoff_at < ($1::date + 1)::timestamp AT TIME ZONE $2
       ),
       finished AS (
         SELECT d.*, sc.home AS home_goals, sc.away AS away_goals
           FROM day d
           JOIN fixture_score sc ON sc.fixture_id = d.id AND sc.kind = 'full_time'
          WHERE d.status = 'finished'
       ),
       candidate AS (
         SELECT fin.*, pk.*,
                CASE WHEN fin.home_goals > fin.away_goals THEN pk.p_home
                     WHEN fin.home_goals < fin.away_goals THEN pk.p_away
                     ELSE pk.p_draw END AS p_outcome
           FROM finished fin
           JOIN LATERAL (
             SELECT fc.version_number, s.kind, m.model_id, fc.computed_at,
                    fc.status AS forecast_status, fc.data_completeness,
                    fc.p_home, fc.p_draw, fc.p_away
               FROM forecast fc
               JOIN input_snapshot s ON s.id = fc.input_snapshot_id
               JOIN model_version m ON m.id = fc.model_version_id
              WHERE fc.fixture_id = fin.id
                AND fc.role = 'published'
                AND fc.computed_at < fin.kickoff_at
              ORDER BY fc.version_number DESC
              LIMIT 1
           ) pk ON true
          WHERE pk.forecast_status = 'available' AND pk.data_completeness = 'available'
       )
       SELECT (SELECT count(*)::int FROM finished) AS finished_matches,
              (SELECT count(*)::int FROM day WHERE status IN ('scheduled', 'live', 'suspended'))
                AS still_to_play,
              (SELECT max(updated_at) FROM day) AS last_updated_at,
              top.*
         FROM (SELECT 1) AS one
         LEFT JOIN LATERAL (
           SELECT c.id AS fixture_id, c.kickoff_at, c.season_id,
                  co.id AS competition_id, co.name AS competition_name,
                  co.short_name AS competition_short_name,
                  ht.id AS home_id, ht.name AS home_name, ht.short_name AS home_short_name,
                  awt.id AS away_id, awt.name AS away_name, awt.short_name AS away_short_name,
                  c.home_goals, c.away_goals, c.p_home, c.p_draw, c.p_away,
                  c.version_number, c.kind, c.model_id, c.computed_at
             FROM candidate c
             JOIN competition co ON co.id = c.competition_id
             JOIN fixture_participant hp ON hp.fixture_id = c.id AND hp.side = 'home'
             JOIN team ht ON ht.id = hp.team_id
             JOIN fixture_participant ap ON ap.fixture_id = c.id AND ap.side = 'away'
             JOIN team awt ON awt.id = ap.team_id
            ORDER BY c.p_outcome ASC, c.kickoff_at ASC, c.id ASC
            LIMIT 1
         ) top ON true`,
      [day.date, day.timeZone],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('the upset query returned no row');
    return {
      finishedMatches: row.finished_matches,
      stillToPlay: row.still_to_play,
      lastUpdatedAt: row.last_updated_at,
      upset:
        row.fixture_id === null
          ? null
          : {
              fixtureId: row.fixture_id,
              kickoffAt: row.kickoff_at,
              seasonId: row.season_id,
              competition: {
                id: row.competition_id,
                name: row.competition_name,
                shortName: row.competition_short_name,
              },
              home: { id: row.home_id, name: row.home_name, shortName: row.home_short_name },
              away: { id: row.away_id, name: row.away_name, shortName: row.away_short_name },
              score: { home: row.home_goals, away: row.away_goals },
              probabilities: {
                home: Number(row.p_home),
                draw: Number(row.p_draw),
                away: Number(row.p_away),
              },
              versionNumber: row.version_number,
              kind: row.kind,
              modelVersion: row.model_id,
              computedAt: row.computed_at,
            },
    };
  }
}
