import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTriggersOff } from './cleanup';

/**
 * The cleanup convention, made enforceable (`docs/03-project-map.md`).
 *
 * The rule has been written down since T-120 and broken thirteen times since,
 * which is what a rule that only lives in prose does. `ALTER TABLE ... DISABLE
 * TRIGGER` is global: while it is off, a suite running in parallel that asserts
 * the same table is immutable **passes without testing anything**. That has
 * already happened once here, to the moderation schema suite.
 *
 * The list below is the remaining offenders, and it may only ever get shorter.
 * It is asserted by equality rather than containment on purpose: a converted
 * file that stays on the list is a list nobody trusts, and a new offender is a
 * failing test on the day it is written rather than a note in a review.
 */
const SRC = join(__dirname, '..');

const NOT_YET_CONVERTED = [
  'modules/admin/admin.http.spec.ts',
  'modules/consensus/consensus.http.spec.ts',
  'modules/founder/founder.http.spec.ts',
  'modules/predictions/lock.http.spec.ts',
  'modules/predictions/predictions.http.spec.ts',
  'modules/predictions/settlement.http.spec.ts',
  'modules/reputation/career-points.http.spec.ts',
  'modules/reputation/leaderboard.http.spec.ts',
  'modules/reputation/reputation.http.spec.ts',
];

function specs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...specs(full));
    else if (entry.name.endsWith('.spec.ts')) found.push(full);
  }
  return found;
}

/** Comments only explain the rule; several files quote it at length. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\r\n])\s*\/\/.*/g, '$1');

// Assembled rather than written out, so this file does not match its own
// search and need an exemption. An exemption is a hole, and this is the one
// file whose holes nobody would think to check.
const FORBIDDEN = new RegExp(['DISABLE', 'TRIGGER'].join(' '));

describe('no spec turns a guard off for everybody else', () => {
  it('leaves exactly the files still waiting to be converted', () => {
    const offenders = specs(SRC)
      .filter((file) => FORBIDDEN.test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(SRC, file).split(sep).join('/'))
      .sort();
    expect(offenders).toEqual([...NOT_YET_CONVERTED].sort());
  });

  it('finds the whole tree, so an empty result is a real result', () => {
    // Without this, a walker that returned nothing would pass the test above
    // the day the list is empty, and keep passing when it broke.
    expect(specs(SRC).length).toBeGreaterThan(50);
  });
});

describe('withTriggersOff', () => {
  const fakePool = (log: string[]) => ({
    connect: async () => ({
      query: async (sql: string) => {
        log.push(sql);
        return undefined;
      },
      release: () => log.push('release'),
    }),
  });

  it('sets the session-local role, never ALTER TABLE, and puts it back', async () => {
    const log: string[] = [];
    await withTriggersOff(fakePool(log) as never, async (client) => {
      await client.query('DELETE FROM forecast');
    });
    expect(log).toEqual([
      "SET session_replication_role = 'replica'",
      'DELETE FROM forecast',
      "SET session_replication_role = 'origin'",
      'release',
    ]);
  });

  it('puts it back when the work throws, and releases the connection', async () => {
    // A connection goes back to the pool carrying whatever session state it
    // left with. One failed cleanup would otherwise hand every later borrower
    // a session with foreign keys switched off.
    const log: string[] = [];
    await expect(
      withTriggersOff(fakePool(log) as never, async () => {
        throw new Error('cleanup blew up');
      }),
    ).rejects.toThrow('cleanup blew up');
    expect(log).toEqual([
      "SET session_replication_role = 'replica'",
      "SET session_replication_role = 'origin'",
      'release',
    ]);
  });
});
