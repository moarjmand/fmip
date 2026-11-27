import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The launch measure's queries (T-1966, T-1968, D-459 point 4) on a hand-counted fixture.
 * `.claude/skills/growth-funnel/launch-measure.sql` is the file `launch-measure.sh` sends to
 * production through `data-audit/run.sh`; here its two psql variables are replaced with
 * literals and it runs on the migrated schema, so a renamed column fails CI rather than the
 * Monday read.
 *
 * Everything happens inside one REPEATABLE READ transaction that is rolled back: the
 * fixture's rows never commit, and accounts other suites create meanwhile are outside the
 * snapshot. Every account the snapshot holds besides the fixture's goes into the internal
 * list, so the counts are the fixture's alone. The invitation date is 20 days before today
 * (UTC), so the run falls in week 3, the week still running.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ROOT = join(__dirname, '..', '..', '..');
const SQL = readFileSync(
  join(ROOT, '.claude', 'skills', 'growth-funnel', 'launch-measure.sql'),
  'utf8',
);
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const FEW = 'کمتر از ۵';
const H = 60; // minutes in an hour: every offset below is in minutes from the invitation

type Account = { tag: string; at: number; verified: boolean; status?: string; staff?: boolean };
const ACCOUNTS: Account[] = [
  // week 1: six members, five verified
  ...['a1', 'a2', 'a3', 'a4', 'a5'].map((tag) => ({ tag, at: 34 * H, verified: true })),
  { tag: 'a6', at: 34 * H, verified: false },
  // week 2: three, one verified; week 3: one, verified
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
];
/** When each member saved a prediction, one fixture each. */
const PICKS: Record<string, number[]> = {
  // week 1: 6 active, 13 predictions
  a1: [60, 84, 108, /* week 2 */ 228, 252].map((h) => h * H),
  a2: [60, 132, /* week 3 */ 372].map((h) => h * H),
  a3: [60 * H],
  a4: [167 * H], // 23:00 on the last day of week 1
  a5: [60, 84, 108, 132].map((h) => h * H),
  p1: [-36, 36, 60].map((h) => h * H), // the first before the invitation: not counted
  i1: [60, 84, 108, 132, 156].map((h) => h * H),
  s1: [60, 84].map((h) => h * H),
  x1: [60 * H],
  // week 2: a1, b1, b2 -> 3 active, 6 predictions
  b1: [228 * H],
  b2: [228, 252, 276].map((h) => h * H),
  // week 3: a2, a6, c1 -> 3 active, 4 predictions
  a6: [396, 420].map((h) => h * H),
  c1: [396 * H],
};
/** Sessions: [member, created, last seen]. */
const SESSIONS: [string, number, number][] = [
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
];

const persian = (text: string): string => text.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the launch measure', () => {
  let client: Client;
  let lines: string[] = [];
  let launch = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const { rows: day } = await client.query<{ launch: string }>(
      `SELECT to_char((now() AT TIME ZONE 'UTC')::date - 20, 'YYYY-MM-DD') AS launch`,
    );
    launch = day[0]!.launch;
    const at = `$1::date::timestamp AT TIME ZONE 'UTC' + make_interval(mins => $2::int)`;

    const { rows: fixtures } = await client.query<{ id: string }>(
      `INSERT INTO fixture
       SELECT (jsonb_populate_record(NULL::fixture, to_jsonb(f) || jsonb_build_object('id', gen_random_uuid()))).*
         FROM (SELECT * FROM fixture ORDER BY id LIMIT 1) f, generate_series(1, 6)
       RETURNING id`,
    );
    expect(fixtures).toHaveLength(6);

    for (const a of ACCOUNTS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO user_account (username, display_name, email, email_verified_at, country_id,
                                   preferred_language, timezone, accepted_rules_at, status, created_at)
         VALUES ($3, $3, $3 || '@example.test', CASE WHEN $4 THEN ${at} END,
                 (SELECT id FROM country ORDER BY id LIMIT 1), 'fa', 'Asia/Tehran', ${at}, $5, ${at})
         RETURNING id`,
        [launch, a.at, `lm_${RUN}_${a.tag}`, a.verified, a.status ?? 'active'],
      );
      ids[a.tag] = rows[0]!.id;
      if (a.staff === true) {
        await client.query(
          `INSERT INTO user_role (user_id, role, reason) VALUES ($1, 'admin', 'launch-measure spec')`,
          [ids[a.tag]],
        );
      }
    }
    for (const [tag, times] of Object.entries(PICKS)) {
      for (const [k, minutes] of times.entries()) {
        await client.query(
          `INSERT INTO user_prediction (user_id, fixture_id, created_at, updated_at)
           VALUES ($3, $4, ${at}, ${at})`,
          [launch, minutes, ids[tag], fixtures[k]!.id],
        );
      }
    }
    for (const [k, [tag, created, last]] of SESSIONS.entries()) {
      await client.query(
        `INSERT INTO session (user_id, token_hash, created_at, last_seen_at, expires_at)
         VALUES ($3, $4, ${at}, $1::date::timestamp AT TIME ZONE 'UTC' + make_interval(mins => $5::int),
                 ${at} + interval '14 days')`,
        [launch, created, ids[tag], `launch-measure-${RUN}-${String(k)}`, last],
      );
    }

    // Every other account in the snapshot is "internal", with the fixture's own i1.
    const ours = Object.entries(ids)
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
    lines = results.flatMap((result) => result.rows.map((row) => row.line));
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('gives the hand count per invitation week, a cell under 5 as «کمتر از ۵», the totals as they are', () => {
    const start = (week: number): string => {
      const day = new Date(`${launch}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() + 7 * (week - 1));
      return persian(day.toISOString().slice(0, 10));
    };
    expect(lines.slice(0, 6)).toEqual([
      '| هفته | از | ثبت‌نام | ایمیل تأییدشده | عضو فعال | پیش‌بینی | پیش‌بینی هر عضو فعال |',
      '|---|---|---|---|---|---|---|',
      // 6 signed up, 5 verified; 6 active (p1 among them), 13 predictions, 13 / 6
      `| ۱ | ${start(1)} | ۶ | ۵ | ۶ | ۱۳ | ۲٫۱۷ |`,
      // 3 signed up, 1 verified; 3 active with 6 predictions: the whole breakdown hidden
      `| ۲ | ${start(2)} | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`,
      `| ۳ (در جریان) | ${start(3)} | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`,
      // 10 signed up, 7 verified, 10 different people active, 23 predictions over 12 member-weeks
      '| همه | | ۱۰ | ۷ | ۱۰ | ۲۳ | ۱٫۹۲ |',
    ]);
  });

  it('gives the 7-day return as counts: seen again on or after day 7, and predicted then', () => {
    // Eligible: a1-a6 and b1-b3 (c1 joined under 7 days ago). Seen: a1, a2, a4, a5, a6, b2.
    // Predicted on or after their day 7: a1, a2, a6.
    expect(lines.slice(6)).toEqual([
      'بازگشت ۷ روزه: ۶ از ۹ عضوی که دست‌کم ۷ روز پیش ثبت‌نام کرده‌اند، در روز هفتم یا پس از آن دوباره دیده شدند؛ ۳ از همان ۹ در روز هفتم یا پس از آن پیش‌بینی هم کردند.',
    ]);
  });

  it('prints no id, username or e-mail, and selects no personal column', () => {
    const output = lines.join('\n');
    expect(output).not.toMatch(/@|lm_/);
    for (const id of Object.values(ids)) expect(output).not.toContain(id);
    const code = SQL.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/\b(email|username|display_name|user_agent|body|token_hash)\b/);
  });
});
