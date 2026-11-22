import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsoleFinding, ConsoleMe } from '@fmip/contracts';
import { CONSOLE_SNOOZE_MAX_DAYS, CONSOLE_SNOOZE_MAX_DAYS_SEVERE } from '@fmip/contracts/console';
import type * as ReactModule from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FINDINGS, FIXTURE_HEARTBEAT, FIXTURE_NOW } from './findings.fixture';

/**
 * Finding triage on the findings page (T-1908, D-456 point 2 and its
 * addition of 2026-11-21): the five counts, the three buttons, the waiting
 * state that never reads as finished, an accept's task id only when the
 * snapshot has it, a refusal said in Persian in a `role="alert"`, and the
 * finding's own page.
 */

const world = vi.hoisted(() => ({
  findings: [] as unknown[],
  me: { id: 'u1', username: 'maryam', display_name: 'مریم', owner: true } as unknown,
  heartbeat: null as unknown,
  /** What the form's last answer was, as `useActionState` would hold it. */
  state: { error: null, done: null } as { error: string | null; done: string | null; id?: string },
  calls: [] as { path: string; init: { method?: string; body?: unknown } }[],
  answer: { ok: true, status: 201, data: {}, setCookie: null } as unknown,
}));

vi.mock('react', async (original) => ({
  ...(await original<typeof ReactModule>()),
  useActionState: (_action: unknown, _initial: unknown) => [world.state, () => undefined, false],
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/app/console/console-link', () => ({
  ConsoleLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/console-base', () => ({ consoleUrl: async (path: string) => path }));
vi.mock('@/lib/console-api', () => {
  const ok = <T,>(data: T) =>
    Promise.resolve({ ok: true as const, status: 200, data, setCookie: null });
  return {
    applyConsoleCookie: async () => undefined,
    consoleMe: () => ok(world.me),
    consoleSnapshot: () =>
      ok({ snapshot: { findings: world.findings }, loaded_at: '2026-11-22T05:58:00.000Z' }),
    consoleHeartbeat: () => ok(world.heartbeat),
    consoleCall: (path: string, init: { method?: string; body?: unknown } = {}) => {
      world.calls.push({ path, init });
      return Promise.resolve(world.answer);
    },
  };
});

const { TriageCounts, TriageRow, OWNER_ONLY_WORDS, triageView } = await import('./findings');
const { FindingTriage, snoozeDayOptions } = await import('./finding-triage');
const {
  TRIAGE_GROUPS,
  WITHHELD_TITLE,
  findingParts,
  nextSyncWords,
  rejectReason,
  similarFindings,
  snoozeDays,
  triageCounts,
  triageGroup,
} = await import('./triage');
const { apiErrorWords, outcomeWords, auditActionWords } = await import('./words');
const { triageFinding } = await import('@/lib/console-actions');

const OWNER: ConsoleMe = { id: 'u1', username: 'maryam', display_name: 'مریم', owner: true };
const MATE: ConsoleMe = { id: 'u2', username: 'kaveh', display_name: 'کاوه', owner: false };
const context = (me: ConsoleMe | null = OWNER) => ({
  heartbeat: FIXTURE_HEARTBEAT,
  me,
  now: FIXTURE_NOW,
});
const byId = (id: string): ConsoleFinding => {
  const finding = FINDINGS.find((f) => f.id === id);
  if (finding === undefined) throw new Error(`no fixture finding ${id}`);
  return finding;
};
const row = (id: string, me: ConsoleMe | null = OWNER, change: Partial<ConsoleFinding> = {}) =>
  renderToStaticMarkup(
    <ul>
      <TriageRow finding={{ ...byId(id), ...change }} context={context(me)} />
    </ul>,
  );
const buttons = (html: string): string[] =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]!);
const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const NEEDS = 'qa-2026-11-21-02';
const PENDING_REJECT = 'dat-2026-11-20-01';
const PENDING_TAKEN = 'ops-2026-11-19-01';
const ACCEPTED_WAITING = 'des-2026-11-18-03';
const ACCEPTED_TASK = 'qa-2026-11-17-01';
const REJECTED = 'seo-2026-11-16-02';
const SNOOZED = 'con-2026-11-15-01';
const SECURITY = 'sec-2026-11-20-01';
const SECURITY_PLANNED = 'sec-2026-11-12-01';

beforeEach(() => {
  world.findings = FINDINGS;
  world.me = OWNER;
  world.heartbeat = FIXTURE_HEARTBEAT;
  world.state = { error: null, done: null };
  world.calls = [];
  world.answer = { ok: true, status: 201, data: {}, setCookie: null };
});

describe('the five counts', () => {
  it('sum to the total on the fixture snapshot, each finding in exactly one group', () => {
    const counts = triageCounts(FINDINGS);
    expect(counts).toEqual({ needs: 5, accepted: 3, rejected: 1, snoozed: 1, closed: 3 });
    expect(TRIAGE_GROUPS.reduce((sum, group) => sum + counts[group], 0)).toBe(FINDINGS.length);
    // A command that waits does not move a finding: the snapshot's status alone decides.
    expect(triageGroup(byId(PENDING_REJECT))).toBe('needs');
    // A status this page does not know still wants someone; it is never dropped from the sum.
    expect(triageGroup({ status: 'decide' as never })).toBe('needs');
    const odd = [...FINDINGS, { status: 'something-new' as never }];
    const oddCounts = triageCounts(odd);
    expect(TRIAGE_GROUPS.reduce((sum, group) => sum + oddCounts[group], 0)).toBe(odd.length);
  });

  it('are drawn as six linked tiles whose five groups add up to the one marked «همه»', () => {
    const html = renderToStaticMarkup(
      <TriageCounts
        counts={triageCounts(FINDINGS)}
        current="needs"
        hrefOf={(group) => `/findings?status=${group}`}
      />,
    );
    const tiles = [
      ...html.matchAll(
        /data-count="(\w+)"[^>]*>.*?<span[^>]*>([^<]+)<\/span><span[^>]*>([^<]+)<\/span>/g,
      ),
    ];
    expect(tiles.map((m) => [m[1], m[2], m[3]])).toEqual([
      ['needs', 'نیاز به تصمیم', '۵'],
      ['accepted', 'پذیرفته', '۳'],
      ['rejected', 'رد شده', '۱'],
      ['snoozed', 'به تعویق افتاده', '۱'],
      ['closed', 'بسته', '۳'],
      ['all', 'همه', '۱۳'],
    ]);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('href="/findings?status=closed"');
  });

  it('are counted over what the agent and severity filters leave, on the page', async () => {
    const page = (await import('./(app)/findings/page')).default;
    const html = renderToStaticMarkup(
      <>{await page({ searchParams: Promise.resolve({ agent: 'qa-engineer', status: 'all' }) })}</>,
    );
    const count = (group: string) =>
      new RegExp(`data-count="${group}"[^>]*>.*?</span><span[^>]*>([^<]+)</span>`).exec(html)?.[1];
    expect(['needs', 'accepted', 'rejected', 'snoozed', 'closed', 'all'].map(count)).toEqual([
      '۲',
      '۱',
      '۰',
      '۰',
      '۱',
      '۴',
    ]);
    expect(html.match(/<li class="flex flex-col gap-2 border-b/g)).toHaveLength(4);
    // The page opens on what needs a decision; the older links still land where they did.
    const first = renderToStaticMarkup(<>{await page({ searchParams: Promise.resolve({}) })}</>);
    expect(first).toContain('یافته‌ها · ۵');
    const fixed = renderToStaticMarkup(
      <>{await page({ searchParams: Promise.resolve({ status: 'fixed' }) })}</>,
    );
    expect(fixed).toContain('یافته‌ها · ۳');
  });
});

describe('a finding that needs triage', () => {
  it('has three buttons, each a <button>, the accept in a form of its own, and its page linked', () => {
    const html = row(NEEDS);
    expect(buttons(html)).toEqual(['قبول', 'رد…', 'به تعویق…']);
    expect(html).toMatch(
      /<form[^>]*><input type="hidden" name="kind" value="finding.accept"\/><input type="hidden" name="target" value="qa-2026-11-21-02"\/><button type="submit"/,
    );
    // No write is a link: the only links are to the finding's own page.
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(links)).toEqual(new Set(['/findings/qa-2026-11-21-02']));
    // The group is named by the finding's title, and the two that open a form say whether it is open.
    expect(html).toContain('role="group" aria-labelledby="finding-qa-2026-11-21-02"');
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    // An English title keeps its own direction inside the Persian page.
    expect(html).toContain(
      '<bdi dir="auto">Standings table scrolls sideways at 375 px on the league page</bdi>',
    );
  });

  it('shows both accounts the same buttons', () => {
    expect(row(NEEDS, MATE)).toBe(row(NEEDS, OWNER));
    expect(row(SNOOZED, MATE)).toBe(row(SNOOZED, OWNER));
  });

  it('offers tomorrow, three days and next week in Tehran days, and no day past the limit', () => {
    // 11:00 in Tehran on 22 November: tomorrow is the 23rd.
    const major = snoozeDays('major', FIXTURE_NOW);
    expect(major.choices.map((c) => c.until)).toEqual(['2026-11-23', '2026-11-25', '2026-11-29']);
    expect([major.min, major.max, major.limit]).toEqual([
      '2026-11-23',
      '2026-12-06',
      CONSOLE_SNOOZE_MAX_DAYS_SEVERE,
    ]);
    const minor = snoozeDays('minor', FIXTURE_NOW);
    expect([minor.max, minor.limit]).toEqual(['2027-02-20', CONSOLE_SNOOZE_MAX_DAYS]);
    // 01:00 in Tehran on the 23rd is still the 22nd in UTC: tomorrow is the 24th here, and the
    // last day is counted from the server's UTC day, so the API refuses none of them.
    const night = snoozeDays('critical', new Date('2026-11-22T21:30:00.000Z'));
    expect(night.choices.map((c) => c.until)).toEqual(['2026-11-24', '2026-11-26', '2026-11-30']);
    expect(night.max).toBe('2026-12-06');
    const view = triageView(byId(NEEDS), context());
    // The view carries the two ends only; the list is built in the browser when the form opens.
    expect([view.snooze.min, view.snooze.max]).toEqual(['2026-11-23', '2026-12-06']);
    expect(JSON.stringify(view).length).toBeLessThan(1200);
    const days = snoozeDayOptions(view.snooze.min, view.snooze.max);
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ until: '2026-11-23', label: 'دوشنبه ۲ آذر' });
    expect(days.at(-1)?.until).toBe('2026-12-06');
    // Never more than the longest snooze, whatever the two ends say.
    expect(snoozeDayOptions('2026-11-23', '2028-01-01')).toHaveLength(90);
    expect(snoozeDayOptions('nope', '2026-12-06')).toEqual([]);
    expect(view.snooze.choices[0]?.label).toBe('فردا · ۲ آذر');
    expect(view.snooze.limit).toContain('۱۴ روز');
  });
});

describe('a command that waits', () => {
  it('says the computer has not applied it, with the next sync, and never the finished state', () => {
    const html = row(PENDING_REJECT);
    expect(html).toContain('رد · در انتظار');
    expect(html).toContain('ثبت شده، ولی رایانه هنوز آن را انجام نداده است.');
    expect(html).toContain('هم‌گام‌سازی بعدی حدود ۱۵:۲۵ است.');
    expect(html).toContain('تا آن‌وقت وضعیت یافته همان است که بود.');
    expect(html).toContain('مریم ·');
    // The badges are the snapshot's: still open, with the waiting command beside it.
    expect(html).toContain('>باز</span>');
    expect(html).toContain('در انتظار رایانه');
    expect(html).not.toContain('رد شده');
    // Nothing more can be asked of it but the withdrawal, which is a button in a form.
    expect(buttons(html)).toEqual(['انصراف از این دستور']);
    expect(html).toContain('name="kind" value="withdraw"');
    expect(html).toContain('name="command" value="6f0c2a54-91d3-4c1e-8a57-2b7f0e4d9a10"');
  });

  it('stays "not applied" until the snapshot itself carries the new status', () => {
    const waiting = row(NEEDS, OWNER, {
      pending: {
        command_id: 'c-1',
        kind: 'finding.accept',
        requested_by: 'مریم',
        requested_at: '2026-11-22T07:00:00.000Z',
        until: null,
        taken: false,
      },
    });
    expect(waiting).toContain('پذیرفته · در انتظار');
    expect(waiting).toContain('ردیف کار هنوز ساخته نشده است');
    expect(waiting).toContain('>باز</span>');
    expect(waiting).not.toMatch(/T-\d+/);
    // The computer wrote `planned` and has not made the row: accepted, waiting, no task id, no withdrawal.
    const planned = row(ACCEPTED_WAITING);
    expect(planned).toContain('پذیرفته · در انتظار');
    expect(planned).toContain('رایانه هنوز ردیف کار را نساخته است');
    expect(planned).not.toMatch(/T-\d+/);
    expect(buttons(planned)).toEqual([]);
  });

  it('cannot be withdrawn once the computer has taken it, and names no time it cannot promise', () => {
    const taken = row(PENDING_TAKEN);
    expect(taken).toContain('رایانه دستور را برداشته و در حال انجام آن است');
    expect(taken).toContain('دیگر نمی‌شود از این دستور انصراف داد.');
    expect(buttons(taken)).toEqual([]);
    expect(taken).not.toContain('۱۵:۲۵');
    // The computer silent: the command waits until it is back, and no time is named.
    const silent = { ...FIXTURE_HEARTBEAT, loaded_at: '2026-11-20T05:58:00.000Z' };
    expect(nextSyncWords(silent, FIXTURE_NOW)).toBe('رایانه خاموش است؛ تا برگردد در صف می‌ماند.');
    expect(nextSyncWords({ loaded_at: null, queued: null }, FIXTURE_NOW)).not.toMatch(/[۰-۹]/);
    expect(nextSyncWords(null, FIXTURE_NOW)).toBe('در هم‌گام‌سازی بعدی انجام می‌شود.');
    // A sync overdue inside its grace: "the next sync", without a time.
    expect(nextSyncWords(FIXTURE_HEARTBEAT, new Date('2026-11-22T12:10:00.000Z'))).toBe(
      'در هم‌گام‌سازی بعدی انجام می‌شود.',
    );
  });

  it('shows a snooze that waits with its day', () => {
    const html = row(NEEDS, OWNER, {
      pending: {
        command_id: 'c-2',
        kind: 'finding.snooze',
        requested_by: 'کاوه',
        requested_at: '2026-11-22T07:00:00.000Z',
        until: '2026-11-29',
        taken: false,
      },
    });
    expect(html).toContain('تعویق · در انتظار');
    expect(html).toContain('تا ۸ آذر');
    expect(html).not.toContain('به تعویق افتاده');
  });
});

describe('a finding someone has decided', () => {
  it('shows a task id only once the snapshot carries it, and says what accepted means', () => {
    const html = row(ACCEPTED_TASK);
    expect(html).toContain('پذیرفته · ردیف کار');
    expect(html).toContain('<bdi dir="ltr" class="font-mono">T-1952</bdi>');
    expect(html).toContain('پذیرفته یعنی ردیف کار ساخته شده است، نه اینکه کار شروع شده باشد.');
    expect(row(ACCEPTED_TASK, MATE)).toBe(html);
    // The same finding before the snapshot has the id.
    expect(row(ACCEPTED_TASK, OWNER, { task: null })).not.toContain('T-1952');
    // A security finding's task is private: no id, and the marker itself is not drawn.
    const secret = row(SECURITY_PLANNED);
    expect(secret).toContain('کار به‌صورت خصوصی پیش‌نویس شد');
    expect(secret).not.toContain('handoffs');
    expect(secret).not.toMatch(/T-\d+/);
  });

  it("shows a reject's reason, and says plainly that reopening is not on the console", () => {
    const html = row(REJECTED);
    expect(html).toContain('صفحه‌ی بازیکنان بازنشسته فعلاً در نقشه‌ی سایت نیست');
    expect(html).toContain('بازگشایی از کنسول هنوز ممکن نیست');
    expect(buttons(html)).toEqual([]);
    expect(rejectReason(byId(REJECTED).detail)).toBe(
      'صفحه‌ی بازیکنان بازنشسته فعلاً در نقشه‌ی سایت نیست',
    );
    // Without the computer's line the page says the reason did not come, and invents none.
    expect(rejectReason('Only the evidence.')).toBeNull();
    expect(row(REJECTED, OWNER, { detail: 'Only the evidence.' })).toContain(
      'دلیل رد در این هم‌گام‌سازی نیامده است.',
    );
  });

  it('shows a snooze with its day and a way to decide now', () => {
    const html = row(SNOOZED);
    expect(html).toContain('به تعویق افتاده</span>');
    expect(html).toContain('تا ۸ آذر');
    expect(buttons(html)).toEqual(['همین حالا تصمیم بگیرم']);
  });

  it('reads the parts of the detail the computer wrote', () => {
    expect(findingParts(byId(NEEDS).detail)).toEqual({
      evidence:
        'At 375 px the standings table on the league page is 412 px wide, so the whole page scrolls sideways. Seen in Persian and in English, light and dark.',
      cause: 'The form column keeps five fixed-width badges and does not shrink below 640 px.',
      proposal:
        'Show the last three results below 640 px, or fold the form column into the row detail.',
      triage: '',
    });
    expect(findingParts(null)).toEqual({ evidence: '', cause: '', proposal: '', triage: '' });
    expect(findingParts('One.\n\nTwo.').evidence).toBe('One.\n\nTwo.');
  });
});

describe('a security finding', () => {
  it('gives an account that is not the owner the reason, and no button', () => {
    const html = row(SECURITY, MATE);
    expect(html).toContain(OWNER_ONLY_WORDS);
    expect(buttons(html)).toEqual([]);
    // The owner has the three buttons, by id.
    expect(buttons(row(SECURITY, OWNER))).toEqual(['قبول', 'رد…', 'به تعویق…']);
    // An API from before T-1908 does not say who the owner is: the buttons stay, and its refusal is worded.
    const unknown: ConsoleMe = { id: 'u3', username: 'x', display_name: 'ایکس' };
    expect(buttons(row(SECURITY, unknown))).toHaveLength(3);
  });

  it('never draws the title while the detail is withheld, whatever the snapshot carries', () => {
    for (const me of [OWNER, MATE]) {
      const html = row(SECURITY, me);
      expect(html).toContain(WITHHELD_TITLE);
      expect(html).not.toContain('must not draw');
    }
    // Released by the computer (its detail came): the title is its own again.
    expect(row(SECURITY, OWNER, { detail: 'Resolved.', status: 'fixed' })).toContain(
      'A title the console must not draw',
    );
  });
});

describe('a refused command', () => {
  it('is announced in a role="alert", and a taken one in a role="status"', () => {
    const view = triageView(byId(NEEDS), context());
    world.state = { error: 'این حساب نمی‌تواند.', done: null };
    const refused = renderToStaticMarkup(<FindingTriage view={view} />);
    expect(refused).toMatch(/<p role="alert"[^>]*>این حساب نمی‌تواند\.<\/p>/);
    expect(refused).toContain('tabindex="-1"');
    // The buttons stay: the person may try again.
    expect(buttons(refused)).toHaveLength(3);

    world.state = { error: null, done: 'قبول ثبت شد.' };
    const waiting = triageView(
      { ...byId(NEEDS), pending: byId(PENDING_REJECT).pending },
      context(),
    );
    const taken = renderToStaticMarkup(<FindingTriage view={waiting} />);
    expect(taken).toMatch(/<p role="status" aria-live="polite"[^>]*>قبول ثبت شد\.<\/p>/);
    expect(taken).not.toContain('role="alert"');
    // Once the snapshot has moved on, an old success line is not left beside the new state.
    const later = renderToStaticMarkup(
      <FindingTriage view={triageView(byId(ACCEPTED_TASK), context())} />,
    );
    expect(later).not.toContain('قبول ثبت شد.');
  });

  it('is worded in Persian for every refusal the API makes', () => {
    const persian = (message: string) => {
      const words = apiErrorWords(message, 'FALLBACK');
      expect(words, message).not.toBe('FALLBACK');
      expect(words, message).not.toMatch(/[A-Za-z]{2,}/);
      return words;
    };
    expect(persian("Only the console's owner may triage a security finding.")).toContain(
      'فقط با حساب مالک کنسول',
    );
    expect(persian('This finding already has a command waiting.')).toContain('در انتظار رایانه');
    expect(persian('This finding is closed (fixed).')).toContain('بسته است (رفع شده)');
    expect(persian('This finding is closed (rejected).')).toContain('رد شده');
    expect(persian('A finding is snoozed for 90 days at most: until 2027-02-20 or sooner.')).toBe(
      'یافته حداکثر ۹۰ روز به تعویق می‌افتد: تا ۱ اسفند یا زودتر.',
    );
    expect(
      persian('A critical finding is snoozed for 14 days at most: until 2026-12-06 or sooner.'),
    ).toBe('یافته‌ی بحرانی حداکثر ۱۴ روز به تعویق می‌افتد: تا ۱۵ آذر یا زودتر.');
    expect(persian('Say why it is rejected, in 3 characters or more.')).toContain('دست‌کم ۳ نویسه');
    expect(persian('Snooze until a day after today, YYYY-MM-DD.')).toContain('بعد از امروز');
    expect(persian('No such finding.')).toContain('آخرین هم‌گام‌سازی');
    expect(persian('No such command.')).toContain('دیگر در صف نیست');
    expect(persian('The computer has already taken this command.')).toContain('برداشته است');
    expect(persian('That is the most commands an hour allows. Try again in 9 minutes.')).toContain(
      'سقف دستورها',
    );
    // The computer's outcomes and the audit trail's new action.
    for (const outcome of [
      'Rejected, with the reason.',
      'Snoozed until 2026-11-29; it is open again from that day.',
      'Planned; task T-1952: https://example.test/pull/1',
      'Planned; it already has the task T-1952.',
      'Planned already; its task row is being made.',
      "Planned; its task is drafted privately on the maintainer's computer.",
      'Planned; no task was made: the push failed',
      'Withdrawn on the console.',
    ])
      expect(outcomeWords(outcome).replace(/T-\d+/, ''), outcome).not.toMatch(/[A-Za-z]{2,}/);
    expect(auditActionWords('command.finding_withdraw')).toEqual({
      words: 'انصراف از دستور یافته',
      known: true,
    });
  });

  it('comes back from the server action in Persian, and a taken one never says it is done', async () => {
    world.answer = {
      ok: false,
      status: 403,
      error: {
        error: 'forbidden',
        message: "Only the console's owner may triage a security finding.",
      },
      setCookie: null,
    };
    const refused = await triageFinding(
      { error: null, done: null },
      form({ kind: 'finding.accept', target: SECURITY }),
    );
    expect(refused.done).toBeNull();
    expect(refused.error).toContain('فقط با حساب مالک کنسول');
    world.answer = {
      ok: false,
      status: 409,
      error: { error: 'conflict', message: 'This finding already has a command waiting.' },
      setCookie: null,
    };
    expect(
      (
        await triageFinding(
          { error: null, done: null },
          form({ kind: 'finding.reject', target: NEEDS, reason: 'تکراری است' }),
        )
      ).error,
    ).toContain('در انتظار رایانه');
    // An answer the console does not know is still Persian.
    world.answer = { ok: false, status: 500, error: null, setCookie: null };
    expect(
      (
        await triageFinding(
          { error: null, done: null },
          form({ kind: 'finding.accept', target: NEEDS }),
        )
      ).error,
    ).toBe('تصمیم ثبت نشد.');

    world.calls = [];
    world.answer = { ok: true, status: 201, data: {}, setCookie: null };
    vi.useFakeTimers();
    vi.setSystemTime(FIXTURE_NOW);
    try {
      const snoozed = await triageFinding(
        { error: null, done: null },
        form({ kind: 'finding.snooze', target: NEEDS, until: '2026-11-25' }),
      );
      expect(snoozed).toEqual({
        error: null,
        done: 'تعویق ثبت شد. رایانه هنوز آن را انجام نداده است؛ هم‌گام‌سازی بعدی حدود ۱۵:۲۵ است.',
      });
    } finally {
      vi.useRealTimers();
    }
    const rejected = await triageFinding(
      { error: null, done: null },
      form({ kind: 'finding.reject', target: NEEDS, reason: 'تکراری است' }),
    );
    expect(rejected.done).toContain('رایانه هنوز آن را انجام نداده است');
    await triageFinding(
      { error: null, done: null },
      form({ kind: 'finding.accept', target: NEEDS }),
    );
    expect(world.calls.map((call) => [call.path, call.init.method, call.init.body])).toEqual([
      [
        'commands',
        'POST',
        {
          kind: 'finding.snooze',
          target: NEEDS,
          payload: { until: '2026-11-25' },
          reason: 'تعویق از صفحه‌ی یافته‌ها',
        },
      ],
      [
        'commands',
        'POST',
        { kind: 'finding.reject', target: NEEDS, payload: {}, reason: 'تکراری است' },
      ],
      [
        'commands',
        'POST',
        { kind: 'finding.accept', target: NEEDS, payload: {}, reason: 'قبول از صفحه‌ی یافته‌ها' },
      ],
    ]);

    // A withdrawal deletes the command by its id; anything else is not sent at all.
    world.calls = [];
    world.answer = { ok: true, status: 204, data: null, setCookie: null };
    const withdrawn = await triageFinding(
      { error: null, done: null },
      form({ kind: 'withdraw', command: '6f0c2a54-91d3-4c1e-8a57-2b7f0e4d9a10' }),
    );
    expect(withdrawn).toMatchObject({ error: null, id: 'withdrawn' });
    expect(world.calls).toEqual([
      { path: 'commands/6f0c2a54-91d3-4c1e-8a57-2b7f0e4d9a10', init: { method: 'DELETE' } },
    ]);
    world.calls = [];
    expect(
      (await triageFinding({ error: null, done: null }, form({ kind: 'agent.run', target: 'x' })))
        .error,
    ).toBe('کنسول این دستور را نمی‌شناسد.');
    expect(world.calls).toEqual([]);
  });
});

describe("a finding's own page", () => {
  const page = async (id: string) =>
    renderToStaticMarkup(
      <>
        {await (
          await import('./(app)/findings/[id]/page')
        ).default({
          params: Promise.resolve({ id }),
        })}
      </>,
    );

  it('has the evidence, the likely cause, the proposal, the history, the triage card and «شبیه‌ها»', async () => {
    const html = await page(NEEDS);
    expect(html).toMatch(/<h1[^>]*><bdi dir="auto">Standings table scrolls sideways/);
    for (const heading of ['شواهد', 'علت احتمالی', 'پیشنهاد', 'تاریخچه', 'تصمیم', 'شبیه‌ها'])
      expect(html, heading).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`));
    expect(html).toContain('The form column keeps five fixed-width badges');
    expect(html).toContain('نخستین بار دیده شد: ۳۰ آبان');
    expect(buttons(html)).toEqual(['قبول', 'رد…', 'به تعویق…']);
    // The triage is a bar fixed to the bottom of a phone's window, a card from 768 px, by logical edges.
    expect(html).toMatch(
      /<section aria-labelledby="triage-title" class="fixed start-0 end-0 bottom-0 [^"]*md:static[^"]*" data-triage-card="fixed"/,
    );
    // The page leaves the bar's real height under its content (the bar reports it), 18rem until it has.
    expect(html).toContain('pb-[var(--triage-bar,18rem)] md:pb-0');
    // The same subject: the one that names it in `related` first, then the one with the like title.
    const similar = html.slice(html.indexOf('شبیه‌ها'));
    expect([...similar.matchAll(/href="\/findings\/([^"]+)"/g)].map((m) => m[1])).toEqual([
      'qa-2026-11-08-04',
      'qa-2026-11-14-03',
    ]);
  });

  it('says what the snapshot does not carry instead of leaving a gap', async () => {
    const minor = await page('qa-2026-11-14-03');
    expect(minor).toContain('در این هم‌گام‌سازی نیامده است.');
    const history = await page(REJECTED);
    expect(history).toContain('آخرین وضعیت: رد شده');
    expect(history).toContain('هم‌گام‌سازی فقط آخرین وضعیت هر یافته را می‌آورد');
    // Nothing to decide: the card is a card, not a bar over the page.
    expect(history).toContain('data-triage-card="static"');
    const closed = await page('ops-2026-11-10-02');
    expect(closed).toContain('این یافته بسته است (رفع شده)');
    expect(buttons(closed)).toEqual([]);
    const missing = await page('qa-2020-01-01-01');
    expect(missing).toContain('این یافته پیدا نشد');
    expect(missing).toContain('href="/findings"');
  });

  it('keeps a withheld security finding to its id, for the owner and for the other account', async () => {
    world.me = MATE;
    const html = await page(SECURITY);
    expect(html).toContain(WITHHELD_TITLE);
    expect(html).not.toContain('must not draw');
    expect(html).toContain(OWNER_ONLY_WORDS);
    expect(buttons(html)).toEqual([]);
    expect(html).not.toMatch(/<h2[^>]*>شواهد<\/h2>/);
    world.me = OWNER;
    expect(buttons(await page(SECURITY))).toEqual(['قبول', 'رد…', 'به تعویق…']);
  });

  it('finds the same subject by a link either way or by a like title, and never by a withheld one', () => {
    const ids = (id: string) => similarFindings(byId(id), FINDINGS).map((f) => f.id);
    expect(ids(NEEDS)).toEqual(['qa-2026-11-08-04', 'qa-2026-11-14-03']);
    expect(ids('qa-2026-11-08-04')).toEqual([NEEDS]);
    expect(ids(SECURITY)).toEqual([]);
    expect(ids(SNOOZED)).toEqual([]);
  });
});

describe('the markup rules', () => {
  const SOURCES = [
    'finding-triage.tsx',
    'findings.tsx',
    'triage.ts',
    '(app)/findings/page.tsx',
    '(app)/findings/[id]/page.tsx',
  ].map((file) => [file, readFileSync(join(__dirname, file), 'utf8')] as const);

  it('uses logical properties only (rule 7)', () => {
    const physical =
      /(?<![\w-])(?:[mp][lr]-|(?:left|right)-|text-(?:left|right)|float-(?:left|right)|rounded-[lr]-|border-[lr](?:-|\b)|inset-x-)/;
    for (const [file, source] of SOURCES) expect(source, file).not.toMatch(physical);
  });

  it('gives every button and control a 36 to 44 px target', () => {
    for (const [file, source] of SOURCES)
      for (const tag of source.matchAll(/<(?:button|select)\s[\s\S]*?>/g)) {
        const sized =
          /className=\{(?:PRIMARY|SECONDARY|QUIET|`\$\{(?:QUIET|FIELD)\}[^`]*`)\}/.test(tag[0]) ||
          /min-h-(?:touch|9)/.test(tag[0]);
        expect(sized, `${file}: ${tag[0]}`).toBe(true);
      }
    const client = SOURCES[0]![1];
    expect(client).toMatch(/const BUTTON =\s*'[^']*min-h-touch/);
    expect(client).toMatch(/const QUIET =\s*'[^']*min-h-9/);
    expect(client).toContain('className={`${FIELD} min-h-touch`}');
  });
});
