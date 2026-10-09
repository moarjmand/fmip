import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain script, deliberately not part of the TypeScript build.
import * as pairs from '../scripts/highlightly-pairs.mjs';

/**
 * `scripts/highlightly-pairs.mjs` (T-1370): Highlightly's teams paired with
 * ours by matching kick-offs, for a person to confirm. The votes are pure and
 * tested here first; the write is tested against the real schema when
 * `DATABASE_URL` is set.
 */

interface Side {
  externalId: string;
  name: string;
}
interface Ours {
  teamId: string;
  name: string;
}
interface Row {
  highlightlyId: string;
  highlightlyName: string;
  teamId: string;
  teamName: string;
  votes: number;
  conflicts: number;
  similarity: number;
  strength: 'strong' | 'weak' | 'refused';
  note: string | null;
  fixtures: string[];
}
interface Suggestion {
  rows: Row[];
  stats: {
    matches: number;
    uniqueFit: number;
    noFit: number;
    ambiguous: number;
    alreadyMapped: number;
  };
}
interface Outcome {
  written: Row[];
  skipped: { row: Row; reason: string }[];
  refused: { row: Row; reason: string }[];
  audited: boolean;
}
interface Parsed {
  error?: string;
  command?: string;
  daysBack?: number;
  daysAhead?: number;
  maxRequests?: number;
  by?: string;
  from?: string;
}

const {
  STRONG_VOTES,
  WINDOW_MINUTES,
  applyStrong,
  collectMatches,
  dayRange,
  fitsOf,
  formatTable,
  nameSimilarity,
  normaliseName,
  parseArgs,
  planRequests,
  seasonForDay,
  suggestPairs,
} = pairs as {
  STRONG_VOTES: number;
  WINDOW_MINUTES: number;
  applyStrong: (client: pg.ClientBase, rows: Row[], by: string) => Promise<Outcome>;
  collectMatches: (
    adapter: { listFixtures: (q: Record<string, string>) => Promise<unknown> },
    calls: unknown[],
  ) => Promise<{ matches: unknown[]; problems: string[]; requests: number; stopped: boolean }>;
  dayRange: (today: string, back: number, ahead: number) => string[];
  fitsOf: (
    match: unknown,
    fixtures: unknown[],
    mappedHl: Map<string, string>,
    windowMinutes?: number,
  ) => unknown[];
  formatTable: (rows: Row[]) => string;
  nameSimilarity: (a: string, b: string) => number;
  normaliseName: (name: string) => string;
  parseArgs: (argv: string[]) => Parsed;
  planRequests: (
    leagues: unknown[],
    seasons: Map<string, unknown[]>,
    days: string[],
  ) => {
    calls: { from: string; to: string; days: number; seasonLabel: string }[];
    requests: number;
  };
  seasonForDay: (seasons: unknown[], day: string) => { label: string } | null;
  suggestPairs: (input: {
    matches: unknown[];
    fixtures: unknown[];
    mappedHl: Map<string, string>;
    ourMapped: Map<string, string>;
  }) => Suggestion;
};

const COMP = 'c0000000-0000-4000-8000-000000000001';
const OTHER_COMP = 'c0000000-0000-4000-8000-000000000002';
const t = (id: number): Ours => ({
  teamId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  name: `Our ${id}`,
});
const h = (id: number, name = `Their ${id}`): Side => ({ externalId: String(9000 + id), name });

function hlMatch(home: Side, away: Side, kickoffAt: string, competitionId = COMP) {
  return { competitionId, kickoffAt, home, away };
}
let fixtureSeq = 0;
function ourFixture(home: Ours, away: Ours, kickoffAt: string, competitionId = COMP) {
  fixtureSeq += 1;
  return { fixtureId: `f${fixtureSeq}`, competitionId, kickoffAt, home, away };
}
function suggest(
  matches: unknown[],
  fixtures: unknown[],
  mapped: [string, string][] = [],
): Suggestion {
  return suggestPairs({
    matches,
    fixtures,
    mappedHl: new Map(mapped),
    ourMapped: new Map(mapped.map(([hl, ours]) => [ours, hl])),
  });
}
const rowFor = (s: Suggestion, side: Side) =>
  s.rows.find((r) => r.highlightlyId === side.externalId);

describe('the window and the unique fit', () => {
  const kick = '2026-10-04T14:00:00.000Z';

  it('is 15 minutes either way, inclusive, and in the same competition only', () => {
    expect(WINDOW_MINUTES).toBe(15);
    const match = hlMatch(h(1), h(2), kick);
    const at = (iso: string, comp = COMP) => ourFixture(t(1), t(2), iso, comp);
    expect(fitsOf(match, [at('2026-10-04T14:15:00.000Z')], new Map())).toHaveLength(1);
    expect(fitsOf(match, [at('2026-10-04T13:45:00.000Z')], new Map())).toHaveLength(1);
    expect(fitsOf(match, [at('2026-10-04T14:15:01.000Z')], new Map())).toHaveLength(0);
    expect(fitsOf(match, [at('2026-10-04T13:44:59.000Z')], new Map())).toHaveLength(0);
    expect(fitsOf(match, [at(kick, OTHER_COMP)], new Map())).toHaveLength(0);
  });

  it('pairs home with home and away with away when exactly one of ours fits', () => {
    const s = suggest([hlMatch(h(1), h(2), kick)], [ourFixture(t(1), t(2), kick)]);
    expect(s.stats.uniqueFit).toBe(1);
    expect(rowFor(s, h(1))?.teamId).toBe(t(1).teamId);
    expect(rowFor(s, h(2))?.teamId).toBe(t(2).teamId);
  });

  it('casts no vote when two of ours kick off in the window, or none does', () => {
    const s = suggest(
      [hlMatch(h(1), h(2), kick), hlMatch(h(5), h(6), '2026-10-05T18:00:00.000Z')],
      [ourFixture(t(1), t(2), kick), ourFixture(t(3), t(4), '2026-10-04T14:10:00.000Z')],
    );
    expect(s.stats).toMatchObject({ matches: 2, uniqueFit: 0, ambiguous: 1, noFit: 1 });
    expect(s.rows).toEqual([]);
  });

  it('lets a side already mapped decide between two of ours, and rule one out', () => {
    // Saturday 15:00: two of ours in the window; Highlightly's home side is
    // already mapped to our 3, so only the second can be this match.
    const s = suggest(
      [hlMatch(h(3), h(4), kick)],
      [ourFixture(t(1), t(2), kick), ourFixture(t(3), t(4), kick)],
      [[h(3).externalId, t(3).teamId]],
    );
    expect(s.stats.uniqueFit).toBe(1);
    expect(rowFor(s, h(4))?.teamId).toBe(t(4).teamId);
    // And a single fit that a mapped side contradicts is no fit at all.
    const contradicted = suggest(
      [hlMatch(h(3), h(4), kick)],
      [ourFixture(t(1), t(2), kick)],
      [[h(3).externalId, t(3).teamId]],
    );
    expect(contradicted.stats.noFit).toBe(1);
    expect(contradicted.rows).toEqual([]);
  });
});

describe('votes and strength', () => {
  const days = ['2026-10-01', '2026-10-04', '2026-10-08'].map((d) => `${d}T19:00:00.000Z`);

  it(`is strong at ${STRONG_VOTES} agreeing votes with none against, weak on one`, () => {
    expect(STRONG_VOTES).toBe(2);
    const s = suggest(
      [hlMatch(h(1), h(2), days[0]!), hlMatch(h(3), h(1), days[1]!)],
      [ourFixture(t(1), t(2), days[0]!), ourFixture(t(3), t(1), days[1]!)],
    );
    expect(rowFor(s, h(1))).toMatchObject({
      teamId: t(1).teamId,
      votes: 2,
      conflicts: 0,
      strength: 'strong',
    });
    expect(rowFor(s, h(2))).toMatchObject({ votes: 1, strength: 'weak', note: 'one match only' });
    expect(s.rows[0]?.strength).toBe('strong');
  });

  it('is weak when the votes disagree, however many agree', () => {
    const s = suggest(
      [hlMatch(h(1), h(2), days[0]!), hlMatch(h(1), h(3), days[1]!), hlMatch(h(1), h(4), days[2]!)],
      [
        ourFixture(t(1), t(2), days[0]!),
        ourFixture(t(1), t(3), days[1]!),
        ourFixture(t(9), t(4), days[2]!),
      ],
    );
    expect(rowFor(s, h(1))).toMatchObject({
      teamId: t(1).teamId,
      votes: 2,
      conflicts: 1,
      strength: 'weak',
      note: 'votes disagree',
    });
  });

  it('is weak for two Highlightly teams that point at the same club of ours', () => {
    const s = suggest(
      [
        hlMatch(h(1), h(2), days[0]!),
        hlMatch(h(1), h(3), days[1]!),
        hlMatch(h(7), h(4), days[2]!),
        hlMatch(h(7), h(5), '2026-10-09T19:00:00.000Z'),
      ],
      [
        ourFixture(t(1), t(2), days[0]!),
        ourFixture(t(1), t(3), days[1]!),
        ourFixture(t(1), t(4), days[2]!),
        ourFixture(t(1), t(5), '2026-10-09T19:00:00.000Z'),
      ],
    );
    for (const side of [h(1), h(7)]) {
      expect(rowFor(s, side)).toMatchObject({ teamId: t(1).teamId, votes: 2, strength: 'weak' });
      expect(rowFor(s, side)?.note).toContain('same club');
    }
  });

  it('skips a Highlightly team already mapped, and counts it', () => {
    const s = suggest(
      [hlMatch(h(1), h(2), days[0]!), hlMatch(h(1), h(3), days[1]!)],
      [ourFixture(t(1), t(2), days[0]!), ourFixture(t(1), t(3), days[1]!)],
      [[h(1).externalId, t(1).teamId]],
    );
    expect(rowFor(s, h(1))).toBeUndefined();
    expect(s.stats.alreadyMapped).toBe(1);
    expect(rowFor(s, h(2))?.teamId).toBe(t(2).teamId);
  });

  it('refuses a pair whose club of ours is already mapped to another Highlightly id', () => {
    // Our 2 is mapped to Highlightly 9099, which this run never saw: the
    // kick-offs still point Highlightly 9002 at it, and that is refused.
    const s = suggestPairs({
      matches: [hlMatch(h(1), h(2), days[0]!), hlMatch(h(3), h(2), days[1]!)],
      fixtures: [ourFixture(t(1), t(2), days[0]!), ourFixture(t(3), t(2), days[1]!)],
      mappedHl: new Map([['9099', t(2).teamId]]),
      ourMapped: new Map([[t(2).teamId, '9099']]),
    });
    expect(rowFor(s, h(2))).toMatchObject({ votes: 2, strength: 'refused' });
    expect(rowFor(s, h(2))?.note).toContain('9099');
    expect(s.rows.at(-1)?.strength).toBe('refused');
  });

  it('never lets the names decide: a strong pair may look nothing alike', () => {
    const s = suggest(
      [
        hlMatch(h(1, 'Internazionale'), h(2), days[0]!),
        hlMatch(h(3), h(1, 'Internazionale'), days[1]!),
      ],
      [
        ourFixture({ ...t(1), name: 'Inter' }, t(2), days[0]!),
        ourFixture(t(3), { ...t(1), name: 'Inter' }, days[1]!),
      ],
    );
    const row = rowFor(s, h(1));
    expect(row?.strength).toBe('strong');
    expect(row?.similarity).toBeLessThan(0.7);
    expect(formatTable(s.rows)).toContain('Internazionale');
  });
});

describe('names, shown and never keyed on', () => {
  it('drops accents, case, punctuation and FC/CF', () => {
    expect(normaliseName('Atlético de Madrid')).toBe('atletico de madrid');
    expect(normaliseName('Arsenal FC')).toBe('arsenal');
    expect(normaliseName('Valencia C.F.')).toBe('valencia');
    expect(nameSimilarity('FC Barcelona', 'Barcelona')).toBe(1);
    expect(nameSimilarity('Bayern München', 'Bayern Munich')).toBeGreaterThan(0.7);
    expect(nameSimilarity('Arsenal', 'Chelsea')).toBeLessThan(0.3);
    expect(nameSimilarity('FC', 'Arsenal')).toBe(0);
  });
});

describe('what is asked', () => {
  const seasons = [
    { label: '2025/26', startDate: '2025-08-01', endDate: '2026-06-30', isCurrent: false },
    { label: '2026/27', startDate: '2026-08-01', endDate: '2027-06-30', isCurrent: true },
  ];

  it('asks each league one request a day, by our season of that day', () => {
    expect(dayRange('2026-10-08', 2, 1)).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
    expect(seasonForDay(seasons, '2026-06-30')?.label).toBe('2025/26');
    expect(seasonForDay(seasons, '2026-07-15')?.label).toBe('2026/27'); // the gap: the current one
    expect(seasonForDay([], '2026-07-15')).toBeNull();
    const plan = planRequests(
      [{ competitionId: COMP, competitionName: 'L', externalId: '33973' }],
      new Map([[COMP, seasons]]),
      dayRange('2026-06-30', 0, 2),
    );
    expect(plan.requests).toBe(3);
    expect(plan.calls.map((c) => [c.seasonLabel, c.from, c.to])).toEqual([
      ['2025/26', '2026-06-30', '2026-06-30'],
      ['2026/27', '2026-07-01', '2026-07-02'],
    ]);
  });

  it('stops at a refused quota and keeps what came back', async () => {
    const asked: string[] = [];
    const adapter = {
      listFixtures: (q: Record<string, string>) => {
        asked.push(q.competitionExternalId!);
        if (q.competitionExternalId === '2') {
          return Promise.resolve({
            ok: false,
            error: { kind: 'quota', message: '429' },
            requests: 1,
          });
        }
        return Promise.resolve({
          ok: true,
          requests: 1,
          fetchedAt: '',
          data: [{ kickoffAt: '2026-10-04T14:00:00Z', home: h(1), away: h(2) }],
        });
      },
    };
    const call = (id: string) => ({
      competitionId: COMP,
      competitionName: id,
      competitionExternalId: id,
      seasonLabel: '2026/27',
      from: '2026-10-04',
      to: '2026-10-04',
      days: 1,
    });
    const out = await collectMatches(adapter, [call('1'), call('2'), call('3')]);
    expect(asked).toEqual(['1', '2']);
    expect(out).toMatchObject({ stopped: true, requests: 2 });
    expect(out.matches).toEqual([
      { competitionId: COMP, kickoffAt: '2026-10-04T14:00:00Z', home: h(1), away: h(2) },
    ]);
  });
});

describe('the command line', () => {
  it('suggests by default and writes only with --apply strong and --by', () => {
    expect(parseArgs([])).toMatchObject({
      command: 'suggest',
      daysBack: 7,
      daysAhead: 7,
      maxRequests: 500,
    });
    expect(parseArgs(['--apply', 'strong', '--by', 'a@b.c'])).toMatchObject({ command: 'apply' });
    expect(parseArgs(['--apply', 'weak', '--by', 'a@b.c']).error).toContain('only "strong"');
    expect(parseArgs(['--apply', 'strong']).error).toContain('--by is required');
    expect(parseArgs(['--by', 'a@b.c']).error).toContain('without it nothing is written');
    expect(parseArgs(['--from', 'x.json']).error).toContain('without it nothing is written');
    expect(parseArgs(['--days-back', '15']).error).toContain('0 to 14');
    expect(parseArgs(['--competition', 'Premier League']).error).toContain('never a name');
    expect(parseArgs(['--max-requests', '0']).error).toContain('positive');
  });

  it('exits with a clear message and asks nothing without HIGHLIGHTLY_KEY', async () => {
    const run = promisify(execFile);
    const script = join(__dirname, '..', 'scripts', 'highlightly-pairs.mjs');
    const result = await run(process.execPath, [script], {
      env: {
        ...process.env,
        HIGHLIGHTLY_KEY: '',
        DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
      },
    }).then(
      () => ({ code: 0, stderr: '' }),
      (error: { code: number; stderr: string }) => error,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('HIGHLIGHTLY_KEY is not set');
  });
});

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'writing the strong pairs (real schema)',
  () => {
    let pool: pg.Pool;
    const admin = randomUUID();
    const email = `t1370-${admin}@example.test`;
    const teams = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    // Numeric, as the provider's are, and far from any real id.
    const base = 930_000_000 + Math.floor(Math.random() * 60_000_000);
    const hl = [0, 1, 2, 3, 4].map((i) => String(base + i));
    const row = (i: number, teamId: string, strength: Row['strength'] = 'strong'): Row => ({
      highlightlyId: hl[i]!,
      highlightlyName: `T-1370 their ${i}`,
      teamId,
      teamName: `T-1370 ours`,
      votes: 3,
      conflicts: 0,
      similarity: 0.5,
      strength,
      note: null,
      fixtures: [],
    });

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      const country = await pool.query<{ id: string }>(`SELECT id FROM country LIMIT 1`);
      await pool.query(
        `INSERT INTO user_account
         (id, username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, status)
       VALUES ($1, $2, 'T-1370 admin', $3, $4, 'en', 'UTC', now(), 'active')`,
        [admin, `t1370_${admin.slice(0, 8)}`, email, country.rows[0]?.id],
      );
      for (const [i, id] of teams.entries()) {
        await pool.query(
          `INSERT INTO team (id, name, kind, gender) VALUES ($1, $2, 'club', 'men')`,
          [id, `T-1370 ours ${i}`],
        );
      }
      for (const externalId of hl) {
        await pool.query(
          `INSERT INTO unresolved_entity (provider, entity_type, external_id, payload)
           VALUES ('highlightly', 'team', $1, '{"name":"T-1370"}')`,
          [externalId],
        );
      }
      // hl[2] is already mapped to teams[2]; teams[3] is mapped to another id (hl[4]).
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('highlightly', 'team', $1, $2), ('highlightly', 'team', $3, $4)`,
        [hl[2], teams[2], hl[4], teams[3]],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      const client = await pool.connect();
      try {
        // The audit log refuses a delete by trigger; a test's own rows go with
        // the triggers off, as `apps/api/src/testing/cleanup.ts` does it.
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [admin]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM user_account WHERE id = $1`, [admin]);
      await pool.query(
        `DELETE FROM provider_mapping
          WHERE provider = 'highlightly' AND entity_type = 'team' AND external_id = ANY($1)`,
        [hl],
      );
      await pool.query(
        `DELETE FROM unresolved_entity
          WHERE provider = 'highlightly' AND entity_type = 'team' AND external_id = ANY($1)`,
        [hl],
      );
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
      await pool.end();
    });

    it('writes the strong pairs as catalog --map does, and refuses the rest', async () => {
      const client = await pool.connect();
      let outcome: Outcome;
      try {
        outcome = await applyStrong(
          client,
          [
            row(0, teams[0]!), // written
            row(1, teams[1]!, 'weak'), // never written
            row(2, teams[2]!), // already in place
            row(2, teams[1]!), // hl[2] mapped elsewhere: never overwritten
            row(3, teams[3]!), // teams[3] already has another Highlightly id
            row(3, randomUUID()), // no such team
          ],
          email,
        );
      } finally {
        client.release();
      }
      expect(outcome.written.map((r) => r.highlightlyId)).toEqual([hl[0]]);
      expect(outcome.skipped.map((s) => s.row.highlightlyId)).toEqual([hl[2]]);
      expect(outcome.refused.map((s) => s.reason)).toEqual([
        expect.stringContaining('already mapped to'),
        expect.stringContaining(`highlightly ${hl[4]}`),
        expect.stringContaining('no team'),
      ]);
      expect(outcome.audited).toBe(true);

      const mapped = await pool.query<{ external_id: string; internal_id: string }>(
        `SELECT external_id, internal_id FROM provider_mapping
          WHERE provider = 'highlightly' AND entity_type = 'team' AND external_id = ANY($1)
          ORDER BY external_id`,
        [hl],
      );
      expect(mapped.rows).toEqual([
        { external_id: hl[0], internal_id: teams[0] },
        { external_id: hl[2], internal_id: teams[2] },
        { external_id: hl[4], internal_id: teams[3] },
      ]);
      const queue = await pool.query<{
        external_id: string;
        status: string;
        resolved_by: string;
        resolution_note: string;
      }>(
        `SELECT external_id, status, resolved_by, resolution_note FROM unresolved_entity
          WHERE provider = 'highlightly' AND entity_type = 'team' AND external_id = ANY($1)
          ORDER BY external_id`,
        [hl],
      );
      expect(queue.rows[0]).toMatchObject({ status: 'resolved', resolved_by: email });
      expect(queue.rows[0]?.resolution_note).toContain('matching kick-offs');
      expect(queue.rows.slice(1).every((r) => r.status === 'pending')).toBe(true);

      const audit = await pool.query<{
        action: string;
        target_id: string;
        reason: string;
        next: Record<string, unknown>;
      }>(`SELECT action, target_id, reason, next FROM audit_log WHERE actor_id = $1`, [admin]);
      expect(audit.rows).toEqual([
        {
          action: 'catalog.mapped',
          target_id: teams[0],
          reason: expect.stringContaining('T-1370'),
          next: {
            provider: 'highlightly',
            external_id: hl[0],
            votes: 3,
            conflicts: 0,
            name_similarity: 0.5,
          },
        },
      ]);
    });

    it('applies a reviewed file from the command line, signed by --by', async () => {
      const dir = mkdtempSync(join(tmpdir(), 't1370-'));
      const file = join(dir, 'pairs.json');
      writeFileSync(file, JSON.stringify({ rows: [row(1, teams[1]!)] }));
      const run = promisify(execFile);
      const script = join(__dirname, '..', 'scripts', 'highlightly-pairs.mjs');
      const { stdout } = await run(
        process.execPath,
        [script, '--apply', 'strong', '--from', file, '--by', email],
        { env: { ...process.env, DATABASE_URL, HIGHLIGHTLY_KEY: '' } },
      );
      expect(stdout).toContain(`highlightly team ${hl[1]} -> ${teams[1]}`);
      expect(stdout).toContain('1 written, 0 already in place, 0 refused');
      const mapped = await pool.query(
        `SELECT internal_id FROM provider_mapping
          WHERE provider = 'highlightly' AND entity_type = 'team' AND external_id = $1`,
        [hl[1]],
      );
      expect(mapped.rows).toEqual([{ internal_id: teams[1] }]);
    });

    it('writes nothing at all when --by names nobody', async () => {
      const client = await pool.connect();
      try {
        await expect(
          applyStrong(client, [row(3, teams[4]!)], 'nobody-t1370@example.test'),
        ).rejects.toThrow('No account');
      } finally {
        client.release();
      }
      const mapped = await pool.query(
        `SELECT 1 FROM provider_mapping
          WHERE provider = 'highlightly' AND entity_type = 'team' AND external_id = $1`,
        [hl[3]],
      );
      expect(mapped.rows).toEqual([]);
    });
  },
);
