import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresMappingStore } from './internal/postgres-mapping-store';
import {
  EntityResolver,
  type EntityType,
  type ExternalRef,
  type MappingStore,
  type UnresolvedRow,
} from './internal/resolver';

// Seeded catalog rows (packages/db/seed/001_catalog.sql).
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';
const NOBODY = '00000000-0000-4000-8000-00000000ffff';

interface QueueEntry extends UnresolvedRow {
  payload: unknown;
  resolvedBy: string | null;
  resolvedTo: string | null;
  note: string | null;
}

/**
 * The port, in memory. It has no way to create an entity at all, which is the
 * structural version of "never silently created": the resolver could not do it
 * even by mistake.
 */
class InMemoryMappingStore implements MappingStore {
  readonly mappings = new Map<string, string>();
  readonly queue = new Map<string, QueueEntry>();
  readonly entities = new Map<EntityType, Set<string>>();
  private nextId = 1;

  constructor(existing: ReadonlyArray<readonly [EntityType, string]>) {
    for (const [type, id] of existing) {
      const ids = this.entities.get(type) ?? new Set<string>();
      ids.add(id);
      this.entities.set(type, ids);
    }
  }

  private key(ref: ExternalRef): string {
    return `${ref.provider}|${ref.entityType}|${ref.externalId}`;
  }

  async findMapping(ref: ExternalRef): Promise<string | null> {
    return this.mappings.get(this.key(ref)) ?? null;
  }

  async upsertUnresolved(ref: ExternalRef, payload: unknown): Promise<UnresolvedRow> {
    const key = this.key(ref);
    const existing = this.queue.get(key);

    if (existing !== undefined) {
      existing.seenCount += 1;
      existing.payload = payload ?? existing.payload;
      if (existing.status === 'resolved') {
        // Mirrors the SQL: reopen, clear the resolution, keep its history.
        existing.status = 'pending';
        existing.note = `Reopened: mapping to ${existing.resolvedTo} by ${existing.resolvedBy} no longer exists.`;
        existing.resolvedTo = null;
        existing.resolvedBy = null;
      }
      return { id: existing.id, status: existing.status, seenCount: existing.seenCount };
    }

    const entry: QueueEntry = {
      id: `u${this.nextId++}`,
      status: 'pending',
      seenCount: 1,
      payload,
      resolvedBy: null,
      resolvedTo: null,
      note: null,
    };
    this.queue.set(key, entry);
    return { id: entry.id, status: entry.status, seenCount: entry.seenCount };
  }

  async entityExists(entityType: EntityType, internalId: string): Promise<boolean> {
    return this.entities.get(entityType)?.has(internalId) ?? false;
  }

  async insertMapping(
    ref: ExternalRef,
    internalId: string,
  ): Promise<{ inserted: boolean; internalId: string }> {
    const key = this.key(ref);
    const existing = this.mappings.get(key);

    if (existing !== undefined) {
      return { inserted: false, internalId: existing };
    }

    this.mappings.set(key, internalId);
    return { inserted: true, internalId };
  }

  async markResolved(
    ref: ExternalRef,
    internalId: string,
    actor: string,
    note: string | null,
  ): Promise<void> {
    const entry = this.queue.get(this.key(ref));
    if (entry !== undefined) {
      entry.status = 'resolved';
      entry.resolvedTo = internalId;
      entry.resolvedBy = actor;
      entry.note = note;
    }
  }

  ignore(ref: ExternalRef): void {
    const entry = this.queue.get(this.key(ref));
    if (entry !== undefined) {
      entry.status = 'ignored';
    }
  }

  entityCount(): number {
    let n = 0;
    for (const ids of this.entities.values()) {
      n += ids.size;
    }
    return n;
  }
}

const unknownTeam: ExternalRef = {
  provider: 'api_football',
  entityType: 'team',
  externalId: '9999',
};

function setup(): { store: InMemoryMappingStore; resolver: EntityResolver } {
  const store = new InMemoryMappingStore([
    ['team', LIVERPOOL],
    ['team', MAN_UNITED],
  ]);
  return { store, resolver: new EntityResolver(store) };
}

describe('EntityResolver.resolve', () => {
  it('returns the internal id when the mapping exists', async () => {
    const { store, resolver } = setup();
    await store.insertMapping({ ...unknownTeam, externalId: '40' }, LIVERPOOL);

    await expect(resolver.resolve({ ...unknownTeam, externalId: '40' })).resolves.toEqual({
      kind: 'resolved',
      internalId: LIVERPOOL,
    });
  });

  it('queues an unknown id and creates nothing', async () => {
    const { store, resolver } = setup();
    const before = store.entityCount();

    const result = await resolver.resolve(unknownTeam, { name: 'Some FC' });

    expect(result).toEqual({ kind: 'queued', unresolvedId: 'u1', seenCount: 1 });
    expect(store.entityCount()).toBe(before);
    expect(store.mappings.size).toBe(0);
  });

  it('seeing the same unknown id again is one queue row with a higher count', async () => {
    // The acceptance criterion: queued, never created twice.
    const { store, resolver } = setup();

    const first = await resolver.resolve(unknownTeam);
    const second = await resolver.resolve(unknownTeam);
    const third = await resolver.resolve({ ...unknownTeam });

    expect(first).toEqual({ kind: 'queued', unresolvedId: 'u1', seenCount: 1 });
    expect(second).toEqual({ kind: 'queued', unresolvedId: 'u1', seenCount: 2 });
    expect(third).toEqual({ kind: 'queued', unresolvedId: 'u1', seenCount: 3 });
    expect(store.queue.size).toBe(1);
  });

  it('reports an id a reviewer has chosen to ignore', async () => {
    const { store, resolver } = setup();
    await resolver.resolve(unknownTeam);
    store.ignore(unknownTeam);

    await expect(resolver.resolve(unknownTeam)).resolves.toEqual({
      kind: 'ignored',
      unresolvedId: 'u1',
    });
  });

  it('rejects a reference the schema would reject', async () => {
    const { resolver } = setup();

    await expect(resolver.resolve({ ...unknownTeam, externalId: '  ' })).rejects.toThrow(
      /externalId/,
    );
    await expect(
      resolver.resolve({ ...unknownTeam, provider: 'opta' as ExternalRef['provider'] }),
    ).rejects.toThrow(/provider/);
    await expect(
      resolver.resolve({ ...unknownTeam, entityType: 'player' as EntityType }),
    ).rejects.toThrow(/entity type/);
  });
});

describe('EntityResolver.link', () => {
  it('refuses to point at an entity that does not exist', async () => {
    const { store, resolver } = setup();
    await resolver.resolve(unknownTeam);

    await expect(resolver.link(unknownTeam, NOBODY, 'reviewer')).resolves.toEqual({
      kind: 'unknown_entity',
    });
    expect(store.mappings.size).toBe(0);
    expect(store.queue.get('api_football|team|9999')?.status).toBe('pending');
  });

  it('links, after which the id resolves and the queue row is audited', async () => {
    const { store, resolver } = setup();
    await resolver.resolve(unknownTeam, { name: 'Liverpool FC' });

    const outcome = await resolver.link(
      unknownTeam,
      LIVERPOOL,
      'reviewer',
      'matched by name and city',
    );

    expect(outcome).toEqual({ kind: 'linked', internalId: LIVERPOOL });
    await expect(resolver.resolve(unknownTeam)).resolves.toEqual({
      kind: 'resolved',
      internalId: LIVERPOOL,
    });
    expect(store.queue.get('api_football|team|9999')).toMatchObject({
      status: 'resolved',
      resolvedTo: LIVERPOOL,
      resolvedBy: 'reviewer',
      note: 'matched by name and city',
    });
  });

  it('will not overwrite a mapping that points elsewhere', async () => {
    const { store, resolver } = setup();
    await resolver.link(unknownTeam, LIVERPOOL, 'reviewer');

    await expect(resolver.link(unknownTeam, MAN_UNITED, 'reviewer')).resolves.toEqual({
      kind: 'conflict',
      existingInternalId: LIVERPOOL,
    });
    expect(store.mappings.get('api_football|team|9999')).toBe(LIVERPOOL);
  });

  it('reopens a resolved queue row whose mapping has vanished, keeping the history', async () => {
    const { store, resolver } = setup();
    await resolver.resolve(unknownTeam);
    await resolver.link(unknownTeam, LIVERPOOL, 'reviewer');
    store.mappings.clear();

    await expect(resolver.resolve(unknownTeam)).resolves.toEqual({
      kind: 'queued',
      unresolvedId: 'u1',
      seenCount: 2,
    });
    expect(store.queue.get('api_football|team|9999')).toMatchObject({
      status: 'pending',
      resolvedTo: null,
      resolvedBy: null,
      note: expect.stringContaining(`Reopened: mapping to ${LIVERPOOL} by reviewer`),
    });
  });

  it('treats the same link twice as harmless', async () => {
    const { resolver } = setup();
    await resolver.link(unknownTeam, LIVERPOOL, 'reviewer');

    await expect(resolver.link(unknownTeam, LIVERPOOL, 'reviewer')).resolves.toEqual({
      kind: 'already_linked',
      internalId: LIVERPOOL,
    });
  });

  it('requires an actor and a UUID', async () => {
    const { resolver } = setup();

    await expect(resolver.link(unknownTeam, LIVERPOOL, '')).rejects.toThrow(/actor/);
    await expect(resolver.link(unknownTeam, 'not-a-uuid', 'reviewer')).rejects.toThrow(/UUID/);
  });
});

// Runs only where a database is reachable: on a developer machine with the
// compose stack up. CI has no Postgres service yet, so there it is skipped and
// says so in the report rather than passing vacuously.
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'PostgresMappingStore against the real schema',
  () => {
    let pool: Pool;
    let resolver: EntityResolver;
    // Unique per run so that two runs, or a run that died, cannot collide.
    const ref: ExternalRef = {
      provider: 'highlightly',
      entityType: 'team',
      externalId: `integration-${Date.now()}-${process.pid}`,
    };

    beforeAll(() => {
      pool = new Pool({ connectionString: DATABASE_URL });
      resolver = new EntityResolver(new PostgresMappingStore(pool));
    });

    afterAll(async () => {
      await pool.query(
        'DELETE FROM provider_mapping WHERE provider = $1 AND entity_type = $2 AND external_id = $3',
        [ref.provider, ref.entityType, ref.externalId],
      );
      await pool.query(
        'DELETE FROM unresolved_entity WHERE provider = $1 AND entity_type = $2 AND external_id = $3',
        [ref.provider, ref.entityType, ref.externalId],
      );
      await pool.end();
    });

    it('resolves a seeded API-Football id', async () => {
      await expect(
        resolver.resolve({ provider: 'api_football', entityType: 'team', externalId: '40' }),
      ).resolves.toEqual({ kind: 'resolved', internalId: LIVERPOOL });
    });

    it('queues an unknown id exactly once and counts sightings', async () => {
      const first = await resolver.resolve(ref, { name: 'Integration FC' });
      const second = await resolver.resolve(ref);

      expect(first.kind).toBe('queued');
      expect(second).toEqual({ ...first, seenCount: 2 });

      const { rows } = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM unresolved_entity WHERE provider = $1 AND entity_type = $2 AND external_id = $3',
        [ref.provider, ref.entityType, ref.externalId],
      );
      expect(rows[0]?.n).toBe(1);
    });

    it('refuses to link to a UUID that is not a team', async () => {
      await expect(resolver.link(ref, NOBODY, 'integration-test')).resolves.toEqual({
        kind: 'unknown_entity',
      });
    });

    it('links, resolves, audits, and refuses to relink elsewhere', async () => {
      await expect(resolver.link(ref, LIVERPOOL, 'integration-test', 'test')).resolves.toEqual({
        kind: 'linked',
        internalId: LIVERPOOL,
      });
      await expect(resolver.resolve(ref)).resolves.toEqual({
        kind: 'resolved',
        internalId: LIVERPOOL,
      });

      const { rows } = await pool.query<{
        status: string;
        resolved_by: string;
        resolved_internal_id: string;
      }>(
        'SELECT status, resolved_by, resolved_internal_id FROM unresolved_entity WHERE provider = $1 AND entity_type = $2 AND external_id = $3',
        [ref.provider, ref.entityType, ref.externalId],
      );
      expect(rows[0]).toEqual({
        status: 'resolved',
        resolved_by: 'integration-test',
        resolved_internal_id: LIVERPOOL,
      });

      await expect(resolver.link(ref, MAN_UNITED, 'integration-test')).resolves.toEqual({
        kind: 'conflict',
        existingInternalId: LIVERPOOL,
      });
      await expect(resolver.link(ref, LIVERPOOL, 'integration-test')).resolves.toEqual({
        kind: 'already_linked',
        internalId: LIVERPOOL,
      });
    });

    it('reopens the queue row when the mapping is deleted underneath it', async () => {
      await pool.query(
        'DELETE FROM provider_mapping WHERE provider = $1 AND entity_type = $2 AND external_id = $3',
        [ref.provider, ref.entityType, ref.externalId],
      );

      await expect(resolver.resolve(ref)).resolves.toMatchObject({ kind: 'queued', seenCount: 3 });

      const { rows } = await pool.query<{
        status: string;
        resolved_by: string | null;
        resolved_internal_id: string | null;
        resolution_note: string;
      }>(
        'SELECT status, resolved_by, resolved_internal_id, resolution_note FROM unresolved_entity WHERE provider = $1 AND entity_type = $2 AND external_id = $3',
        [ref.provider, ref.entityType, ref.externalId],
      );
      expect(rows[0]).toMatchObject({
        status: 'pending',
        resolved_by: null,
        resolved_internal_id: null,
        resolution_note: expect.stringContaining(`Reopened: mapping to ${LIVERPOOL}`),
      });
    });
  },
);
