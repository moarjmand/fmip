/**
 * The SQL for the founder's analysis (T-131). All of it, and nothing else.
 *
 * Publishing a version and recording its audit row happen in **one
 * transaction**, the same device the administration boundary uses (D-046): an
 * editorial act that is visible in the product but absent from the audit log is
 * exactly the gap the rule exists to close, and two statements outside a
 * transaction leave that gap open on any error between them.
 */

import type { Pool, PoolClient } from 'pg';
import type {
  FounderAnalysis,
  FounderAnalysisSummary,
  FounderAnalysisVersion,
} from '@fmip/contracts';

/** How much of the reasoning a feed shows. The full text is on the match page. */
export const EXCERPT_LENGTH = 220;

export interface NewVersion {
  fixtureId: string;
  authorId: string;
  predictedOutcome: 'home' | 'draw' | 'away';
  predictedScore: { home: number; away: number } | null;
  confidence: number;
  reasoning: string;
  lineupImpact: string | null;
  keyPlayers: string | null;
  formAndContext: string | null;
}

interface VersionRow {
  id: string;
  version_number: number;
  predicted_outcome: 'home' | 'draw' | 'away';
  predicted_home: number | null;
  predicted_away: number | null;
  confidence: number;
  reasoning: string;
  lineup_impact: string | null;
  key_players: string | null;
  form_and_context: string | null;
  published_at: Date;
}

function toVersion(row: VersionRow): FounderAnalysisVersion {
  return {
    id: row.id,
    version_number: row.version_number,
    predicted_outcome: row.predicted_outcome,
    predicted_score:
      row.predicted_home === null || row.predicted_away === null
        ? null
        : { home: row.predicted_home, away: row.predicted_away },
    confidence: row.confidence as FounderAnalysisVersion['confidence'],
    reasoning: row.reasoning,
    lineup_impact: row.lineup_impact,
    key_players: row.key_players,
    form_and_context: row.form_and_context,
    published_at: row.published_at.toISOString(),
  };
}

interface FeedRow extends VersionRow {
  fixture_id: string;
  kickoff_at: Date;
  status: string;
  home_id: string;
  home_name: string;
  away_id: string;
  away_name: string;
  competition_id: string;
  competition_name: string;
  author_id: string;
  display_name: string;
}

/** Cut at a word boundary, with an ellipsis, so no sentence is chopped mid-word. */
function excerpt(reasoning: string): string {
  if (reasoning.length <= EXCERPT_LENGTH) return reasoning;
  const cut = reasoning.slice(0, EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function toSummary(row: FeedRow): FounderAnalysisSummary {
  return {
    fixture: {
      id: row.fixture_id,
      kickoff_at: row.kickoff_at.toISOString(),
      status: row.status,
      home: { id: row.home_id, name: row.home_name },
      away: { id: row.away_id, name: row.away_name },
      competition: { id: row.competition_id, name: row.competition_name },
    },
    author: { id: row.author_id, display_name: row.display_name },
    predicted_outcome: row.predicted_outcome,
    predicted_score:
      row.predicted_home === null || row.predicted_away === null
        ? null
        : { home: row.predicted_home, away: row.predicted_away },
    confidence: row.confidence as FounderAnalysisSummary['confidence'],
    excerpt: excerpt(row.reasoning),
    published_at: row.published_at.toISOString(),
    version_number: row.version_number,
  };
}

export class FounderStore {
  constructor(private readonly pool: Pool) {}

  /** The analysis for a fixture, newest version first, or `null`. */
  async forFixture(fixtureId: string): Promise<FounderAnalysis | null> {
    const { rows } = await this.pool.query<{
      id: string;
      fixture_id: string;
      author_id: string;
      display_name: string;
    }>(
      `SELECT a.id, a.fixture_id, a.author_id, u.display_name
         FROM founder_analysis a
         JOIN user_account u ON u.id = a.author_id
        WHERE a.fixture_id = $1`,
      [fixtureId],
    );
    const head = rows[0];
    if (head === undefined) return null;

    const versions = await this.pool.query<VersionRow>(
      `SELECT id, version_number, predicted_outcome, predicted_home, predicted_away,
              confidence, reasoning, lineup_impact, key_players, form_and_context, published_at
         FROM founder_analysis_version
        WHERE analysis_id = $1
        ORDER BY version_number DESC`,
      [head.id],
    );
    return {
      id: head.id,
      fixture_id: head.fixture_id,
      author: { id: head.author_id, display_name: head.display_name },
      versions: versions.rows.map(toVersion),
    };
  }

  /**
   * The feed: analyses of matches that have not kicked off, soonest first.
   *
   * Upcoming only, because an analysis of a finished match belongs in the
   * record rather than in a list of what to read next — and because a feed that
   * mixes the two invites reading a call made before the result as though it
   * were made after it.
   */
  async feed(options: {
    limit: number;
    teamId?: string;
    competitionId?: string;
  }): Promise<FounderAnalysisSummary[]> {
    const { rows } = await this.pool.query<FeedRow>(
      `SELECT f.id AS fixture_id, f.kickoff_at, f.status,
              ht.id AS home_id, ht.name AS home_name,
              at.id AS away_id, at.name AS away_name,
              c.id AS competition_id, c.name AS competition_name,
              u.id AS author_id, u.display_name,
              v.predicted_outcome, v.predicted_home, v.predicted_away,
              v.confidence, v.reasoning, v.published_at, v.version_number
         FROM founder_analysis a
         JOIN fixture f ON f.id = a.fixture_id
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN user_account u ON u.id = a.author_id
         JOIN fixture_participant hp ON hp.fixture_id = f.id AND hp.side = 'home'
         JOIN fixture_participant ap ON ap.fixture_id = f.id AND ap.side = 'away'
         JOIN team ht ON ht.id = hp.team_id
         JOIN team at ON at.id = ap.team_id
         JOIN LATERAL (
           SELECT * FROM founder_analysis_version fv
            WHERE fv.analysis_id = a.id
            ORDER BY fv.version_number DESC
            LIMIT 1
         ) v ON true
        WHERE f.kickoff_at > now()
          AND ($2::uuid IS NULL OR hp.team_id = $2 OR ap.team_id = $2)
          AND ($3::uuid IS NULL OR c.id = $3)
        ORDER BY f.kickoff_at
        LIMIT $1`,
      [options.limit, options.teamId ?? null, options.competitionId ?? null],
    );
    return rows.map(toSummary);
  }

  /** Whether the fixture exists at all, so "no analysis" and "no match" differ. */
  async fixtureExists(fixtureId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM fixture WHERE id = $1`, [fixtureId]);
    return rows.length > 0;
  }

  /**
   * Publishes a version, creating the analysis if this is the first one, and
   * writes the audit row in the same transaction.
   *
   * The database refuses a version once the fixture has kicked off (T-130), so
   * that case arrives here as an error with SQLSTATE `PL002` and is translated
   * by the service. Nothing here re-checks the clock: a second opinion about
   * the time is exactly what the trigger exists to make unnecessary.
   */
  async publish(input: NewVersion): Promise<FounderAnalysisVersion> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const analysis = await client.query<{ id: string }>(
        `INSERT INTO founder_analysis (fixture_id, author_id)
         VALUES ($1, $2)
         ON CONFLICT (fixture_id) DO UPDATE SET fixture_id = EXCLUDED.fixture_id
         RETURNING id`,
        [input.fixtureId, input.authorId],
      );
      const analysisId = analysis.rows[0]?.id as string;

      const previous = await client.query<VersionRow>(
        `SELECT id, version_number, predicted_outcome, predicted_home, predicted_away,
                confidence, reasoning, lineup_impact, key_players, form_and_context, published_at
           FROM founder_analysis_version
          WHERE analysis_id = $1
          ORDER BY version_number DESC
          LIMIT 1`,
        [analysisId],
      );
      const nextNumber = (previous.rows[0]?.version_number ?? 0) + 1;

      const written = await client.query<VersionRow>(
        `INSERT INTO founder_analysis_version
           (analysis_id, version_number, predicted_outcome, predicted_home, predicted_away,
            confidence, reasoning, lineup_impact, key_players, form_and_context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, version_number, predicted_outcome, predicted_home, predicted_away,
                   confidence, reasoning, lineup_impact, key_players, form_and_context, published_at`,
        [
          analysisId,
          nextNumber,
          input.predictedOutcome,
          input.predictedScore?.home ?? null,
          input.predictedScore?.away ?? null,
          input.confidence,
          input.reasoning,
          input.lineupImpact,
          input.keyPlayers,
          input.formAndContext,
        ],
      );
      const version = toVersion(written.rows[0] as VersionRow);

      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1, $2, 'founder_analysis', $3, $4, $5::jsonb, $6::jsonb)`,
        [
          input.authorId,
          nextNumber === 1 ? 'founder.publish' : 'founder.update',
          analysisId,
          nextNumber === 1
            ? 'first published version'
            : `updated before kick-off, version ${nextNumber}`,
          previous.rows[0] === undefined
            ? null
            : JSON.stringify(toVersion(previous.rows[0] as VersionRow)),
          JSON.stringify(version),
        ],
      );

      await client.query('COMMIT');
      return version;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
