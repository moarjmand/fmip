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
 * the run falls in week 3, the week still running. The session's own time zone is set far from
 * UTC first: the file must pin UTC itself.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ROOT = join(__dirname, '..', '..', '..');
const SQL = readFileSync(
  join(ROOT, '.claude', 'skills', 'growth-funnel', 'launch-measure.sql'),
  'utf8',
);
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const FEW = 'کمتر از ۵';
const HID = 'پنهان';
const H = 60; // minutes in an hour: every offset below is in minutes from the invitation

type Account = { tag: string; at: number; verified: boolean; status?: string; staff?: boolean };
type Fixture = {
  accounts: Account[];
  /** When each member saved a prediction, one fixture each. */
  picks: Record<string, number[]>;
  /** Sessions: [member, created, last seen]. */
  sessions: [string, number, number][];
};
const hours = (...h: number[]): number[] => h.map((x) => x * H);

/**
 * Two hidden weeks whose sum is under 5, the running week hidden, and the people left out.
 * Weekly (signed up, verified, active, predictions): week 1 (6, 5, 6, 13), week 2 (3, 1, 3, 6),
 * week 3 (1, 1, 3, 4); totals (10, 7, 10 people, 23) over 12 member-weeks.
 */
const ONE: Fixture = {
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

/**
 * Exactly one hidden week (the running one). Weekly (signed up, verified, active, predictions):
 * week 1 (6, 5, 5, 5), week 2 (5, 5, 6, 6), week 3 (2, 0, 2, 2); totals (13, 10, 6 people, 13)
 * over 13 member-weeks. Signed up leaves 2 behind the shown cells and verified 0; predictions
 * and member-weeks leave 2.
 */
const TWO: Fixture = {
  accounts: [
    ...['a1', 'a2', 'a3', 'a4', 'a5'].map((tag) => ({ tag, at: 34 * H, verified: true })),
    { tag: 'a6', at: 34 * H, verified: false },
    ...['b1', 'b2', 'b3', 'b4', 'b5'].map((tag) => ({ tag, at: 202 * H, verified: true })),
    { tag: 'c1', at: 370 * H, verified: false },
    { tag: 'c2', at: 370 * H, verified: false },
  ],
  picks: {
    a1: hours(60, 228, 396),
    a2: hours(60, 228, 396),
    a3: hours(60, 228),
    a4: hours(60, 228),
    a5: hours(60, 228),
    a6: hours(228),
  },
  sessions: [],
};

/** Production's case on 2026-11-27: one member, nothing else. */
const THREE: Fixture = {
  accounts: [{ tag: 't1', at: 34 * H, verified: false }],
  picks: {},
  sessions: [],
};

const persian = (text: string): string => text.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the launch measure', () => {
  let client: Client;
  let launch = '';
  const out: Record<string, string[]> = {};
  const ids: string[] = [];

  /** Seeds the fixture, measures it and rolls it back; the lines the file printed. */
  async function measure(fixture: Fixture): Promise<string[]> {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
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
      return results.flatMap((result) => result.rows.map((row) => row.line));
    } finally {
      await client.query('ROLLBACK');
    }
  }

  const start = (week: number): string => {
    const day = new Date(`${launch}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 7 * (week - 1));
    return persian(day.toISOString().slice(0, 10));
  };
  const HEAD = [
    '| هفته | از | ثبت‌نام | ایمیل تأییدشده | عضو فعال | پیش‌بینی | پیش‌بینی هر عضو فعال |',
    '|---|---|---|---|---|---|---|',
  ];

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    // A launch at midnight UTC is the afternoon before in Los Angeles.
    await client.query(`SET TIME ZONE 'America/Los_Angeles'`);
    const { rows } = await client.query<{ launch: string }>(
      `SELECT to_char((now() AT TIME ZONE 'UTC')::date - 20, 'YYYY-MM-DD') AS launch`,
    );
    launch = rows[0]!.launch;
    out.one = await measure(ONE);
    out.two = await measure(TWO);
    out.three = await measure(THREE);
  });

  afterAll(async () => {
    await client.end();
  });

  it('hides what a subtraction would give back: two hidden weeks under 5 together, the running week', () => {
    expect(out.one!.slice(0, 6)).toEqual([
      ...HEAD,
      // Signed up 10 - 6 = 4 and verified 7 - 5 = 2 behind the shown cells, and 10 people - 6
      // shown = 4: week 1's cells go too, as «پنهان» (they are 5 or more).
      `| ۱ | ${start(1)} | ${HID} | ${HID} | ${HID} | ${HID} | ${HID} |`,
      `| ۲ | ${start(2)} | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`,
      `| ۳ (در جریان) | ${start(3)} | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`,
      // 10 signed up, 7 verified, 10 different people active, 23 predictions over 12 member-weeks
      '| همه | | ۱۰ | ۷ | ۱۰ | ۲۳ | ۱٫۹۲ |',
    ]);
  });

  it('with one hidden week, hides the smallest shown cell of a column whose remainder is 1 to 4, and keeps the totals', () => {
    expect(out.two).toEqual([
      ...HEAD,
      // Signed up: 13 - (6 + 5) = 2, so week 2's 5 goes; verified: 10 - (5 + 5) = 0, nothing more.
      // Predictions 13 - (5 + 6) = 2 and member-weeks 13 - 11 = 2: the smaller block, week 1's, goes.
      `| ۱ | ${start(1)} | ۶ | ۵ | ${HID} | ${HID} | ${HID} |`,
      `| ۲ | ${start(2)} | ${HID} | ۵ | ۶ | ۶ | ۱٫۰۰ |`,
      `| ۳ (در جریان) | ${start(3)} | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`,
      '| همه | | ۱۳ | ۱۰ | ۶ | ۱۳ | ۱٫۰۰ |',
      // Eligible a1-a6 and b1-b5; no sessions in this fixture; a1-a6 predicted in week 2.
      'بازگشت ۷ روزه: ۰ از ۱۱ عضوی که دست‌کم ۷ روز پیش ثبت‌نام کرده‌اند، در روز هفتم یا پس از آن دوباره دیده شدند؛ ۶ از همان ۱۱ در روز هفتم یا پس از آن پیش‌بینی هم کردند.',
    ]);
  });

  it('prints a total under 5 as «کمتر از ۵», hides the ratio, and waits for 5 eligible members', () => {
    expect(out.three).toEqual([
      ...HEAD,
      `| ۱ | ${start(1)} | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`,
      `| ۲ | ${start(2)} | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`,
      `| ۳ (در جریان) | ${start(3)} | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${FEW} |`,
      `| همه | | ${FEW} | ${FEW} | ${FEW} | ${FEW} | ${HID} |`,
      'بازگشت ۷ روزه: کمتر از ۵ عضو دست‌کم ۷ روز پیش ثبت‌نام کرده‌اند؛ تا ۵ نشوند نشان داده نمی‌شود.',
    ]);
  });

  it('gives the 7-day return as counts: seen again on or after day 7, and predicted then', () => {
    // Eligible: a1-a6 and b1-b3 (c1 joined under 7 days ago). Seen: a1, a2, a4, a5, a6, b2.
    // Predicted on or after their day 7: a1, a2, a6.
    expect(out.one!.slice(6)).toEqual([
      'بازگشت ۷ روزه: ۶ از ۹ عضوی که دست‌کم ۷ روز پیش ثبت‌نام کرده‌اند، در روز هفتم یا پس از آن دوباره دیده شدند؛ ۳ از همان ۹ در روز هفتم یا پس از آن پیش‌بینی هم کردند.',
    ]);
  });

  it('prints no id, username or e-mail, selects no personal column, and pins UTC', () => {
    const output = Object.values(out).flat().join('\n');
    expect(output).not.toMatch(/@|lm_/);
    for (const id of ids) expect(output).not.toContain(id);
    const code = SQL.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/\b(email|username|display_name|user_agent|body|token_hash)\b/);
    expect(code).toMatch(/^SET TIME ZONE 'UTC';$/m);
  });
});
