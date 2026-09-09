import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { PostgresMappingStore } from './internal/postgres-mapping-store';
import { EntityResolver } from './internal/resolver';
import type { ExternalRef, LinkOutcome, Resolution } from './internal/resolver';

// The module's public surface. Other modules import from this file only.
export { ENTITY_TYPES, PROVIDERS } from './internal/resolver';
export type {
  EntityType,
  ExternalRef,
  LinkOutcome,
  Provider,
  Resolution,
} from './internal/resolver';

/**
 * Resolves provider ids to internal UUIDs, queueing the unknown ones.
 *
 * A thin Nest wrapper: the rules live in `internal/resolver.ts` and are tested
 * without a database; the SQL lives in `internal/postgres-mapping-store.ts`
 * and is tested against one.
 */
@Injectable()
export class EntityResolverService {
  private readonly resolver: EntityResolver;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.resolver = new EntityResolver(new PostgresMappingStore(pool));
  }

  /** The mapping if there is one; otherwise the id is queued for review and that is said. */
  resolve(ref: ExternalRef, payload: unknown = null): Promise<Resolution> {
    return this.resolver.resolve(ref, payload);
  }

  /** Records a reviewed identification. The only way a mapping comes to exist. */
  link(
    ref: ExternalRef,
    internalId: string,
    actor: string,
    note: string | null = null,
  ): Promise<LinkOutcome> {
    return this.resolver.link(ref, internalId, actor, note);
  }
}
