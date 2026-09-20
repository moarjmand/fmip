import { Inject, Injectable } from '@nestjs/common';
import type { SummaryGrounding } from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { MatchFacts } from './match-facts';

export type SummaryState = 'published' | 'rejected' | 'skipped';

export interface SummaryRow {
  id: string;
  fixture_id: string;
  version_number: number;
  language: string;
  state: SummaryState;
  text: string | null;
  rejection: string | null;
  facts: MatchFacts;
  prompt_version: string;
  model: string;
  generated_at: Date;
}

export interface NewVersion {
  fixtureId: string;
  language: string;
  state: SummaryState;
  text: string | null;
  rejection: string | null;
  facts: MatchFacts;
  factsVersion: string;
  promptVersion: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  requestedBy: string | null;
  /** The editor's reason, kept in the audit log when they asked (rule 10). */
  reason: string | null;
}

/**
 * Match summary versions (T-411): written once, read many. A regeneration
 * is the next version in one transaction with its audit row when an editor
 * asked; rows are never updated (the schema refuses) and the latest
 * published one is what a reader sees.
 */
@Injectable()
export class PostgresMatchSummaryStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async fixtureStatus(fixtureId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ status: string }>(
      `SELECT status FROM fixture WHERE id = $1`,
      [fixtureId],
    );
    return rows[0]?.status ?? null;
  }

  async latestPublished(fixtureId: string): Promise<SummaryRow | null> {
    const { rows } = await this.pool.query<SummaryRow>(
      `SELECT id, fixture_id, version_number, language, state, text, rejection, facts,
              prompt_version, model, generated_at
         FROM match_summary
        WHERE fixture_id = $1 AND state = 'published'
        ORDER BY version_number DESC
        LIMIT 1`,
      [fixtureId],
    );
    return rows[0] ?? null;
  }

  async versions(fixtureId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM match_summary WHERE fixture_id = $1`,
      [fixtureId],
    );
    return rows[0]?.n ?? 0;
  }

  /** Finished matches with no version at all, newest kick-off first: what full time leaves for the catch-up. */
  async unsummarised(since: Date, limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT f.id
         FROM fixture f
        WHERE f.status = 'finished' AND f.kickoff_at >= $1
          AND NOT EXISTS (SELECT 1 FROM match_summary s WHERE s.fixture_id = f.id)
        ORDER BY f.kickoff_at DESC
        LIMIT $2`,
      [since, limit],
    );
    return rows.map((r) => r.id);
  }

  /** The newest version's state, or `null` with none: what the page's reason is read from. */
  /**
   * The highest version number that was `skipped`, or null if none was.
   *
   * Compared against the published version rather than simply read as "the
   * newest state", because a verdict on the record stands until something is
   * published from it: a rejected draft written after a skip is one more bad
   * draft, not a reason to serve the text the skip condemned.
   */
  async latestSkippedVersion(fixtureId: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ version_number: number }>(
      `SELECT version_number FROM match_summary
        WHERE fixture_id = $1 AND state = 'skipped'
        ORDER BY version_number DESC
        LIMIT 1`,
      [fixtureId],
    );
    return rows[0]?.version_number ?? null;
  }

  async latestState(fixtureId: string): Promise<SummaryState | null> {
    const { rows } = await this.pool.query<{ state: SummaryState }>(
      `SELECT state FROM match_summary WHERE fixture_id = $1 ORDER BY version_number DESC LIMIT 1`,
      [fixtureId],
    );
    return rows[0]?.state ?? null;
  }

  async add(version: NewVersion): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The fixture row is the lock: two generations for one match take turns,
      // and the unique (fixture_id, version_number) is the backstop.
      await client.query(`SELECT 1 FROM fixture WHERE id = $1 FOR UPDATE`, [version.fixtureId]);
      const next = await client.query<{ n: number }>(
        `SELECT COALESCE(max(version_number), 0) + 1 AS n FROM match_summary WHERE fixture_id = $1`,
        [version.fixtureId],
      );
      const number = next.rows[0]?.n ?? 1;
      await client.query(
        `INSERT INTO match_summary
           (fixture_id, version_number, language, state, text, rejection, facts, facts_version,
            prompt_version, model, input_tokens, output_tokens, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)`,
        [
          version.fixtureId,
          number,
          version.language,
          version.state,
          version.text,
          version.rejection,
          JSON.stringify(version.facts),
          version.factsVersion,
          version.promptVersion,
          version.model,
          version.inputTokens,
          version.outputTokens,
          version.requestedBy,
        ],
      );
      if (version.requestedBy !== null && version.reason !== null) {
        await audit(client, version, number);
      }
      await client.query('COMMIT');
      return number;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function audit(client: PoolClient, version: NewVersion, number: number): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, 'summary.generate', 'fixture', $2, $3, NULL, $4::jsonb)`,
    [
      version.requestedBy,
      version.fixtureId,
      version.reason,
      JSON.stringify({ version_number: number, state: version.state, model: version.model }),
    ],
  );
}

export function groundingFromRow(row: SummaryRow): SummaryGrounding {
  return {
    timeline: row.facts.timeline.coverage,
    statistics: row.facts.statistics.coverage,
    lineups: row.facts.lineups.coverage,
    forecast: row.facts.forecast.coverage,
    consensus: row.facts.consensus.coverage,
  };
}
