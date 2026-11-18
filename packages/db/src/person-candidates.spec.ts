import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain script, deliberately not part of the TypeScript build.
import * as catalog from '../scripts/catalog.mjs';
// @ts-expect-error -- a plain script, deliberately not part of the TypeScript build.
import * as people from '../scripts/person-merge.mjs';

/**
 * T-1864 (D-446 points 2 and 4): `person_duplicate_candidates()`, the
 * function the data-quality check and `catalog.mjs --person-candidates` both
 * read, and the operator's commands `--merge-people` (one pair, a batch
 * file, a dry run), `--unmerge` and `--not-duplicate`, run as the operator
 * runs them, against the real schema. The pure parts first, without a
 * database. Every write is committed (the command commits), so the rows this
 * file makes are named by a tag and removed at the end, the immutable ones
 * with the triggers off, as `apps/api/src/testing/cleanup.ts` does it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SCRIPT = join(__dirname, '..', 'scripts', 'catalog.mjs');
const run = promisify(execFile);

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

describe('the person commands, parsed', () => {
  const write = ['--reason', 'one man, two ids', '--by', 'admin@example.test'];

  it('refuses every write without --by or a reason, a dry run too', () => {
    for (const args of [
      ['--merge-people', '--from', A, '--into', B, '--reason', 'r'],
      ['--merge-people', '--file', 'pairs.csv', '--reason', 'r'],
      ['--unmerge', '--merge', A, '--reason', 'r'],
      ['--not-duplicate', '--a', A, '--b', B, '--reason', 'r'],
      ['--merge-people', '--from', A, '--into', B, '--reason', 'r', '--dry-run'],
    ]) {
      expect(catalog.parseArgs(args).error).toMatch(/--by is required/);
    }
    expect(
      catalog.parseArgs(['--merge-people', '--from', A, '--into', B, '--by', 'x@y.z']).error,
    ).toMatch(/--reason is required/);
  });

  it('takes one pair or a batch file, never both, and two different persons', () => {
    expect(catalog.parseArgs(['--merge-people', '--from', A, '--into', B, ...write])).toEqual({
      command: 'merge-people',
      by: 'admin@example.test',
      reason: 'one man, two ids',
      dryRun: false,
      file: null,
      pairs: [{ from: A, into: B }],
    });
    expect(
      catalog.parseArgs(['--merge-people', '--file', '-', '--dry-run', ...write]),
    ).toMatchObject({ command: 'merge-people', file: '-', pairs: null, dryRun: true });
    expect(
      catalog.parseArgs(['--merge-people', '--file', '-', '--from', A, ...write]).error,
    ).toMatch(/not both/);
    expect(catalog.parseArgs(['--merge-people', '--from', A, '--into', A, ...write]).error).toMatch(
      /same person/,
    );
    expect(
      catalog.parseArgs(['--merge-people', '--from', 'Ali', '--into', A, ...write]).error,
    ).toMatch(/not a uuid/);
    expect(catalog.parseArgs(['--merge-people', '--from', A, ...write]).error).toMatch(
      /--into is required/,
    );
  });

  it('parses --unmerge, --not-duplicate and the read-only --person-candidates', () => {
    expect(catalog.parseArgs(['--unmerge', '--merge', C, ...write])).toMatchObject({
      command: 'unmerge',
      merge: C,
    });
    expect(catalog.parseArgs(['--not-duplicate', '--a', B, '--b', A, ...write])).toMatchObject({
      command: 'not-duplicate',
      a: B,
      b: A,
    });
    expect(catalog.parseArgs(['--not-duplicate', '--a', A, '--b', A, ...write]).error).toMatch(
      /same person/,
    );
    expect(catalog.parseArgs(['--person-candidates'])).toEqual({
      command: 'person-candidates',
      limit: 200,
    });
    expect(catalog.parseArgs(['--person-candidates', '--limit', '0']).error).toMatch(/--limit/);
  });

  it('reads a batch file of loser,survivor pairs and refuses a malformed one', () => {
    expect(
      people.parsePairs(
        `loser,survivor,names\n# T-1867 batch 1\n${A},${B},Ali / Ali\n\n${C},${B}\n`,
      ),
    ).toEqual({
      pairs: [
        { from: A, into: B },
        { from: C, into: B },
      ],
    });
    expect(people.parsePairs(`from,into\n${A.toUpperCase()},${B}`)).toEqual({
      pairs: [{ from: A, into: B }],
    });
    expect(people.parsePairs(`${A},Ali Karimi`).error).toMatch(/line 1: the survivor/);
    expect(people.parsePairs(`${A},${A}`).error).toMatch(/into itself/);
    expect(people.parsePairs(`${A},${B}\n${A},${C}`).error).toMatch(/line 2: .* a loser twice/);
    // The file's own line numbers, past the header, a comment and a blank line.
    expect(people.parsePairs(`loser,survivor\n# batch 1\n\n${A},${B}\n${C},Ali`).error).toMatch(
      /^line 5: the survivor/,
    );
    expect(people.parsePairs('# nothing\n').error).toMatch(/no loser,survivor pair/);
  });

  it('stops a batch at a failure that is not a refusal, still saying what was merged and checking it', async () => {
    // A stand-in connection: the first pair merges, the second meets a
    // deadlock (an ingestion transaction on the same line-up), the third is
    // never tried. Review m2.
    const sql: string[] = [];
    let merges = 0;
    const client = {
      query: async (text: string) => {
        sql.push(text);
        if (text.includes('FROM user_account')) return { rows: [{ id: A, admin: true }] };
        if (text.startsWith('SELECT merge_person(')) {
          merges += 1;
          if (merges === 2) {
            throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
          }
          return { rows: [{ id: C }] };
        }
        if (text.includes('FROM pg_constraint')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      },
    };
    const out: string[] = [];
    const err: string[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (...args: unknown[]) => void out.push(args.join(' '));
    console.error = (...args: unknown[]) => void err.push(args.join(' '));
    let code: number;
    try {
      code = await people.mergePeople(
        client,
        { by: 'admin@example.test', reason: 'r', dryRun: false, file: 'pairs.csv', pairs: null },
        () => [`${A},${B}`, `${C},${B}`, `00000000-0000-4000-8000-00000000000d,${B}`].join('\n'),
      );
    } finally {
      console.log = log;
      console.error = error;
    }
    expect(code).toBe(1);
    const said = out.join('\n');
    const warned = err.join('\n');
    expect(said).toMatch(/1\/3 merged/);
    expect(said).toMatch(/Nothing references the 1 loser/);
    expect(warned).toMatch(/2\/3 failed: /);
    expect(warned).toMatch(/nothing of this pair was written/);
    expect(warned).toMatch(/deadlock detected/);
    expect(warned).toMatch(/1 pair\(s\) merged before it, 1 not tried/);
    // The failed pair's transaction was rolled back; the first was committed.
    expect(sql.filter((t) => t === 'COMMIT')).toHaveLength(1);
    expect(sql.filter((t) => t === 'ROLLBACK')).toHaveLength(1);
  });

  it('says each PL024 refusal in the operator’s words', () => {
    expect(people.refusal('shared_lineup', { fixture: C })).toMatch(
      /line-up of one match \(fixture .*\).*never merged.*--not-duplicate/,
    );
    expect(people.refusal('shared_incident', {})).toMatch(/One incident names both/);
    expect(people.refusal('judged_different', { decided: 'by x on 2026-11-18: twins' })).toMatch(
      /two people \(by x on 2026-11-18: twins\)/,
    );
    expect(people.refusal('already_merged', { from: A, into: B, merge: C })).toMatch(
      new RegExp(`--unmerge --merge ${C} first`),
    );
    expect(people.refusal('into_merged', { into: B, target: C })).toMatch(
      new RegExp(`merge into ${C} instead`),
    );
    expect(people.refusal('survivor_merged')).toMatch(/undo the later merge first/);
    expect(people.refusal('already_undone')).toMatch(/already undone/);
    expect(people.refusal('something new')).toBeNull();
  });
});

async function cli(
  args: string[],
  input?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = run(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, DATABASE_URL },
  });
  child.child.stdin?.end(input ?? '');
  try {
    const { stdout, stderr } = await child;
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

interface Candidate {
  low_person_id: string;
  high_person_id: string;
  matched_on: string;
  same_nationality: boolean | null;
  common_teams: string[];
  low_lineups: number;
  high_lineups: number;
  appearances_disjoint: boolean | null;
  low_coach_only: boolean;
  high_coach_only: boolean;
  proposed_into: string;
  proposed_because: string;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'duplicate-person candidates and the operator’s commands',
  // Each command is a node process, as the operator runs it: seconds on a slow host.
  { timeout: 60_000 },
  () => {
    let pool: pg.Pool;
    const tag = randomUUID().slice(0, 8);
    const admin = randomUUID();
    const member = randomUUID();
    const adminEmail = `t1864-admin-${tag}@example.test`;
    const memberEmail = `t1864-member-${tag}@example.test`;
    const write = ['--reason', 'T-1864 spec', '--by', adminEmail];
    const ids: Record<string, string> = {};
    const teams: string[] = [];
    let competition = '';

    const q = async (sql: string, values: unknown[] = []) => (await pool.query(sql, values)).rows;
    const pair = (x: string, y: string) => [x, y].sort() as [string, string];
    async function candidates(): Promise<Candidate[]> {
      const mine = new Set(Object.values(ids));
      return (await q(`SELECT * FROM person_duplicate_candidates()`)).filter(
        (row: Candidate) => mine.has(row.low_person_id) || mine.has(row.high_person_id),
      ) as Candidate[];
    }
    async function candidate(x: string, y: string): Promise<Candidate | undefined> {
      const [low, high] = pair(x, y);
      return (await candidates()).find((c) => c.low_person_id === low && c.high_person_id === high);
    }
    const mergedInto = async (id: string) =>
      (await q(`SELECT person_merged_into($1) AS id`, [id]))[0]?.id as string | null;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      const [c1, c2] = (await q(`SELECT id FROM country ORDER BY code LIMIT 2`)).map(
        (r: { id: string }) => r.id,
      );
      for (const [id, email] of [
        [admin, adminEmail],
        [member, memberEmail],
      ] as const) {
        await q(
          `INSERT INTO user_account
             (id, username, display_name, email, country_id, preferred_language, timezone,
              accepted_rules_at, status)
           VALUES ($1, $2, 'T-1864', $3, $4, 'en', 'UTC', now(), 'active')`,
          [id, `t1864_${id.slice(0, 8)}`, email, c1],
        );
      }
      await q(`INSERT INTO user_role (user_id, role, reason) VALUES ($1, 'admin', 'T-1864 spec')`, [
        admin,
      ]);
      competition = (
        await q(
          `INSERT INTO competition (name, kind, scope, gender)
           VALUES ($1, 'league', 'international', 'men') RETURNING id`,
          [`T-1864 ${tag}`],
        )
      )[0].id;
      const season = (
        await q(
          `INSERT INTO season (competition_id, label, start_date, end_date)
           VALUES ($1, '2026/27', '2026-08-01', '2027-05-31') RETURNING id`,
          [competition],
        )
      )[0].id;
      for (const name of ['Alpha', 'Beta']) {
        teams.push(
          (
            await q(
              `INSERT INTO team (name, kind, gender) VALUES ($1, 'club', 'men') RETURNING id`,
              [`T-1864 ${tag} ${name}`],
            )
          )[0].id,
        );
      }
      const [alpha, beta] = teams as [string, string];
      const fixture = async (kickoff: string) => {
        const id = (
          await q(`INSERT INTO fixture (season_id, kickoff_at) VALUES ($1, $2) RETURNING id`, [
            season,
            kickoff,
          ])
        )[0].id as string;
        const home = (
          await q(
            `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home') RETURNING id`,
            [id, alpha],
          )
        )[0].id as string;
        await q(
          `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'away')`,
          [id, beta],
        );
        return { id, home };
      };
      const [early, late1, late2] = [
        await fixture('2025-09-01T18:00Z'),
        await fixture('2026-09-01T18:00Z'),
        await fixture('2026-09-08T18:00Z'),
      ];

      const person = async (
        key: string,
        fullName: string,
        fields: { knownAs?: string; born?: string; nationality?: string; createdAt?: string } = {},
      ) => {
        ids[key] = (
          await q(
            `INSERT INTO person (full_name, known_as, date_of_birth, nationality_id, created_at)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [
              fullName,
              fields.knownAs ?? null,
              fields.born ?? '1996-03-04',
              fields.nationality ?? c1,
              fields.createdAt ?? '2026-01-01T00:00Z',
            ],
          )
        )[0].id;
      };
      // One man under two ids: the same name but for an accent, the same
      // birth date and country, a club in common, and appearances that
      // follow each other (one id stops, the other starts).
      await person('loser', `T1864 ${tag} Mehdi Taremi`, { createdAt: '2025-01-01T00:00Z' });
      await person('survivor', `t1864 ${tag} Mehdí Táremi`);
      // Two men on one team sheet: never a candidate, a merge refused.
      await person('teammateA', `T1864 ${tag} Twin`);
      await person('teammateB', `T1864 ${tag} Twin`);
      // Two the operator will judge different.
      await person('judgedA', `T1864 ${tag} Judged`, { nationality: c2 });
      await person('judgedB', `T1864 ${tag} Judged`);
      // A pair the batch merges first, so it is a tombstone after.
      await person('tombstone', `T1864 ${tag} Stone`);
      await person('keeper', `T1864 ${tag} Stone`);
      // A player and a coach id of one man: the coach row is older and has
      // the same line-ups (none), and the player row is still proposed.
      await person('player', `T1864 ${tag} Javad Nekounam`, { knownAs: `T1864 ${tag} Neku` });
      await person('coach', `T1864 ${tag} Neku`, { createdAt: '2024-01-01T00:00Z' });
      // The same name on another day: two men.
      await person('otherDay', `T1864 ${tag} Twin`, { born: '1997-03-04' });
      // No birth date: never compared.
      await person('unborn', `T1864 ${tag} Stone`, { born: undefined });
      await q(`UPDATE person SET date_of_birth = NULL WHERE id = $1`, [ids.unborn]);

      const lineup = (participant: string, person: string) =>
        q(`INSERT INTO lineup (participant_id, person_id, role) VALUES ($1, $2, 'starter')`, [
          participant,
          person,
        ]);
      await lineup(early.home, ids.loser!);
      await lineup(late1.home, ids.survivor!);
      await lineup(late2.home, ids.survivor!);
      await lineup(late1.home, ids.teammateA!);
      await lineup(late1.home, ids.teammateB!);
      await q(
        `INSERT INTO player_spell (person_id, team_id, start_date, end_date)
         VALUES ($1, $2, '2024-07-01', '2025-06-30')`,
        [ids.loser, alpha],
      );
      await q(
        `INSERT INTO team_squad_member (team_id, person_id, provider) VALUES ($1, $2, 'api_football')`,
        [alpha, ids.survivor],
      );
      const base = 930_000_000 + Math.floor(Math.random() * 60_000_000);
      await q(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', 'person', $1, $3), ('api_football', 'person', $2, $4)`,
        [String(base), `coach:${base + 1}`, ids.player, ids.coach],
      );
      // The survivor's answers under its own id: "another name" for the
      // profile, the name kept for the names job. The merge settles both, so
      // they are asked again by every id (rev-2026-11-17-11, review m1); a
      // written answer stays, and an ask still waiting is left to its job.
      await q(
        `INSERT INTO person_bio_fetch (person_id, provider, answered_at, outcome, detail, written)
         VALUES ($1, 'api_football', now(), 'name_differs', 'the profile names someone else', NULL),
                ($1, 'highlightly', now(), 'written', 'the profile gives height_cm', '{"height_cm": 180}')`,
        [ids.survivor],
      );
      await q(
        `INSERT INTO person_name_fetch (person_id, provider, answered_at, outcome, detail)
         VALUES ($1, 'api_football', now(), 'name_kept', 'the ids'' profiles give different full names'),
                ($1, 'highlightly', NULL, NULL, NULL)`,
        [ids.survivor],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      const persons = Object.values(ids);
      const client = await pool.connect();
      try {
        // The merge tables and the audit log refuse a delete by trigger.
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(
          `DELETE FROM person_merge_moved WHERE merge_id IN
             (SELECT id FROM person_merge WHERE from_person_id = ANY($1::uuid[]))`,
          [persons],
        );
        await client.query(`DELETE FROM person_merge WHERE from_person_id = ANY($1::uuid[])`, [
          persons,
        ]);
        await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [
          [admin, member],
        ]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await q(
        `DELETE FROM lineup WHERE participant_id IN (SELECT fp.id FROM fixture_participant fp
           JOIN fixture f ON f.id = fp.fixture_id JOIN season s ON s.id = f.season_id
          WHERE s.competition_id = $1)`,
        [competition],
      );
      await q(
        `DELETE FROM fixture_participant WHERE fixture_id IN (SELECT f.id FROM fixture f
           JOIN season s ON s.id = f.season_id WHERE s.competition_id = $1)`,
        [competition],
      );
      await q(
        `DELETE FROM fixture WHERE season_id IN (SELECT id FROM season WHERE competition_id = $1)`,
        [competition],
      );
      await q(`DELETE FROM season WHERE competition_id = $1`, [competition]);
      await q(`DELETE FROM competition WHERE id = $1`, [competition]);
      for (const table of [
        'player_spell',
        'team_squad_member',
        'person_bio_fetch',
        'person_name_fetch',
      ]) {
        await q(`DELETE FROM ${table} WHERE person_id = ANY($1::uuid[])`, [persons]);
      }
      await q(
        `DELETE FROM provider_mapping WHERE entity_type = 'person' AND internal_id = ANY($1::uuid[])`,
        [persons],
      );
      await q(
        `DELETE FROM person_not_duplicate WHERE low_person_id = ANY($1::uuid[]) OR high_person_id = ANY($1::uuid[])`,
        [persons],
      );
      await q(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [persons]);
      await q(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
      await q(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [[admin, member]]);
      await pool.end();
    });

    it('lists a same-name, same-birth-date pair with its signals and the proposed survivor', async () => {
      const found = await candidate(ids.loser!, ids.survivor!);
      expect(found).toMatchObject({
        matched_on: 'full_name',
        same_nationality: true,
        common_teams: [`T-1864 ${tag} Alpha`],
        appearances_disjoint: true,
        low_coach_only: false,
        high_coach_only: false,
        // More line-ups wins over the older row.
        proposed_into: ids.survivor,
        proposed_because: 'more_lineups',
      });
      const lineups = [found!.low_lineups, found!.high_lineups];
      expect(found!.low_person_id === ids.loser ? lineups : lineups.reverse()).toEqual([1, 2]);
    });

    it('proposes the player row of a player and coach pair, matched by known-as', async () => {
      expect(await candidate(ids.player!, ids.coach!)).toMatchObject({
        matched_on: 'known_as',
        proposed_into: ids.player,
        proposed_because: 'player_row',
      });
    });

    it('leaves out a pair on one line-up, another birth date and no birth date', async () => {
      expect(await candidate(ids.teammateA!, ids.teammateB!)).toBeUndefined();
      expect(await candidate(ids.teammateA!, ids.otherDay!)).toBeUndefined();
      expect(await candidate(ids.tombstone!, ids.unborn!)).toBeUndefined();
      expect(await candidate(ids.judgedA!, ids.judgedB!)).toMatchObject({
        same_nationality: false,
      });
    });

    it('--person-candidates prints the pair, its signals and the command it proposes', async () => {
      const out = await cli(['--person-candidates', '--limit', '1000']);
      expect(out.code).toBe(0);
      expect(out.stdout).toContain(`--merge-people --from ${ids.loser} --into ${ids.survivor}`);
      expect(out.stdout).toContain(`clubs in common: T-1864 ${tag} Alpha`);
      expect(out.stdout).toContain(`--merge-people --from ${ids.coach} --into ${ids.player}`);
      expect(out.stdout).not.toContain(ids.teammateA);
    });

    it('refuses a write by an account that is not an administrator, writing nothing', async () => {
      for (const args of [
        ['--merge-people', '--from', ids.loser!, '--into', ids.survivor!],
        ['--not-duplicate', '--a', ids.judgedA!, '--b', ids.judgedB!],
        ['--unmerge', '--merge', randomUUID()],
      ]) {
        const out = await cli([...args, '--reason', 'r', '--by', memberEmail]);
        expect(out.code).toBe(1);
        expect(out.stderr).toMatch(/not an active administrator/);
      }
      expect(await mergedInto(ids.loser!)).toBeNull();
    });

    it('a dry run prints what would move and writes nothing', async () => {
      const out = await cli([
        '--merge-people',
        '--from',
        ids.loser!,
        '--into',
        ids.survivor!,
        '--dry-run',
        ...write,
      ]);
      expect(out.stderr).toBe('');
      expect(out.code).toBe(0);
      expect(out.stdout).toMatch(/1\/1 would merge/);
      expect(out.stdout).toMatch(/re-pointed: .*lineup\.person_id 1/);
      expect(out.stdout).toMatch(/Nothing references the 1 loser/);
      expect(out.stdout).toMatch(/nothing was written/);
      expect(await mergedInto(ids.loser!)).toBeNull();
      expect(
        await q(`SELECT 1 FROM person_bio_fetch WHERE person_id = $1`, [ids.survivor]),
      ).toHaveLength(2);
      expect(
        await q(`SELECT 1 FROM person_name_fetch WHERE person_id = $1`, [ids.survivor]),
      ).toHaveLength(2);
    });

    it('refuses two persons on one line-up with the PL024 hint in plain words', async () => {
      const out = await cli([
        '--merge-people',
        '--from',
        ids.teammateA!,
        '--into',
        ids.teammateB!,
        ...write,
      ]);
      expect(out.code).toBe(1);
      expect(out.stderr).toMatch(/line-up of one match \(fixture [0-9a-f-]{36}\)/);
      expect(out.stderr).toMatch(/--not-duplicate/);
      expect(await mergedInto(ids.teammateA!)).toBeNull();
    });

    it('--not-duplicate records the judgement, audited; the pair leaves the list and a merge is refused', async () => {
      const out = await cli([
        '--not-duplicate',
        '--a',
        ids.judgedB!,
        '--b',
        ids.judgedA!,
        ...write,
      ]);
      expect(out.stderr).toBe('');
      expect(out.code).toBe(0);
      const [low, high] = pair(ids.judgedA!, ids.judgedB!);
      expect(
        await q(
          `SELECT reason FROM person_not_duplicate WHERE low_person_id = $1 AND high_person_id = $2 AND decided_by = $3`,
          [low, high, admin],
        ),
      ).toEqual([{ reason: 'T-1864 spec' }]);
      expect(
        await q(
          `SELECT target_id, reason, next FROM audit_log WHERE action = 'person.not_duplicate' AND actor_id = $1`,
          [admin],
        ),
      ).toEqual([{ target_id: low, reason: 'T-1864 spec', next: { not_duplicate_of: high } }]);
      expect(await candidate(ids.judgedA!, ids.judgedB!)).toBeUndefined();

      const merge = await cli([
        '--merge-people',
        '--from',
        ids.judgedA!,
        '--into',
        ids.judgedB!,
        ...write,
      ]);
      expect(merge.code).toBe(1);
      expect(merge.stderr).toMatch(
        new RegExp(`two people \\(by ${adminEmail} on .*: T-1864 spec\\)`),
      );

      const again = await cli([
        '--not-duplicate',
        '--a',
        ids.judgedA!,
        '--b',
        ids.judgedB!,
        ...write,
      ]);
      expect(again.code).toBe(1);
      expect(again.stderr).toMatch(/already recorded as two people/);
    });

    it('a batch merges in order, stops at the first refusal, and checks nothing names a loser', async () => {
      const file = [
        'loser,survivor,names',
        `${ids.tombstone},${ids.keeper},Stone`,
        `${ids.loser},${ids.survivor},Taremi`,
        `${ids.teammateA},${ids.teammateB},Twin -- one line-up, refused`,
        `${ids.coach},${ids.player},never tried`,
      ].join('\n');
      const out = await cli(['--merge-people', '--file', '-', ...write], file);
      expect(out.code).toBe(1);
      expect(out.stdout).toMatch(/1\/4 merged .*Stone/);
      expect(out.stdout).toMatch(/2\/4 merged .*Taremi/);
      expect(out.stdout).toMatch(/merge id [0-9a-f-]{36} \(for --unmerge --merge/);
      expect(out.stdout).toMatch(/profile answers asked again: 2/);
      expect(out.stdout).toMatch(/Nothing references the 2 loser\(s\) any more/);
      expect(out.stderr).toMatch(/3\/4 refused/);
      expect(out.stderr).toMatch(/2 pair\(s\) merged before it, 1 not tried/);

      expect(await mergedInto(ids.tombstone!)).toBe(ids.keeper);
      expect(await mergedInto(ids.loser!)).toBe(ids.survivor);
      expect(await mergedInto(ids.teammateA!)).toBeNull();
      expect(await mergedInto(ids.coach!)).toBeNull();
      // The survivor's settled answers are gone, so it is asked again; the
      // written one and the ask still waiting stay.
      expect(
        await q(`SELECT provider, outcome FROM person_bio_fetch WHERE person_id = $1`, [
          ids.survivor,
        ]),
      ).toEqual([{ provider: 'highlightly', outcome: 'written' }]);
      expect(
        await q(`SELECT provider, outcome FROM person_name_fetch WHERE person_id = $1`, [
          ids.survivor,
        ]),
      ).toEqual([{ provider: 'highlightly', outcome: null }]);
      // Merged through the shared function: audited as it audits.
      expect(
        await q(
          `SELECT count(*)::int AS n FROM audit_log WHERE action = 'person.merge' AND actor_id = $1`,
          [admin],
        ),
      ).toEqual([{ n: 2 }]);
      // A tombstone is never a candidate.
      expect(await candidate(ids.tombstone!, ids.keeper!)).toBeUndefined();
      expect(await candidate(ids.loser!, ids.survivor!)).toBeUndefined();
      expect(await people.referencesTo(pool, [ids.loser!, ids.tombstone!])).toEqual([]);
    });

    it('refuses to judge a tombstone, or to merge one again, saying what to do', async () => {
      const judge = await cli([
        '--not-duplicate',
        '--a',
        ids.tombstone!,
        '--b',
        ids.otherDay!,
        ...write,
      ]);
      expect(judge.code).toBe(1);
      expect(judge.stderr).toMatch(
        new RegExp(`merged into ${ids.keeper}: judge ${ids.keeper} instead`),
      );
      const again = await cli([
        '--merge-people',
        '--from',
        ids.tombstone!,
        '--into',
        ids.otherDay!,
        ...write,
      ]);
      expect(again.code).toBe(1);
      expect(again.stderr).toMatch(/already merged into .*--unmerge --merge [0-9a-f-]{36} first/);
    });

    it('--unmerge restores the pair, which is a candidate again; a second undo is refused', async () => {
      const merge = (
        await q(`SELECT id FROM person_merge WHERE from_person_id = $1 AND undone_at IS NULL`, [
          ids.loser,
        ])
      )[0].id as string;
      const dry = await cli(['--unmerge', '--merge', merge, '--dry-run', ...write]);
      expect(dry.code).toBe(0);
      expect(dry.stdout).toMatch(/Would undo merge/);
      expect(dry.stdout).toMatch(/lineup \(repointed\): 1 row/);
      expect(await mergedInto(ids.loser!)).toBe(ids.survivor);

      const out = await cli(['--unmerge', '--merge', merge, ...write]);
      expect(out.stderr).toBe('');
      expect(out.code).toBe(0);
      expect(await mergedInto(ids.loser!)).toBeNull();
      expect(await candidate(ids.loser!, ids.survivor!)).toMatchObject({
        proposed_into: ids.survivor,
      });

      const again = await cli(['--unmerge', '--merge', merge, ...write]);
      expect(again.code).toBe(1);
      expect(again.stderr).toMatch(/already undone/);
      const none = await cli(['--unmerge', '--merge', randomUUID(), ...write]);
      expect(none.code).toBe(1);
      expect(none.stderr).toMatch(/No person merge/);
    });
  },
);
