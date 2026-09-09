import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SEED_DIR, assertSeedAllowed, listSeedFiles, seed } from './seed';

const seedFiles = listSeedFiles();

describe('seed files', () => {
  it('has at least one', () => {
    expect(seedFiles.length).toBeGreaterThan(0);
  });

  it('applies in a strictly increasing order', () => {
    const orders = seedFiles.map((file) => file.order);

    expect(orders).toEqual([...new Set(orders)]);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it.each(seedFiles.map((file) => file.filename))('%s upserts every insert', (filename) => {
    // The acceptance criterion is "seed data loads", and a developer loads it
    // more than once. Every INSERT therefore has to say what happens on a
    // second run; a bare INSERT would duplicate or, with fixed ids, fail.
    const sql = readFileSync(join(SEED_DIR, filename), 'utf8');
    const inserts = sql.match(/^INSERT INTO/gm) ?? [];
    const upserts = sql.match(/^ON CONFLICT \(id\) DO UPDATE SET/gm) ?? [];

    expect(inserts.length).toBeGreaterThan(0);
    expect(upserts.length).toBe(inserts.length);
  });
});

describe('listSeedFiles', () => {
  it('rejects a file name without an order prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fmip-seed-'));
    writeFileSync(join(dir, 'catalog.sql'), '-- no prefix');

    expect(() => listSeedFiles(dir)).toThrow(/does not match/);
  });

  it('rejects two files sharing an order prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fmip-seed-'));
    writeFileSync(join(dir, '001_a.sql'), '--');
    writeFileSync(join(dir, '001_b.sql'), '--');

    expect(() => listSeedFiles(dir)).toThrow(/share an order prefix/);
  });
});

describe('assertSeedAllowed', () => {
  it('refuses to run in production', () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }),
    ).toThrow(/production/);
  });

  it('refuses to run without a database', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
    expect(() => assertSeedAllowed({ NODE_ENV: 'development', DATABASE_URL: '' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('allows development with a database', () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x' }),
    ).not.toThrow();
  });
});

describe('seed', () => {
  function fakeClient(failOn?: string) {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (failOn !== undefined && sql.includes(failOn)) {
        throw new Error('boom');
      }
    });

    return { client: { query }, statements };
  }

  it('wraps each file in its own transaction, in order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fmip-seed-'));
    writeFileSync(join(dir, '002_second.sql'), 'SELECT 2;');
    writeFileSync(join(dir, '001_first.sql'), 'SELECT 1;');
    const { client, statements } = fakeClient();

    await expect(seed(client, dir)).resolves.toEqual(['001_first.sql', '002_second.sql']);
    expect(statements).toEqual(['BEGIN', 'SELECT 1;', 'COMMIT', 'BEGIN', 'SELECT 2;', 'COMMIT']);
  });

  it('rolls back the failing file and names it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fmip-seed-'));
    writeFileSync(join(dir, '001_ok.sql'), 'SELECT 1;');
    writeFileSync(join(dir, '002_bad.sql'), 'SELECT bad;');
    const { client, statements } = fakeClient('bad');

    await expect(seed(client, dir)).rejects.toThrow(/002_bad\.sql failed/);
    expect(statements).toEqual([
      'BEGIN',
      'SELECT 1;',
      'COMMIT',
      'BEGIN',
      'SELECT bad;',
      'ROLLBACK',
    ]);
  });
});
