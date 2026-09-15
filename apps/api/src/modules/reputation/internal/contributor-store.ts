import { Inject, Injectable } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { EligibilityFacts, EligibilityRules } from './eligibility';

/**
 * The SQL for contributor eligibility and contributor grants (T-250). All of
 * it, and nothing else.
 *
 * The rules are not here. Which thresholds apply is `eligibility.ts`; what a
 * grant's standing is, and which transitions are impossible, is the schema's —
 * `contributor_grant_standing()` and the `PL013` triggers. This file reads what
 * the tables say and writes what the service decided, and re-implements neither
 * (the reason `moderation-store.ts` gives: two copies of a safety rule are one
 * copy and one decoration).
 */

export interface GrantRow {
  id: string;
  username: string;
  standing: string;
  granted_by: string;
  reason: string;
  granted_at: Date;
  rules_version: string;
  accepted_at: Date;
}

export interface GrantEventRow {
  kind: string;
  actor: string;
  reason: string;
  at: Date;
}

export interface CandidateRow {
  user_id: string;
  username: string;
  facts: EligibilityFacts;
}

/**
 * What both reads select, with the conduct window's placeholder spelled by the
 * caller because the two queries number their parameters differently.
 *
 * The window is applied in SQL rather than in TypeScript so that "now" is the
 * database's — the same clock that decided `under_sanction`. The number itself
 * still comes from `ELIGIBILITY_V1`: one home for the value, one clock for the
 * comparison.
 */
function factColumns(windowParam: string): string {
  return `user_id,
          username,
          email_verified,
          rating,
          settled_count,
          under_sanction,
          last_sanctioned_at,
          (last_sanctioned_at IS NOT NULL
             AND last_sanctioned_at > now() - make_interval(days => ${windowParam}))
            AS recently_sanctioned`;
}

interface FactRow {
  user_id: string;
  username: string;
  email_verified: boolean;
  rating: string | null;
  settled_count: number | null;
  under_sanction: boolean;
  last_sanctioned_at: Date | null;
  recently_sanctioned: boolean;
}

function facts(row: FactRow): EligibilityFacts {
  return {
    // `numeric` arrives as a string from pg, and a member with no snapshot has
    // no rating at all — which is not a rating of zero.
    rating: row.rating === null ? null : Number(row.rating),
    settled_count: row.settled_count ?? 0,
    email_verified: row.email_verified,
    under_sanction: row.under_sanction,
    recently_sanctioned: row.recently_sanctioned,
    last_sanctioned_at: row.last_sanctioned_at?.toISOString() ?? null,
  };
}

@Injectable()
export class PostgresContributorStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The four requirements' inputs for one member, or null if there is no such member. */
  async factsFor(userId: string, windowDays: number): Promise<EligibilityFacts | null> {
    const { rows } = await this.pool.query<FactRow>(
      `SELECT ${factColumns('$2')}
         FROM contributor_eligibility_input WHERE user_id = $1`,
      [userId, windowDays],
    );
    const row = rows[0];
    return row === undefined ? null : facts(row);
  }

  /**
   * The member's newest grant with its whole history, or null if they have never
   * held one.
   *
   * Newest rather than live: a withdrawn grant is still the answer to "what
   * happened to you", and a member shown nothing at all could not tell being
   * stopped apart from never having been considered.
   */
  async grantFor(userId: string): Promise<{ grant: GrantRow; history: GrantEventRow[] } | null> {
    const { rows } = await this.pool.query<GrantRow>(
      `SELECT g.id,
              holder.username,
              contributor_grant_standing(g.id) AS standing,
              approver.username AS granted_by,
              g.reason,
              g.created_at AS granted_at,
              g.rules_version,
              g.accepted_at
         FROM contributor_grant g
         JOIN user_account holder   ON holder.id = g.user_id
         JOIN user_account approver ON approver.id = g.granted_by
        WHERE g.user_id = $1
        ORDER BY g.created_at DESC
        LIMIT 1`,
      [userId],
    );
    const grant = rows[0];
    if (grant === undefined) return null;
    return { grant, history: await this.historyOf(grant.id) };
  }

  /** Oldest first: it is a story, and a story is read forwards. */
  async historyOf(grantId: string): Promise<GrantEventRow[]> {
    const { rows } = await this.pool.query<GrantEventRow>(
      `SELECT e.kind, actor.username AS actor, e.reason, e.created_at AS at
         FROM contributor_grant_event e
         JOIN user_account actor ON actor.id = e.actor_id
        WHERE e.grant_id = $1
        ORDER BY e.created_at, e.seq`,
      [grantId],
    );
    return rows;
  }

  /** The live grant's id, or null. What a pause, resume or withdrawal acts on. */
  async liveGrantId(userId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM contributor_grant
        WHERE user_id = $1 AND contributor_grant_standing(id) <> 'withdrawn'
        LIMIT 1`,
      [userId],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Everybody an administrator might be deciding about: members who qualify and
   * members who already hold a grant.
   *
   * Both, in one list, on purpose. A queue of only the qualified would hide the
   * paused and the withdrawn — the people a reviewer is most likely to be
   * looking for — and a queue of only grant-holders would never show anybody
   * new.
   */
  async candidates(rules: EligibilityRules, limit: number): Promise<CandidateRow[]> {
    const { rows } = await this.pool.query<FactRow>(
      `SELECT ${factColumns('$1')}
         FROM contributor_eligibility_input i
        WHERE EXISTS (SELECT 1 FROM contributor_grant g WHERE g.user_id = i.user_id)
           OR (i.email_verified
               AND i.rating IS NOT NULL
               AND i.rating >= $2
               AND i.settled_count >= $3
               AND NOT i.under_sanction)
        ORDER BY i.rating DESC NULLS LAST, i.username
        LIMIT $4`,
      // The thresholds arrive as parameters rather than being written here, for
      // the same reason the view carries no verdict: one home for the numbers.
      // This filter decides only who is worth showing a reviewer; whether each
      // of them qualifies is `eligibilityFor`, applied to every row that comes
      // back — so a row admitted by a loose filter is still judged properly.
      [rules.conductWindowDays, rules.minRating, rules.minSettled, limit],
    );
    return rows.map((row) => ({ user_id: row.user_id, username: row.username, facts: facts(row) }));
  }

  /**
   * Approve somebody, and record who did it in the same transaction (rule 10,
   * D-046). A grant whose audit row could fail separately is a grant that might
   * exist with nobody's name on it.
   */
  async grant(
    userId: string,
    grantedBy: string,
    reason: string,
    rulesVersion: string,
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        [userId, grantedBy, reason, rulesVersion],
      );
      const id = rows[0]?.id ?? '';
      await this.record(client, grantedBy, 'contributor.grant', userId, reason, null, {
        grant_id: id,
        standing: 'active',
        rules_version: rulesVersion,
      });
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Pause, resume or withdraw, with the standing it had before recorded next to
   * the one it has now — rule 10 asks for the previous value, and "paused" with
   * no "was active" beside it does not say what changed.
   */
  async addEvent(
    grantId: string,
    kind: 'paused' | 'resumed' | 'withdrawn',
    actorId: string,
    reason: string,
    subjectId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ standing: string }>(
        `SELECT contributor_grant_standing($1) AS standing`,
        [grantId],
      );
      const previous = rows[0]?.standing ?? 'active';
      // The trigger decides whether this is possible (PL013). Asking first and
      // then inserting would be two answers to one question, and the second one
      // is the one that counts.
      await client.query(
        `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
         VALUES ($1, $2, $3, $4)`,
        [grantId, kind, actorId, reason],
      );
      await this.record(
        client,
        actorId,
        `contributor.${kind === 'withdrawn' ? 'withdraw' : kind === 'paused' ? 'pause' : 'resume'}`,
        subjectId,
        reason,
        { grant_id: grantId, standing: previous },
        { grant_id: grantId, standing: kind === 'resumed' ? 'active' : kind },
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async record(
    client: PoolClient,
    actorId: string,
    action: string,
    targetId: string,
    reason: string,
    previous: Record<string, unknown> | null,
    next: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
       VALUES ($1, $2, 'user_account', $3, $4, $5::jsonb, $6::jsonb)`,
      [
        actorId,
        action,
        targetId,
        reason,
        previous === null ? null : JSON.stringify(previous),
        JSON.stringify(next),
      ],
    );
  }
}
