import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Where the seed files live. Resolved from this file so it is correct whether
 * the package is used from source or from `dist`.
 */
export const SEED_DIR = join(__dirname, '..', 'seed');

/** A seed file name: a three-digit order, an underscore, a slug. */
export const SEED_FILENAME = /^(\d{3})_([a-z0-9]+(?:-[a-z0-9]+)*)\.sql$/;

export interface SeedFile {
  filename: string;
  /** Three-digit prefix. Seed files apply in ascending order. */
  order: number;
  name: string;
}

/** The smallest surface of `pg.Client` the runner needs. Tests pass a fake. */
export interface SeedClient {
  query(sql: string): Promise<unknown>;
}

/**
 * Every seed file, lowest order first.
 *
 * Seed files reference each other's rows by fixed UUID, so their order is part
 * of their correctness. Two files with the same prefix have no defined order,
 * which is why that is rejected rather than tolerated.
 */
export function listSeedFiles(dir: string = SEED_DIR): SeedFile[] {
  const files = readdirSync(dir)
    .filter((filename) => filename.endsWith('.sql'))
    .map((filename) => {
      const match = SEED_FILENAME.exec(filename);

      if (match === null) {
        throw new Error(
          `Seed file name does not match <nnn>_<slug>.sql: ${filename}. ` +
            'The numeric prefix is what orders seed files.',
        );
      }

      return { filename, order: Number(match[1]), name: match[2] as string };
    })
    .sort((a, b) => a.order - b.order);

  for (let i = 1; i < files.length; i += 1) {
    const previous = files[i - 1];
    const current = files[i];

    if (previous !== undefined && current !== undefined && previous.order === current.order) {
      throw new Error(
        `Seed files ${previous.filename} and ${current.filename} share an order prefix; ` +
          'their relative order would differ between machines.',
      );
    }
  }

  return files;
}

/**
 * Refuses to seed anywhere it must not.
 *
 * Seed rows are development fixtures. Loading them into a production database
 * would put hand-typed values next to ingested ones with nothing to tell them
 * apart, which is the failure rule 3 in CLAUDE.md exists to prevent.
 */
export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to seed: NODE_ENV is "production". ' +
        'Seed data is a development fixture, not product data.',
    );
  }

  if (env.DATABASE_URL === undefined || env.DATABASE_URL === '') {
    throw new Error('DATABASE_URL is not set. The seed runner needs a database to load into.');
  }
}

/**
 * Applies every seed file, each inside its own transaction.
 *
 * A file that fails is rolled back whole, so the database is never left with
 * half of one seed file. Files already applied stay applied; the seed files
 * are idempotent, so simply re-running converges.
 *
 * @returns the file names applied, in order.
 */
export async function seed(client: SeedClient, dir: string = SEED_DIR): Promise<string[]> {
  const applied: string[] = [];

  for (const file of listSeedFiles(dir)) {
    const sql = readFileSync(join(dir, file.filename), 'utf8');

    await client.query('BEGIN');

    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw new Error(`Seed file ${file.filename} failed and was rolled back.`, { cause: error });
    }

    applied.push(file.filename);
  }

  return applied;
}

async function main(): Promise<void> {
  assertSeedAllowed();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const applied = await seed(client);

    for (const filename of applied) {
      process.stdout.write(`seeded ${filename}\n`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
