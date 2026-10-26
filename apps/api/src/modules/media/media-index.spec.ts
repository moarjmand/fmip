import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { ENTITY_OF, KIND_OF } from './internal/media-store';
import { MediaService } from './media.service';

/**
 * The read side of a country's flag (T-1611, D-282), with no database: the
 * pool answers the one query `index` sends with stored rows, and records it.
 */
const ENGLAND = 'e0000000-0000-4000-8000-000000000001';
const SPAIN = 'e0000000-0000-4000-8000-000000000002';
const SHA = 'abc123def456'.padEnd(64, '0');

function poolAnswering(rows: Record<string, unknown>[]): {
  pool: Pool;
  calls: { sql: string; params: unknown[] }[];
} {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return Promise.resolve({ rows, rowCount: rows.length });
  };
  return { pool: { query } as never, calls };
}

describe('a country flag in the media index (T-1611)', () => {
  it('is its own kind of its own entity type', () => {
    expect(KIND_OF.country).toBe('flag');
    expect(ENTITY_OF.flag).toBe('country');
  });

  it('answers our own address for a stored flag, and not_supplied for a country with none', async () => {
    const { pool, calls } = poolAnswering([
      { entity_type: 'country', entity_id: ENGLAND, sha256: SHA, content_type: 'image/svg+xml' },
    ]);
    const index = await new MediaService(pool).index({ country: [ENGLAND, SPAIN, ENGLAND] });

    expect(index.flag(ENGLAND)).toEqual({
      coverage: 'available',
      url: `/api/media/flag/${ENGLAND}/abc123def456.svg`,
    });
    expect(index.flag(SPAIN)).toEqual({ coverage: 'not_supplied', url: null });
    // A flag is never read as another kind of the same id.
    expect(index.logo(ENGLAND)).toEqual({ coverage: 'not_supplied', url: null });
    // One query, each country asked once, and never the provider's address.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params[4]).toEqual([ENGLAND, SPAIN]);
    expect(calls[0]?.sql).not.toContain('source_url');
  });

  it('asks nothing when no country is wanted', async () => {
    const { pool, calls } = poolAnswering([]);
    const index = await new MediaService(pool).index({ country: [] });
    expect(index.flag(ENGLAND)).toEqual({ coverage: 'not_supplied', url: null });
    expect(calls).toHaveLength(0);
  });
});
