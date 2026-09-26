/**
 * The SQL behind the coverage computation (T-027).
 *
 * One query per module, each counting the same two things: how many fixtures of
 * the season should carry the module by now, and how many do. What "should" means
 * differs per module and is the interesting part, so each query says it.
 *
 * The upsert follows the same rule as every other writer in this boundary: a
 * `WHERE ... IS DISTINCT FROM` on the `DO UPDATE`, so recomputing an unchanged
 * season writes nothing and `updated_at` keeps meaning "when this last changed",
 * not "when a job last ran".
 */

import type { Pool } from 'pg';
import type { CoverageModule, CoverageState } from '@fmip/contracts';
import type { Provider } from '@fmip/ingestion';
import type { Evidence } from './coverage-rules';

/**
 * What counts as "should have this by now", per module.
 *
 * `expected` is the count of fixtures the module is owed for; `present` the
 * count that carry it. Both are single scalar sub-selects over the same season
 * so the pair can never be read from two different moments.
 */
const EVIDENCE: Record<CoverageModule, { expected: string; present: string }> = {
  // A finished match owes a full-time score.
  scores: {
    expected: `f.status = 'finished'`,
    present: `EXISTS (SELECT 1 FROM fixture_score s
                       WHERE s.fixture_id = f.id AND s.kind = 'full_time')`,
  },
  // So does it owe its events — a 0-0 with no cards is rare enough that
  // counting it as missing is the safer error.
  incidents: {
    expected: `f.status = 'finished'`,
    present: `EXISTS (SELECT 1 FROM incident i WHERE i.fixture_id = f.id)`,
  },
  // A line-up is owed once the match has started, not before it is announced.
  lineups: {
    expected: `f.status IN ('live', 'finished')`,
    present: `EXISTS (SELECT 1 FROM lineup l
                        JOIN fixture_participant p ON p.id = l.participant_id
                       WHERE p.fixture_id = f.id)`,
  },
  statistics: {
    expected: `f.status = 'finished'`,
    present: `EXISTS (SELECT 1 FROM fixture_stat st
                        JOIN fixture_participant p ON p.id = st.participant_id
                       WHERE p.fixture_id = f.id)`,
  },
  // The table is derived from results (D-038), so its coverage is the coverage
  // of the results it is derived from, restricted to the matches the table
  // counts: a league stage's, or -- the same rule as the table's own query --
  // a stage-less match of a competition that is a league. No deployment
  // creates a domestic league's stage, so without the second half every
  // league's complete table was declared not supplied (found 2026-09-26).
  standings: {
    expected: `f.status = 'finished' AND (
                 EXISTS (SELECT 1 FROM stage g WHERE g.id = f.stage_id AND g.kind = 'league')
                 OR (f.stage_id IS NULL AND EXISTS (
                       SELECT 1 FROM season se JOIN competition c ON c.id = se.competition_id
                        WHERE se.id = f.season_id AND c.kind = 'league')))`,
    present: `EXISTS (SELECT 1 FROM fixture_score s
                       WHERE s.fixture_id = f.id AND s.kind = 'full_time')`,
  },
  // Where to watch. Nothing on any free plan supplies it; the query is written
  // so that it starts reporting the day something does.
  // Who will miss a match (T-103) is owed for every match about to be played
  // and every match it was ever asked about; it is present once asked, since
  // "nobody is missing" is an answer.
  availability: {
    expected: `(f.status = 'scheduled' AND f.kickoff_at < now() + interval '72 hours')
               OR EXISTS (SELECT 1 FROM fixture_availability_fetch a WHERE a.fixture_id = f.id)`,
    present: `EXISTS (SELECT 1 FROM fixture_availability_fetch a WHERE a.fixture_id = f.id)`,
  },
  // Expected goals is the one advanced metric the schema models.
  advanced_statistics: {
    expected: `f.status = 'finished'`,
    present: `EXISTS (SELECT 1 FROM fixture_stat st
                        JOIN fixture_participant p ON p.id = st.participant_id
                       WHERE p.fixture_id = f.id AND st.metric = 'expected_goals')`,
  },
};

export class CoverageStore {
  constructor(private readonly pool: Pool) {}

  /** The counts behind one module's state, in one statement. */
  async evidence(seasonId: string, module: CoverageModule): Promise<Evidence> {
    const rule = EVIDENCE[module];
    const { rows } = await this.pool.query<{ expected: string; present: string }>(
      `SELECT count(*) FILTER (WHERE ${rule.expected})::text AS expected,
              count(*) FILTER (WHERE (${rule.expected}) AND (${rule.present}))::text AS present
         FROM fixture f
        WHERE f.season_id = $1`,
      [seasonId],
    );
    return {
      expected: Number(rows[0]?.expected ?? 0),
      present: Number(rows[0]?.present ?? 0),
    };
  }

  /** The state an admin or an earlier run recorded, or `null` if none. */
  async declared(seasonId: string, module: CoverageModule): Promise<CoverageState | null> {
    const { rows } = await this.pool.query<{ state: CoverageState }>(
      `SELECT state FROM coverage_profile WHERE season_id = $1 AND module = $2`,
      [seasonId, module],
    );
    return rows[0]?.state ?? null;
  }

  /**
   * Which provider's ids the season's fixtures were ingested under, when
   * exactly one did. `coverage_profile` insists a supplied module names a
   * provider, and naming one we cannot evidence would be a guess.
   */
  async supplier(seasonId: string): Promise<Provider | null> {
    const { rows } = await this.pool.query<{ provider: Provider }>(
      `SELECT DISTINCT pm.provider
         FROM fixture f
         JOIN provider_mapping pm
           ON pm.internal_id = f.id AND pm.entity_type = 'fixture'
        WHERE f.season_id = $1`,
      [seasonId],
    );
    return rows.length === 1 ? (rows[0]?.provider ?? null) : null;
  }

  /** Writes the row if it differs. Returns 1 when something changed, 0 when not. */
  async upsert(
    seasonId: string,
    module: CoverageModule,
    state: CoverageState,
    provider: Provider | null,
    note: string,
  ): Promise<number> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO coverage_profile (season_id, module, state, provider, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (season_id, module) DO UPDATE
          SET state = EXCLUDED.state, provider = EXCLUDED.provider, note = EXCLUDED.note
        WHERE (coverage_profile.state, coverage_profile.provider, coverage_profile.note)
              IS DISTINCT FROM (EXCLUDED.state, EXCLUDED.provider, EXCLUDED.note)`,
      [seasonId, module, state, provider, note],
    );
    return rowCount ?? 0;
  }

  /**
   * When the season's data last changed, per module — the freshness half of
   * T-027. Read from the rows themselves rather than from a job's clock, so it
   * cannot claim a match is fresh because a poll ran and found nothing.
   */
  async freshness(seasonId: string): Promise<Partial<Record<CoverageModule, string>>> {
    const { rows } = await this.pool.query<{
      scores: Date | null;
      incidents: Date | null;
      lineups: Date | null;
      statistics: Date | null;
      availability: Date | null;
    }>(
      `SELECT (SELECT max(s.updated_at) FROM fixture_score s
                 JOIN fixture f ON f.id = s.fixture_id WHERE f.season_id = $1) AS scores,
              (SELECT max(i.updated_at) FROM incident i
                 JOIN fixture f ON f.id = i.fixture_id WHERE f.season_id = $1) AS incidents,
              (SELECT max(l.updated_at) FROM lineup l
                 JOIN fixture_participant p ON p.id = l.participant_id
                 JOIN fixture f ON f.id = p.fixture_id WHERE f.season_id = $1) AS lineups,
              (SELECT max(st.updated_at) FROM fixture_stat st
                 JOIN fixture_participant p ON p.id = st.participant_id
                 JOIN fixture f ON f.id = p.fixture_id WHERE f.season_id = $1) AS statistics,
              -- The one module dated by the ask rather than the rows: an answer
              -- of "nobody" writes no row and is still as fresh as its ask.
              (SELECT max(a.fetched_at) FROM fixture_availability_fetch a
                 JOIN fixture f ON f.id = a.fixture_id WHERE f.season_id = $1) AS availability`,
      [seasonId],
    );
    const row = rows[0];
    const out: Partial<Record<CoverageModule, string>> = {};
    if (row === undefined) return out;
    if (row.scores !== null) {
      out.scores = row.scores.toISOString();
      // The table is the results, so it is exactly as fresh as they are (D-038).
      out.standings = row.scores.toISOString();
    }
    if (row.incidents !== null) out.incidents = row.incidents.toISOString();
    if (row.lineups !== null) out.lineups = row.lineups.toISOString();
    if (row.statistics !== null) {
      out.statistics = row.statistics.toISOString();
      out.advanced_statistics = row.statistics.toISOString();
    }
    if (row.availability !== null) out.availability = row.availability.toISOString();
    return out;
  }

  /** Every season a set of fixtures belongs to. */
  async seasonsOf(fixtureIds: string[]): Promise<string[]> {
    if (fixtureIds.length === 0) return [];
    const { rows } = await this.pool.query<{ season_id: string }>(
      `SELECT DISTINCT season_id FROM fixture WHERE id = ANY($1::uuid[])`,
      [fixtureIds],
    );
    return rows.map((r) => r.season_id);
  }
}
