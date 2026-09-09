import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the migration files live.
 *
 * Resolved from this file so it is correct whether the package is used from
 * source or from `dist`.
 */
export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

/** A migration file name: a millisecond timestamp, an underscore, a slug. */
export const MIGRATION_FILENAME = /^(\d{13})_([a-z0-9]+(?:-[a-z0-9]+)*)\.sql$/;

export interface Migration {
  filename: string;
  /** Millisecond timestamp prefix. Migrations apply in ascending order. */
  timestamp: number;
  name: string;
}

/**
 * Every migration, oldest first.
 *
 * Order is taken from the timestamp prefix rather than from directory order,
 * which is not guaranteed to be sorted.
 */
export function listMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((filename) => filename.endsWith('.sql'))
    .map((filename) => {
      const match = MIGRATION_FILENAME.exec(filename);

      if (match === null) {
        throw new Error(
          `Migration file name does not match <timestamp>_<slug>.sql: ${filename}. ` +
            'node-pg-migrate orders migrations by this prefix.',
        );
      }

      return { filename, timestamp: Number(match[1]), name: match[2] as string };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}
