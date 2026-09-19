import { Inject, Injectable } from '@nestjs/common';
import type { ModerationSuggestion, SuggestedCategory } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface ReportForAssist {
  id: string;
  reason: string;
  detail: string | null;
}

export interface NewSuggestion {
  reportId: string;
  state: 'published' | 'rejected';
  category: SuggestedCategory | null;
  reasoning: string | null;
  rejection: string | null;
  promptVersion: string;
  model: string;
}

interface SuggestionRow {
  report_id: string;
  version_number: number;
  category: SuggestedCategory;
  reasoning: string;
  prompt_version: string;
  model: string;
  generated_at: Date;
}

/**
 * Suggestions beside reports (T-440): written once, read with the queue.
 * The store reads a report as the assistant may see it -- its reason and
 * the reporter's words -- and nothing else about anybody (T-442).
 */
@Injectable()
export class PostgresSuggestionStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async report(reportId: string): Promise<ReportForAssist | null> {
    const { rows } = await this.pool.query<ReportForAssist>(
      `SELECT id, reason, detail FROM report WHERE id = $1`,
      [reportId],
    );
    return rows[0] ?? null;
  }

  /** Open reports with no attempt on record, oldest first: what a filed report leaves for the catch-up. */
  async unsuggested(limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT r.id FROM report r
        WHERE r.decision_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM moderation_suggestion s WHERE s.report_id = r.id)
        ORDER BY r.created_at
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }

  async latestFor(reportIds: string[]): Promise<Map<string, ModerationSuggestion>> {
    if (reportIds.length === 0) return new Map();
    const { rows } = await this.pool.query<SuggestionRow>(
      `SELECT DISTINCT ON (report_id)
              report_id, version_number, category, reasoning, prompt_version, model, generated_at
         FROM moderation_suggestion
        WHERE report_id = ANY($1::uuid[]) AND state = 'published'
        ORDER BY report_id, version_number DESC`,
      [reportIds],
    );
    return new Map(
      rows.map((row) => [
        row.report_id,
        {
          text: row.reasoning,
          language: 'en',
          model: row.model,
          prompt_version: row.prompt_version,
          generated_at: row.generated_at.toISOString(),
          version_number: row.version_number,
          category: row.category,
          reasoning: row.reasoning,
        },
      ]),
    );
  }

  async add(suggestion: NewSuggestion): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT 1 FROM report WHERE id = $1 FOR UPDATE`, [suggestion.reportId]);
      const next = await client.query<{ n: number }>(
        `SELECT COALESCE(max(version_number), 0) + 1 AS n FROM moderation_suggestion WHERE report_id = $1`,
        [suggestion.reportId],
      );
      const number = next.rows[0]?.n ?? 1;
      await client.query(
        `INSERT INTO moderation_suggestion
           (report_id, version_number, state, category, reasoning, rejection, prompt_version, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          suggestion.reportId,
          number,
          suggestion.state,
          suggestion.category,
          suggestion.reasoning,
          suggestion.rejection,
          suggestion.promptVersion,
          suggestion.model,
        ],
      );
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
