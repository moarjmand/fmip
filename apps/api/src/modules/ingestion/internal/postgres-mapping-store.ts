import type { Pool } from 'pg';
import type {
  EntityType,
  ExternalRef,
  MappingStore,
  UnresolvedRow,
  UnresolvedStatus,
} from './resolver';

/** The one method of `pg.Pool` this store uses. Tests may pass a `Client` or a fake. */
export type Queryable = Pick<Pool, 'query'>;

/**
 * Which table holds each entity type. An allow-list, because a table name
 * cannot be a bound parameter: `entityExists` interpolates from this map and
 * from nothing else.
 */
const ENTITY_TABLE: Record<EntityType, string> = {
  country: 'country',
  competition: 'competition',
  season: 'season',
  stage: 'stage',
  venue: 'venue',
  team: 'team',
  person: 'person',
  fixture: 'fixture',
};

/**
 * `MappingStore` over `provider_mapping` and `unresolved_entity` (T-012,
 * T-013). Plain SQL with bound parameters (D-025). Each method is one
 * statement, so the resolver's sequencing is the only transaction logic there
 * is; the constraints in the schema make the sequence safe under concurrency.
 */
export class PostgresMappingStore implements MappingStore {
  constructor(private readonly db: Queryable) {}

  async findMapping(ref: ExternalRef): Promise<string | null> {
    // An UPDATE rather than a SELECT so that every successful resolution
    // refreshes last_seen_at; that is how "provider stopped sending id X" can
    // be noticed later.
    const { rows } = await this.db.query<{ internal_id: string }>(
      `UPDATE provider_mapping
          SET last_seen_at = now()
        WHERE provider = $1 AND entity_type = $2 AND external_id = $3
        RETURNING internal_id`,
      [ref.provider, ref.entityType, ref.externalId],
    );

    return rows[0]?.internal_id ?? null;
  }

  async upsertUnresolved(ref: ExternalRef, payload: unknown): Promise<UnresolvedRow> {
    // ON CONFLICT on the unique triple is what makes "seen twice" one row.
    //
    // We only get here when findMapping found nothing, so a row that says
    // 'resolved' is stale: its mapping has since vanished. It is reopened as
    // pending, its resolution fields are cleared (the schema requires a pending
    // row to carry none), and the old resolution is kept in resolution_note so
    // the history is not lost. An ignored row stays ignored.
    const { rows } = await this.db.query<{
      id: string;
      status: UnresolvedStatus;
      seen_count: number;
    }>(
      `INSERT INTO unresolved_entity (provider, entity_type, external_id, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (provider, entity_type, external_id) DO UPDATE
           SET last_seen_at = now(),
               seen_count   = unresolved_entity.seen_count + 1,
               payload      = COALESCE(EXCLUDED.payload, unresolved_entity.payload),
               status       = CASE
                                WHEN unresolved_entity.status = 'resolved' THEN 'pending'
                                ELSE unresolved_entity.status
                              END,
               resolved_internal_id = CASE
                                WHEN unresolved_entity.status = 'resolved' THEN NULL
                                ELSE unresolved_entity.resolved_internal_id
                              END,
               resolved_by  = CASE
                                WHEN unresolved_entity.status = 'resolved' THEN NULL
                                ELSE unresolved_entity.resolved_by
                              END,
               resolved_at  = CASE
                                WHEN unresolved_entity.status = 'resolved' THEN NULL
                                ELSE unresolved_entity.resolved_at
                              END,
               resolution_note = CASE
                                WHEN unresolved_entity.status = 'resolved' THEN format(
                                  'Reopened: mapping to %s by %s at %s no longer exists.',
                                  unresolved_entity.resolved_internal_id,
                                  unresolved_entity.resolved_by,
                                  unresolved_entity.resolved_at
                                )
                                ELSE unresolved_entity.resolution_note
                              END
         RETURNING id, status, seen_count`,
      [
        ref.provider,
        ref.entityType,
        ref.externalId,
        payload === null ? null : JSON.stringify(payload),
      ],
    );

    const row = rows[0];
    if (row === undefined) {
      throw new Error('unresolved_entity upsert returned no row');
    }

    return { id: row.id, status: row.status, seenCount: row.seen_count };
  }

  async entityExists(entityType: EntityType, internalId: string): Promise<boolean> {
    const table = ENTITY_TABLE[entityType];
    const { rowCount } = await this.db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [internalId]);

    return (rowCount ?? 0) > 0;
  }

  async insertMapping(
    ref: ExternalRef,
    internalId: string,
  ): Promise<{ inserted: boolean; internalId: string }> {
    const inserted = await this.db.query<{ internal_id: string }>(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, external_id, entity_type) DO NOTHING
         RETURNING internal_id`,
      [ref.provider, ref.entityType, ref.externalId, internalId],
    );

    const insertedId = inserted.rows[0]?.internal_id;
    if (insertedId !== undefined) {
      return { inserted: true, internalId: insertedId };
    }

    const existing = await this.db.query<{ internal_id: string }>(
      `SELECT internal_id FROM provider_mapping
        WHERE provider = $1 AND entity_type = $2 AND external_id = $3`,
      [ref.provider, ref.entityType, ref.externalId],
    );

    const existingId = existing.rows[0]?.internal_id;
    if (existingId === undefined) {
      // DO NOTHING fired, yet the row is gone: a concurrent delete between the
      // two statements. Report it rather than pretend either outcome.
      throw new Error('provider_mapping row disappeared between insert and read');
    }

    return { inserted: false, internalId: existingId };
  }

  async markResolved(
    ref: ExternalRef,
    internalId: string,
    actor: string,
    note: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE unresolved_entity
          SET status               = 'resolved',
              resolved_internal_id = $4,
              resolved_by          = $5,
              resolved_at          = now(),
              resolution_note      = $6
        WHERE provider = $1 AND entity_type = $2 AND external_id = $3`,
      [ref.provider, ref.entityType, ref.externalId, internalId, actor, note],
    );
  }
}
