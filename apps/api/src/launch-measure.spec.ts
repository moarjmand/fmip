import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The launch measure's queries (T-1966, T-1968, D-459 point 4) on hand-counted fixtures.
 * `.claude/skills/growth-funnel/launch-measure.sql` is the file `launch-measure.sh` sends to
 * production through `data-audit/run.sh`; here its two psql variables are replaced with
 * literals and it runs on the migrated schema, so a renamed column fails CI rather than the
 * Monday read.
 *
 * Each fixture is seeded and measured inside its own REPEATABLE READ transaction that is rolled
 * back: its rows never commit, and accounts other suites create meanwhile are outside the
 * snapshot. Every account the snapshot holds besides the fixture's goes into the internal list,
 * so the counts are the fixture's alone. The invitation date is 20 days before today (UTC), so
 * the run falls in week 3, the week still running (13 days for the two-week fixtures). The
 * session's own time zone is set far from UTC first: the file must pin UTC itself.
 *
 * Besides the exact lines, every output is checked for what a reader could work out: no total
 * may be exact while a cell of its column is hidden, and the 7-day return's denominator must be
 * a sum of shown sign-up cells (review rounds 1 and 2 of PR #966).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ROOT = join(__dirname, '..', '..', '..');
const SQL = readFileSync(
  join(ROOT, '.claude', 'skills', 'growth-funnel', 'launch-measure.sql'),
  'utf8',
);
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const FEW = 'کمتر از ۵';
const OVER = ' (روی هفته‌های نشان‌داده)';
const H = 60; // minutes in an hour: every offset below is in minutes from the invitation
const WEEK = 7 * 24 * H;

type Account = { tag: string; at: number; verified: boolean; status?: string; staff?: boolean };
type Fixture = {
  /** The invitation, this many days before today (UTC): 20 gives three weeks, 13 two. */
  days: number;
  accounts: Account[];
  /** When each member saved a prediction, one fixture each. */
  picks: Record<string, number[]>;
  /** Sessions: [member, created, last seen]. */
  sessions: [string, number, number][];
};
const hours = (...h: number[]): number[] => h.map((x) => x * H);

/**
 * Weekly sign-ups `s`, the first `v` of each verified, and per week `active` members who save one
 * prediction that week (members from before the invitation, a fresh set each week, so the people
 * add up: they are not sign-ups).
 */
function weekly(s: number[], v: number[], active: number[] = [], days = 20): Fixture {
  const accounts: Account[] = [];
  const picks: Record<string, number[]> = {};
  s.forEach((n, w) => {
    for (let i = 0; i < n; i++) {
      accounts.push({
        tag: `w${String(w + 1)}n${String(i)}`,
        at: w * WEEK + 34 * H,
        verified: i < v[w]!,
      });
    }
  });
  active.forEach((n, w) => {
    for (let i = 0; i < n; i++) {
      const tag = `q${String(w + 1)}n${String(i)}`;
      accounts.push({ tag, at: -134 * H, verified: true });
      picks[tag] = [w * WEEK + 36 * H];
    }
  });
  return { days, accounts, picks, sessions: [] };
}

/**
 * The rich fixture: the people left out, a session a minute short of day 7 and one on it.
 * Weekly (signed up, verified, active, predictions): week 1 (6, 5, 6, 13), week 2 (3, 1, 3, 6),
 * week 3 (1, 1, 3, 4).
 */
const RICH: Fixture = {
  days: 20,
  accounts: [
    ...['a1', 'a2', 'a3', 'a4', 'a5'].map((tag) => ({ tag, at: 34 * H, verified: true })),
    { tag: 'a6', at: 34 * H, verified: false },
    { tag: 'b1', at: 202 * H, verified: true },
    { tag: 'b2', at: 202 * H, verified: false },
    { tag: 'b3', at: 202 * H, verified: false },
    { tag: 'c1', at: 370 * H, verified: true },
    // left out: an internal account (the list), a staff role, a suspended account
    { tag: 'i1', at: 34 * H, verified: true },
    { tag: 's1', at: 34 * H, verified: true, staff: true },
    { tag: 'x1', at: 34 * H, verified: true, status: 'suspended' },
    // a member from before the invitation: not a sign-up, but their predictions since count
    { tag: 'p1', at: -134 * H, verified: true },
  ],
  picks: {
    a1: hours(60, 84, 108, /* week 2 */ 228, 252),
    a2: hours(60, 132, /* week 3 */ 372),
    a3: hours(60),
    a4: hours(167), // 23:00 on the last day of week 1
    a5: hours(60, 84, 108, 132),
    p1: hours(-36, 36, 60), // the first before the invitation: not counted
    i1: hours(60, 84, 108, 132, 156),
    s1: hours(60, 84),
    x1: hours(60),
    b1: hours(228),
    b2: hours(228, 252, 276),
    a6: hours(396, 420),
    c1: hours(396),
  },
  sessions: [
    ['a1', 34 * H, 228 * H], // seen on day 8
    ['a2', 34 * H, 372 * H],
    ['a3', 34 * H, 202 * H - 1], // a minute short of day 7: not returned
    ['a4', 34 * H, 58 * H],
    ['a4', 322 * H, 322 * H + 30], // a second session, on day 12
    ['a5', 34 * H, 202 * H], // exactly day 7: returned
    ['a6', 34 * H, 396 * H],
    ['b1', 202 * H, 228 * H], // day 1 only
    ['b2', 202 * H, 396 * H], // day 8
    ['c1', 370 * H, 468 * H], // not yet a member for 7 days
    ['i1', 34 * H, 444 * H],
    ['s1', 34 * H, 444 * H],
    ['x1', 34 * H, 444 * H],
    ['p1', -134 * H, 444 * H],
  ],
};

/** The reviewer's scenarios (round 2), each a way an exact total used to give a hidden cell back. */
const SCENARIOS: Record<string, Fixture> = {
  rich: RICH,
  a: weekly([10, 4, 4], [10, 4, 4]), // two hidden cells summing to 8: both were 4
  b: weekly([12, 5, 1], [12, 5, 1]), // a shown 5 beside a hidden 1
  c: weekly([5, 6], [5, 1], [], 13), // verified hidden beside a shown sign-up cell
  d: weekly([6, 6, 1], [6, 6, 1], [6, 5, 1]), // the per-active figure gave away member-weeks
  e: weekly([9, 9, 4], [9, 9, 4]), // ties
  f: weekly([5, 1], [5, 1], [], 13), // the second Monday's likely shape
  one: weekly([1, 0, 0], [0, 0, 0]), // production on 2026-11-27: one member
};

const persian = (text: string): string => text.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
const latin = (text: string): string =>
  text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace('٫', '.');
const HEAD = [
  '| هفته | از | ثبت‌نام | ایمیل تأییدشده | عضو فعال | پیش‌بینی | پیش‌بینی هر عضو فعال |',
  '|---|---|---|---|---|---|---|',
];

/**
 * What a reader could work out of a printed table, checked: no cell says «پنهان»; a column with a
 * hidden weekly cell gives no exact total, only «دست‌کم» the sum of its shown cells (for active
 * members at most that sum, people being counted once); the per-active figure is the shown weeks'
 * own; the 7-day return's denominator is a sum of shown sign-up cells.
 */
function noExactRecovery(lines: string[]): void {
  expect(lines.join('\n')).not.toContain('پنهان');
  const rows = lines.filter((l) => /^\| [۰-۹]/.test(l)).map((l) => l.split(' | ').slice(2, 7));
  const total = lines
    .find((l) => l.startsWith('| همه |'))!
    .replace(/^\| همه \| \| /, '')
    .replace(/ \|$/, '')
    .split(' | ');
  for (const col of [0, 1, 2, 3]) {
    const cells = rows.map((r) => r[col]!.replace(/ \|$/, ''));
    const shown = cells.filter((c) => c !== FEW).map((c) => Number(latin(c)));
    const sum = shown.reduce((x, y) => x + y, 0);
    if (cells.includes(FEW)) {
      expect(total[col]).toMatch(/^دست‌کم /);
      const n = Number(latin(total[col]!.replace('دست‌کم ', '')));
      if (col === 2) expect(n).toBeLessThanOrEqual(sum);
      else expect(n).toBe(sum);
    } else {
      expect(total[col]).not.toMatch(/^دست‌کم /);
    }
  }
  const shownBlocks = rows.filter((r) => r[2] !== FEW);
  const ratio = total[4]!;
  if (shownBlocks.length === 0) expect(ratio).toBe(FEW);
  else {
    const p = shownBlocks.reduce((x, r) => x + Number(latin(r[3]!)), 0);
    const a = shownBlocks.reduce((x, r) => x + Number(latin(r[2]!)), 0);
    expect(Number(latin(ratio.replace(OVER, '')))).toBeCloseTo(p / a, 2);
    if (shownBlocks.length < rows.length) expect(ratio.endsWith(OVER)).toBe(true);
  }
  const back = lines.find((l) => l.startsWith('بازگشت'))!;
  const of = /[؛:] [۰-۹]+ از ([۰-۹]+) /.exec(back);
  if (of !== null) {
    const shownSignUps = rows
      .map((r) => r[0]!)
      .filter((c) => c !== FEW)
      .map((c) => Number(latin(c)));
    const sums = shownSignUps.reduce((acc, x) => [...acc, ...acc.map((y) => y + x)], [0]);
    expect(sums).toContain(Number(latin(of[1]!)));
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the launch measure', () => {
  let client: Client;
  const out: Record<string, { launch: string; lines: string[] }> = {};
  const ids: string[] = [];

  /** Seeds the fixture, measures it and rolls it back; the lines the file printed. */
  async function measure(fixture: Fixture): Promise<{ launch: string; lines: string[] }> {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      const { rows: day } = await client.query<{ launch: string }>(
        `SELECT to_char((now() AT TIME ZONE 'UTC')::date - $1::int, 'YYYY-MM-DD') AS launch`,
        [fixture.days],
      );
      const launch = day[0]!.launch;
      const at = `$1::date::timestamp AT TIME ZONE 'UTC' + make_interval(mins => $2::int)`;
      const most = Math.max(1, ...Object.values(fixture.picks).map((p) => p.length));
      const { rows: fixtures } = await client.query<{ id: string }>(
        `INSERT INTO fixture
         SELECT (jsonb_populate_record(NULL::fixture, to_jsonb(f) || jsonb_build_object('id', gen_random_uuid()))).*
           FROM (SELECT * FROM fixture ORDER BY id LIMIT 1) f, generate_series(1, $1::int)
         RETURNING id`,
        [most],
      );
      expect(fixtures).toHaveLength(most);

      const own: Record<string, string> = {};
      for (const a of fixture.accounts) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO user_account (username, display_name, email, email_verified_at, country_id,
                                     preferred_language, timezone, accepted_rules_at, status, created_at)
           VALUES ($3, $3, $3 || '@example.test', CASE WHEN $4 THEN ${at} END,
                   (SELECT id FROM country ORDER BY id LIMIT 1), 'fa', 'Asia/Tehran', ${at}, $5, ${at})
           RETURNING id`,
          [launch, a.at, `lm_${RUN}_${a.tag}`, a.verified, a.status ?? 'active'],
        );
        own[a.tag] = rows[0]!.id;
        ids.push(rows[0]!.id);
        if (a.staff === true) {
          await client.query(
            `INSERT INTO user_role (user_id, role, reason) VALUES ($1, 'admin', 'launch-measure spec')`,
            [own[a.tag]],
          );
        }
      }
      for (const [tag, times] of Object.entries(fixture.picks)) {
        for (const [k, minutes] of times.entries()) {
          await client.query(
            `INSERT INTO user_prediction (user_id, fixture_id, created_at, updated_at)
             VALUES ($3, $4, ${at}, ${at})`,
            [launch, minutes, own[tag], fixtures[k]!.id],
          );
        }
      }
      for (const [k, [tag, created, last]] of fixture.sessions.entries()) {
        await client.query(
          `INSERT INTO session (user_id, token_hash, created_at, last_seen_at, expires_at)
           VALUES ($3, $4, ${at}, $1::date::timestamp AT TIME ZONE 'UTC' + make_interval(mins => $5::int),
                   ${at} + interval '14 days')`,
          [launch, created, own[tag], `launch-measure-${RUN}-${String(k)}`, last],
        );
      }

      // Every other account in the snapshot is "internal", with the fixture's own i1.
      const ours = Object.entries(own)
        .filter(([tag]) => tag !== 'i1')
        .map(([, id]) => id);
      const { rows: others } = await client.query<{ id: string }>(
        `SELECT id FROM user_account WHERE NOT (id = ANY ($1::uuid[]))`,
        [ours],
      );
      const internal = `{${others.map((r) => r.id).join(',')}}`;
      const text = SQL.replaceAll(":'launch'", `'${launch}'`).replaceAll(
        ":'internal'",
        `'${internal}'`,
      );
      const results = (await client.query(text)) as unknown as { rows: { line: string }[] }[];
      return { launch, lines: results.flatMap((result) => result.rows.map((row) => row.line)) };
    } finally {
      await client.query('ROLLBACK');
    }
  }

  /** The first day of a week, in Persian digits, for the scenario's invitation. */
  const start = (name: string, week: number): string => {
    const day = new Date(`${out[name]!.launch}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 7 * (week - 1));
    return persian(day.toISOString().slice(0, 10));
  };
  const hidden = (label: string, from: string): string =>
    `| ${label} | ${from} | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    // A launch at midnight UTC is the afternoon before in Los Angeles.
    await client.query(`SET TIME ZONE 'America/Los_Angeles'`);
    for (const [name, fixture] of Object.entries(SCENARIOS)) out[name] = await measure(fixture);
  }, 60_000); // eight fixtures, row by row: past the 10 s default on a busy machine

  afterAll(async () => {
    await client.end();
  });

  it("gives the hand count per invitation week, a hidden cell «کمتر از ۵», its column's total «دست‌کم»", () => {
    expect(out.rich!.lines).toEqual([
      ...HEAD,
      // 6 signed up, 5 verified; 6 active (p1 among them), 13 predictions, 13 / 6
      `| ۱ | ${start('rich', 1)} | ۶ | ۵ | ۶ | ۱۳ | ۲٫۱۷ |`,
      hidden('۲', start('rich', 2)),
      hidden('۳ (در جریان)', start('rich', 3)),
      // the totals (10, 7, 10 people, 23) are not printed: they would give weeks 2 and 3 back
      `| همه | | دست‌کم ۶ | دست‌کم ۵ | دست‌کم ۶ | دست‌کم ۱۳ | ۲٫۱۷${OVER} |`,
      // Week 1 (6 members, the only whole week 7 days past): seen on or after day 7 a1, a2, a4,
      // a5, a6 (a3 a minute short); predicted then a1, a2, a6. Week 2 has 3: not counted.
      'بازگشت ۷ روزه، اعضای هفتهٔ ۱: ۵ از ۶ در روز هفتم یا پس از آن دوباره دیده شدند؛ ۳ از همان ۶ در روز هفتم یا پس از آن پیش‌بینی هم کردند.',
    ]);
  });

  it("gives no hidden cell back in any of the reviewer's scenarios", () => {
    for (const [name, { lines }] of Object.entries(out)) {
      expect(lines.length, name).toBeGreaterThan(4);
      noExactRecovery(lines);
    }
    const totals = Object.fromEntries(
      Object.entries(out).map(([name, { lines }]) => [
        name,
        lines.find((l) => l.startsWith('| همه |')),
      ]),
    );
    expect(totals).toEqual({
      rich: `| همه | | دست‌کم ۶ | دست‌کم ۵ | دست‌کم ۶ | دست‌کم ۱۳ | ۲٫۱۷${OVER} |`,
      a: `| همه | | دست‌کم ۱۰ | دست‌کم ۱۰ | دست‌کم ۰ | دست‌کم ۰ | ${FEW} |`,
      b: `| همه | | دست‌کم ۱۷ | دست‌کم ۱۷ | دست‌کم ۰ | دست‌کم ۰ | ${FEW} |`,
      c: `| همه | | ۱۱ | دست‌کم ۵ | دست‌کم ۰ | دست‌کم ۰ | ${FEW} |`,
      d: `| همه | | دست‌کم ۱۲ | دست‌کم ۱۲ | دست‌کم ۱۱ | دست‌کم ۱۱ | ۱٫۰۰${OVER} |`,
      e: `| همه | | دست‌کم ۱۸ | دست‌کم ۱۸ | دست‌کم ۰ | دست‌کم ۰ | ${FEW} |`,
      f: `| همه | | دست‌کم ۵ | دست‌کم ۵ | دست‌کم ۰ | دست‌کم ۰ | ${FEW} |`,
      one: `| همه | | دست‌کم ۰ | دست‌کم ۰ | دست‌کم ۰ | دست‌کم ۰ | ${FEW} |`,
    });
  });

  it('shows a sign-up cell beside a hidden verified cell, with no exact verified total (scenario c)', () => {
    expect(out.c!.lines).toEqual([
      ...HEAD,
      `| ۱ | ${start('c', 1)} | ۵ | ۵ | ${FEW} | ${FEW} | ${FEW} |`,
      `| ۲ (در جریان) | ${start('c', 2)} | ۶ | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`,
      `| همه | | ۱۱ | دست‌کم ۵ | دست‌کم ۰ | دست‌کم ۰ | ${FEW} |`,
      'بازگشت ۷ روزه: هنوز هفته‌ای نیست که دست‌کم ۷ روز پیش تمام شده و ثبت‌نامش نشان داده شده باشد.',
    ]);
  });

  it('computes the per-active figure over the shown weeks only (scenario d)', () => {
    expect(out.d!.lines.slice(2, 6)).toEqual([
      `| ۱ | ${start('d', 1)} | ۶ | ۶ | ۶ | ۶ | ۱٫۰۰ |`,
      `| ۲ | ${start('d', 2)} | ۶ | ۶ | ۵ | ۵ | ۱٫۰۰ |`,
      hidden('۳ (در جریان)', start('d', 3)),
      `| همه | | دست‌کم ۱۲ | دست‌کم ۱۲ | دست‌کم ۱۱ | دست‌کم ۱۱ | ۱٫۰۰${OVER} |`,
    ]);
  });

  it('prints only «کمتر از ۵» and «دست‌کم ۰» for one member, and no return yet', () => {
    expect(out.one!.lines).toEqual([
      ...HEAD,
      hidden('۱', start('one', 1)),
      hidden('۲', start('one', 2)),
      hidden('۳ (در جریان)', start('one', 3)),
      `| همه | | دست‌کم ۰ | دست‌کم ۰ | دست‌کم ۰ | دست‌کم ۰ | ${FEW} |`,
      'بازگشت ۷ روزه: هنوز هفته‌ای نیست که دست‌کم ۷ روز پیش تمام شده و ثبت‌نامش نشان داده شده باشد.',
    ]);
  });

  it('prints no id, username or e-mail, selects no personal column, and pins UTC', () => {
    const output = Object.values(out)
      .flatMap((o) => o.lines)
      .join('\n');
    expect(output).not.toMatch(/@|lm_/);
    for (const id of ids) expect(output).not.toContain(id);
    const code = SQL.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/\b(email|username|display_name|user_agent|body|token_hash)\b/);
    expect(code).toMatch(/^SET TIME ZONE 'UTC';$/m);
  });
});
