import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A value in the server's .env reaches the API container only when
// deploy/docker-compose.prod.yml names it in the api service's environment.
// INGESTION_SQUADS_PER_DAY was documented in .env.example from T-1324 and set
// on production for T-1632's backlog, but the file never named it, so the
// API kept its default of 60 (T-1638). Every setting .env.example documents
// that the API's code reads must be forwarded.

const ROOT = join(__dirname, '..', '..', '..');
const read = (...path: string[]): string => readFileSync(join(ROOT, ...path), 'utf8');

/** The names .env.example documents: each `NAME=` line. */
function documented(): Set<string> {
  return new Set([...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!));
}

/** The names the API's own code (not its specs) reads from the environment. */
function readByApi(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        const text = readFileSync(path, 'utf8');
        // `process.env.NAME`, and `env.NAME` on an environment handed to a parser.
        for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)) names.add(m[1]!);
        for (const m of text.matchAll(/\benv\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) names.add(m[1]!);
      }
    }
  };
  walk(join(ROOT, 'apps', 'api', 'src'));
  return names;
}

/** The names the api service's environment block sets in the production compose file. */
function forwardedToApi(): Set<string> {
  const lines = read('deploy', 'docker-compose.prod.yml').split('\n');
  const start = lines.findIndex((line) => line === '  api:');
  const end = lines.findIndex((line, i) => i > start && /^ {2}[a-z][a-z0-9-]*:\s*$/.test(line));
  const block = lines.slice(start, end === -1 ? undefined : end);
  return new Set(
    block.flatMap((line) => {
      const m = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
      return m ? [m[1]!] : [];
    }),
  );
}

describe('the production compose file (T-1638)', () => {
  it('finds the api service and its environment', () => {
    const forwarded = forwardedToApi();
    expect(forwarded.has('DATABASE_URL')).toBe(true);
    expect(forwarded.has('INGESTION_SCHEDULE')).toBe(true);
  });

  it('forwards to the API every setting .env.example documents that the API reads', () => {
    const forwarded = forwardedToApi();
    const apiReads = readByApi();
    const missing = [...documented()]
      .filter((name) => apiReads.has(name) && !forwarded.has(name))
      .sort();
    expect(missing).toEqual([]);
    // Reading every source file of the API can outlast the default 5 s on a cold disk.
  }, 30_000);
});
