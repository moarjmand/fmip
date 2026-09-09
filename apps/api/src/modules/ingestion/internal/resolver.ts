/**
 * Entity resolution: external id -> internal UUID.
 *
 * Pure logic. No Nest, no `pg`; it talks to a `MappingStore` port so the rules
 * can be tested against an in-memory store and the Postgres store can be
 * tested for SQL alone. The rules (02-architecture.md, "Identity resolution"):
 *
 *   1. `provider_mapping` is the only place a provider id appears.
 *   2. An unknown id is queued for review. It is never guessed into an
 *      existing entity and never turned into a new one.
 *   3. Seeing the same unknown id twice produces one queue row, not two.
 *   4. Linking is explicit, audited, and refuses to point at an entity that
 *      does not exist or to overwrite a mapping that already points elsewhere.
 */

export const PROVIDERS = ['api_football', 'football_data_org', 'highlightly'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ENTITY_TYPES = [
  'country',
  'competition',
  'season',
  'stage',
  'venue',
  'team',
  'person',
  'fixture',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** A provider's name for one of our entities. */
export interface ExternalRef {
  provider: Provider;
  entityType: EntityType;
  externalId: string;
}

export type UnresolvedStatus = 'pending' | 'resolved' | 'ignored';

export interface UnresolvedRow {
  id: string;
  status: UnresolvedStatus;
  seenCount: number;
}

export type Resolution =
  /** The mapping exists. */
  | { kind: 'resolved'; internalId: string }
  /** No mapping; the id is in the review queue (first time or again). */
  | { kind: 'queued'; unresolvedId: string; seenCount: number }
  /** No mapping, and a reviewer has decided this id is not ours to model. */
  | { kind: 'ignored'; unresolvedId: string };

export type LinkOutcome =
  | { kind: 'linked'; internalId: string }
  /** The exact same mapping was already there. Harmless. */
  | { kind: 'already_linked'; internalId: string }
  /** The external id already maps to a different entity. Nothing was changed. */
  | { kind: 'conflict'; existingInternalId: string }
  /** No row with that UUID exists in the entity's table. Nothing was changed. */
  | { kind: 'unknown_entity' };

/**
 * What the resolver needs from storage. Every method is a single statement's
 * worth of intent; the Postgres implementation is in `postgres-mapping-store.ts`.
 */
export interface MappingStore {
  /** The internal id for `ref`, or `null`. Implementations may record the sighting. */
  findMapping(ref: ExternalRef): Promise<string | null>;
  /** Insert the queue row, or bump `seenCount` and `lastSeenAt` on the existing one. */
  upsertUnresolved(ref: ExternalRef, payload: unknown): Promise<UnresolvedRow>;
  /** Whether a row with `internalId` exists in the table for `entityType`. */
  entityExists(entityType: EntityType, internalId: string): Promise<boolean>;
  /**
   * Insert the mapping unless one exists for `ref`. Returns whether a row was
   * inserted and the id the mapping now points at (the existing one if not).
   */
  insertMapping(
    ref: ExternalRef,
    internalId: string,
  ): Promise<{ inserted: boolean; internalId: string }>;
  /** Close the queue row for `ref` with the audit fields. No-op if there is none. */
  markResolved(
    ref: ExternalRef,
    internalId: string,
    actor: string,
    note: string | null,
  ): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rejects a reference the schema would reject, with a message that names the field. */
export function assertExternalRef(ref: ExternalRef): void {
  if (!(PROVIDERS as readonly string[]).includes(ref.provider)) {
    throw new TypeError(`Unknown provider: ${String(ref.provider)}`);
  }

  if (!(ENTITY_TYPES as readonly string[]).includes(ref.entityType)) {
    throw new TypeError(`Unknown entity type: ${String(ref.entityType)}`);
  }

  if (typeof ref.externalId !== 'string' || ref.externalId.trim() === '') {
    throw new TypeError('externalId must be a non-blank string');
  }
}

export class EntityResolver {
  constructor(private readonly store: MappingStore) {}

  /**
   * Resolves `ref`, queueing it if unknown.
   *
   * `payload` is what the adapter wants a reviewer to see (a name, a country,
   * a date). It is stored with the queue row and nowhere else.
   */
  async resolve(ref: ExternalRef, payload: unknown = null): Promise<Resolution> {
    assertExternalRef(ref);

    const internalId = await this.store.findMapping(ref);
    if (internalId !== null) {
      return { kind: 'resolved', internalId };
    }

    const row = await this.store.upsertUnresolved(ref, payload);
    if (row.status === 'ignored') {
      return { kind: 'ignored', unresolvedId: row.id };
    }

    return { kind: 'queued', unresolvedId: row.id, seenCount: row.seenCount };
  }

  /**
   * Records that `ref` is `internalId`. This is the only way a mapping is
   * created, and it is meant to be called by a reviewer or a rule that has
   * positively identified the entity, not by an adapter.
   */
  async link(
    ref: ExternalRef,
    internalId: string,
    actor: string,
    note: string | null = null,
  ): Promise<LinkOutcome> {
    assertExternalRef(ref);

    if (!UUID.test(internalId)) {
      throw new TypeError(`internalId must be a UUID, received: ${internalId}`);
    }

    if (actor.trim() === '') {
      throw new TypeError('actor is required: resolutions are audited');
    }

    if (!(await this.store.entityExists(ref.entityType, internalId))) {
      return { kind: 'unknown_entity' };
    }

    const result = await this.store.insertMapping(ref, internalId);
    if (!result.inserted && result.internalId !== internalId) {
      return { kind: 'conflict', existingInternalId: result.internalId };
    }

    await this.store.markResolved(ref, internalId, actor, note);

    return result.inserted
      ? { kind: 'linked', internalId }
      : { kind: 'already_linked', internalId };
  }
}
