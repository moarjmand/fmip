/**
 * The SQL for community consensus (T-134). All of it, and nothing else.
 *
 * It reads `user_prediction` / `prediction_version` and `rating_snapshot`
 * directly rather than through the predictions and reputation services. That is
 * the right call here and worth saying why: what this needs is one aggregate
 * over two tables, and asking two public services for every member's prediction
 * and then every member's rating would be the same answer assembled by hand,
 * one query per member, with a race in the middle. CLAUDE.md's rule is that no
 * module imports another module's *internals* — no TypeScript crosses the
 * boundary here, and the tables are the shared schema every store reads.
 */

import type { Pool } from 'pg';
import type { Vote } from './distribution';

interface VoteRow {
  fixture_id: string;
  outcome: 'home' | 'draw' | 'away';
  submitted_at: Date;
  /** `numeric` arrives as a string; `null` unless the rating is established. */
  rating: string | null;
}

export interface Standing {
  votes: Vote[];
  /** When the newest counted prediction was submitted — when this last moved. */
  lastSubmittedAt: Date | null;
}

export class ConsensusStore {
  constructor(private readonly pool: Pool) {}

  async fixtureExists(fixtureId: string): Promise<boolean> {
    const result = await this.pool.query<{ one: number }>(
      `SELECT 1 AS one FROM fixture WHERE id = $1`,
      [fixtureId],
    );
    return result.rowCount === 1;
  }

  /** Which of these fixtures exist, so a list can leave out the ones that do not. */
  async existing(fixtureIds: string[]): Promise<Set<string>> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM fixture WHERE id = ANY($1)`,
      [fixtureIds],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  /**
   * Every member's standing prediction on a fixture, with the rating that
   * weights it.
   *
   * **The standing version is the highest-numbered one**, which is the same
   * version settlement judges (T-052). A member who changed their mind twice
   * counts once, for what they last said — anything else would let a member
   * multiply their own weight by resubmitting.
   *
   * **The rating is the newest snapshot, and only if it is established.** A
   * provisional rating comes back `null` here rather than as a small number,
   * so `distribution.ts` cannot accidentally weight by a value that means "not
   * known yet" (D-052).
   */
  async standing(fixtureId: string): Promise<Standing> {
    return (await this.standingFor([fixtureId])).get(fixtureId) ?? EMPTY;
  }

  /**
   * The same, for several fixtures in one query (T-136).
   *
   * One query rather than one per fixture: a Predictions page asks about a
   * day's matches at once, and twenty round trips to answer one page is how a
   * list endpoint ends up slower than the per-fixture calls it replaced.
   */
  async standingFor(fixtureIds: string[]): Promise<Map<string, Standing>> {
    const result = await this.pool.query<VoteRow>(
      `WITH standing AS (
         SELECT DISTINCT ON (up.fixture_id, up.user_id)
                up.fixture_id, up.user_id, pv.outcome, pv.submitted_at
           FROM user_prediction up
           JOIN prediction_version pv ON pv.prediction_id = up.id
          WHERE up.fixture_id = ANY($1)
          ORDER BY up.fixture_id, up.user_id, pv.version_number DESC
       ),
       newest_rating AS (
         SELECT DISTINCT ON (rs.user_id) rs.user_id, rs.rating, rs.established
           FROM rating_snapshot rs
          WHERE rs.user_id IN (SELECT user_id FROM standing)
          ORDER BY rs.user_id, rs.computed_at DESC
       )
       SELECT s.fixture_id,
              s.outcome,
              s.submitted_at,
              CASE WHEN r.established THEN r.rating END AS rating
         FROM standing s
         LEFT JOIN newest_rating r ON r.user_id = s.user_id`,
      [fixtureIds],
    );

    const byFixture = new Map<string, Standing>();
    for (const row of result.rows) {
      const current = byFixture.get(row.fixture_id) ?? { votes: [], lastSubmittedAt: null };
      current.votes.push({
        outcome: row.outcome,
        rating: row.rating === null ? null : Number(row.rating),
      });
      if (current.lastSubmittedAt === null || row.submitted_at > current.lastSubmittedAt) {
        current.lastSubmittedAt = row.submitted_at;
      }
      byFixture.set(row.fixture_id, current);
    }
    return byFixture;
  }
}

const EMPTY: Standing = { votes: [], lastSubmittedAt: null };
