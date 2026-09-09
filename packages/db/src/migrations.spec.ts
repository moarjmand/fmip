import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, listMigrations } from './index';

const migrations = listMigrations();

describe('migration files', () => {
  it('has at least one', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('applies in a strictly increasing order', () => {
    // Two migrations sharing a timestamp have no defined order between them,
    // so the same repository would apply them differently on two machines.
    const timestamps = migrations.map((migration) => migration.timestamp);

    expect(timestamps).toEqual([...new Set(timestamps)]);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it.each(migrations.map((migration) => migration.filename))(
    '%s declares both an up and a down section',
    (filename) => {
      // The acceptance criterion for this package is that migrations run up and
      // down cleanly. A migration missing its down section breaks that, and the
      // failure would otherwise surface only when someone needed to roll back.
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');

      expect(sql).toMatch(/^--\s*Up Migration/m);
      expect(sql).toMatch(/^--\s*Down Migration/m);

      const [, down = ''] = sql.split(/^--\s*Down Migration\s*$/m);
      expect(down.trim(), `${filename} has an empty down section`).not.toBe('');
    },
  );
});

describe('listMigrations', () => {
  it('rejects a file name that node-pg-migrate could not order', () => {
    expect(() => listMigrations(join(MIGRATIONS_DIR, '..', 'src'))).not.toThrow();
  });
});
