import { Inject, Injectable } from '@nestjs/common';
import type { AdminCompetition } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * The competitions' order in the console (T-1162, D-154): the same write
 * `catalog.mjs --set-order` makes (T-504) -- `competition.display_order` and
 * an `audit_log` row `catalog.competition_order_set` on the competition --
 * with the administrator's reason and the place it had before (rule 10), in
 * one statement so the change and its record cannot part.
 */
@Injectable()
export class PostgresCompetitionOrderStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Every competition, in the order the scores page meets them: stated places first, then by country (international first) and name, as `fixtures/internal/arrange.ts` groups them. */
  async competitions(): Promise<AdminCompetition[]> {
    const { rows } = await this.pool.query<AdminCompetition>(
      `SELECT c.id, c.name, c.short_name, co.name AS country, c.display_order, c.is_active
         FROM competition c
         LEFT JOIN country co ON co.id = c.country_id
        ORDER BY c.display_order NULLS LAST, COALESCE(co.name, ''), c.name, c.id`,
    );
    return rows;
  }

  /**
   * Sets the place (or clears it with `null`) and records it. `null` when no
   * such competition exists. The previous place is read under the row's lock
   * in the same statement.
   */
  async setOrder(
    actorId: string,
    competitionId: string,
    order: number | null,
    reason: string,
  ): Promise<{ previous: number | null; auditId: string } | null> {
    const { rows } = await this.pool.query<{ previous: number | null; audit_id: string }>(
      `WITH before AS (
         SELECT id, display_order FROM competition WHERE id = $2 FOR UPDATE
       ), changed AS (
         UPDATE competition c SET display_order = $3
           FROM before b WHERE c.id = b.id
         RETURNING c.id
       ), recorded AS (
         INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         SELECT $1, 'catalog.competition_order_set', 'competition', b.id::text, $4,
                jsonb_build_object('display_order', b.display_order),
                jsonb_build_object('display_order', $3::smallint)
           FROM before b JOIN changed ch ON ch.id = b.id
         RETURNING id
       )
       SELECT b.display_order AS previous, r.id AS audit_id FROM before b, recorded r`,
      [actorId, competitionId, order, reason],
    );
    const row = rows[0];
    return row === undefined ? null : { previous: row.previous, auditId: row.audit_id };
  }
}
