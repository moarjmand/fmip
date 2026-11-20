import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsoleFinding, ConsoleHeartbeat, ConsoleMessage } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  consoleHref,
  consolePathOf,
  consoleRoute,
  hostName,
  isConsoleHost,
} from '@/lib/console-host';
import { ChatThread, MESSAGE_STATUS_WORDS } from './chat';
import {
  ConsoleNav,
  INPUT_EVENTS,
  LAYOUT_MAX_AGE_MS,
  consolePathname,
  isCurrent,
  layoutRefresher,
  shouldRefresh,
} from './console-nav';
import { LiveHeartbeat, LiveSyncSentence, agedClock } from './heartbeat-clock';
import { FindingRow, PcHeartbeat, RunsBars, freshness, syncSentence } from './ui';
import { queuedWords } from './words';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => undefined }),
}));
const { parseConsoleSetCookie } = await import('@/lib/console-api');

/**
 * The agents console's web side (T-1698, D-340): served on its own host
 * only, its cookie read back from the API's, and an open security finding
 * shown without its detail.
 */

const HOST = 'agents.traveltohormuz.ir';

describe('the console host', () => {
  it('compares host names without port or case', () => {
    expect(hostName('Agents.TravelToHormuz.ir:443')).toBe(HOST);
    expect(hostName('[::1]:3000')).toBe('[::1]');
    expect(isConsoleHost('agents.traveltohormuz.ir', HOST)).toBe(true);
    expect(isConsoleHost('traveltohormuz.ir', HOST)).toBe(false);
    expect(isConsoleHost(HOST, undefined)).toBe(false);
    expect(isConsoleHost(HOST, '')).toBe(false);
  });

  it('serves every path of its host from the console, and hides the console everywhere else', () => {
    expect(consoleRoute(HOST, '/', HOST)).toEqual({
      kind: 'console',
      pathname: '/console',
      base: '',
    });
    expect(consoleRoute(HOST, '/agents/data-auditor', HOST)).toEqual({
      kind: 'console',
      pathname: '/console/agents/data-auditor',
      base: '',
    });
    expect(consoleRoute(HOST, '/console/board', HOST)).toEqual({
      kind: 'console',
      pathname: '/console/board',
      base: '',
    });
    expect(consoleRoute('traveltohormuz.ir', '/console', HOST)).toEqual({ kind: 'hidden' });
    expect(consoleRoute('traveltohormuz.ir', '/console/login', HOST)).toEqual({ kind: 'hidden' });
    expect(consoleRoute('traveltohormuz.ir', '/en/scores', HOST)).toEqual({ kind: 'site' });
    expect(consoleRoute('traveltohormuz.ir', '/consoles', HOST)).toEqual({ kind: 'site' });
    expect(consoleRoute('traveltohormuz.ir', '/console', undefined)).toEqual({ kind: 'hidden' });
  });

  it('serves the console under CONSOLE_PATH on the site host, with its base (D-341)', () => {
    const SITE = 'traveltohormuz.ir';
    expect(consoleRoute(SITE, '/agents', HOST, '/agents')).toEqual({
      kind: 'console',
      pathname: '/console',
      base: '/agents',
    });
    expect(consoleRoute(SITE, '/agents/', HOST, '/agents')).toMatchObject({ pathname: '/console' });
    expect(consoleRoute(SITE, '/agents/agents/security', HOST, '/agents')).toEqual({
      kind: 'console',
      pathname: '/console/agents/security',
      base: '/agents',
    });
    expect(consoleRoute(SITE, '/agentsx', HOST, '/agents')).toEqual({ kind: 'site' });
    expect(consoleRoute(SITE, '/agents', HOST, '')).toEqual({ kind: 'site' });
    expect(consoleRoute(SITE, '/console/login', HOST, '/agents')).toEqual({ kind: 'hidden' });
    // The console's own host keeps an empty base.
    expect(consoleRoute(HOST, '/agents/security', HOST, '/agents')).toMatchObject({ base: '' });
    expect(consolePathOf('/agents/')).toBe('/agents');
    expect(consolePathOf('agents')).toBe('');
    expect(consolePathOf('/console')).toBe('');
    expect(consolePathOf('/a/b')).toBe('');
    expect(consoleHref('', '/board')).toBe('/board');
    expect(consoleHref('/agents', '/')).toBe('/agents');
    expect(consoleHref('/agents', '/findings?status=open')).toBe('/agents/findings?status=open');
  });
});

describe('the console cookie', () => {
  it("reads the API's Set-Cookie, and a sign-out", () => {
    expect(
      parseConsoleSetCookie(
        'fmip_console=abc%2Dd; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200',
      ),
    ).toEqual({
      value: 'abc-d',
      maxAge: 43200,
    });
    expect(parseConsoleSetCookie('fmip_console=; Path=/; Max-Age=0')).toEqual({
      value: '',
      maxAge: 0,
    });
    expect(parseConsoleSetCookie('fmip_session=abc; Max-Age=10')).toBeNull();
    expect(parseConsoleSetCookie(null)).toBeNull();
  });
});

describe('the console pieces', () => {
  const finding = (overrides: Partial<ConsoleFinding>): ConsoleFinding => ({
    id: 'sec-1',
    agent: 'security',
    severity: 'major',
    status: 'open',
    title: 'A header is missing',
    opened_at: '2026-11-01',
    detail: null,
    related: null,
    ...overrides,
  });

  it('shows an open security finding by its title, and says its detail stays on the computer', () => {
    const html = renderToStaticMarkup(<FindingRow finding={finding({})} />);
    expect(html).toContain('A header is missing');
    expect(html).toContain('مهم');
    expect(html).toContain('فقط روی رایانه‌ی شماست');
    expect(html).not.toContain('<details');
    const other = renderToStaticMarkup(
      <FindingRow finding={finding({ agent: 'data-auditor', detail: 'the evidence' })} />,
    );
    expect(other).toContain('the evidence');
  });

  it('draws a bar a run, or says there is none', () => {
    expect(renderToStaticMarkup(<RunsBars runs={[]} />)).toContain('هنوز اجرایی');
    const html = renderToStaticMarkup(
      <RunsBars
        runs={[
          { at: '2026-11-01T08:00:00.000Z', status: 'ok', findings: 3, duration_seconds: null },
        ]}
      />,
    );
    expect(html).toContain('۳');
    // T-1906: many runs scroll inside a box a keyboard can reach, and it has a name.
    const box = /^<div [^>]*>/.exec(html)?.[0] ?? '';
    expect(box).toContain('overflow-x-auto');
    expect(box).toContain('tabindex="0"');
    expect(box).toContain('role="group"');
    expect(box).toMatch(/aria-label="[^"]*نمودار اجراها[^"]*"/);
  });

  it('draws a conversation: who wrote what, where a message is, and why one failed (T-1722)', () => {
    const base: ConsoleMessage = {
      id: 'm1',
      agent: 'data-auditor',
      author_kind: 'person',
      author: 'Mostafa',
      body: 'What did you find?\nToday.',
      created_at: '2026-11-02T08:00:00.000Z',
      status: 'answered',
      reply_to: null,
      failure: null,
    };
    const html = renderToStaticMarkup(
      <ChatThread
        messages={[
          base,
          {
            ...base,
            id: 'r1',
            author_kind: 'agent',
            author: 'data-auditor',
            body: 'Three minor findings.',
            status: null,
            reply_to: 'm1',
          },
          { ...base, id: 'm2', body: '<b>not markup</b>', status: 'queued' },
          { ...base, id: 'm3', status: 'answering' },
          { ...base, id: 'm4', status: 'failed', failure: 'The run timed out.' },
        ]}
      />,
    );
    expect(html).toContain('data-author="agent"');
    // The agent signs with its Persian title (T-1725).
    expect(html).toContain('بازرس داده');
    expect(html).toContain('Three minor findings.');
    expect(html).toContain('What did you find?\nToday.');
    expect(html).toContain('&lt;b&gt;not markup&lt;/b&gt;');
    expect(html).toContain(MESSAGE_STATUS_WORDS.queued);
    expect(MESSAGE_STATUS_WORDS.queued).toContain('هر وقت نگهدارنده');
    expect(html).toContain(MESSAGE_STATUS_WORDS.answering);
    expect(html).toContain(MESSAGE_STATUS_WORDS.failed);
    expect(html).toContain('The run timed out.');
    // An answered message shows its reply, not a badge.
    expect(html).not.toContain(MESSAGE_STATUS_WORDS.answered);
    // Logical sides only (rule 7).
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
    expect(renderToStaticMarkup(<ChatThread messages={[]} />)).toContain('هنوز پیامی نیامده');
  });

  it("words the commands' limits and a refused push address in Persian (T-1880)", async () => {
    const { apiErrorWords, auditActionWords, auditReasonWords } = await import('./words');
    const persian = (message: string) => {
      const words = apiErrorWords(message, 'FALLBACK');
      expect(words, message).not.toBe('FALLBACK');
      expect(words, message).not.toMatch(/[A-Za-z]{2,}/);
      return words;
    };
    expect(persian('That is the most commands an hour allows. Try again in 12 minutes.')).toContain(
      'سقف دستورها',
    );
    expect(
      persian('That is the most immediate runs an hour allows. Try again in 1 minute.'),
    ).toContain('اجراهای فوری');
    expect(persian('This agent already has a run waiting.')).toContain('در صف');
    expect(persian('A command carries up to 8 values of 500 characters.')).toContain('۵۰۰');
    expect(persian("endpoint is the https:// address of a browser's push service.")).toContain(
      'سرویس‌های اعلان',
    );
    expect(
      persian('That is the most test messages an hour allows. Try again in 3 minutes.'),
    ).toContain('پیام‌های آزمایشی');
    expect(auditActionWords('calendar.push_test')).toEqual({
      words: 'پیام آزمایشی یادآور',
      known: true,
    });
    expect(auditReasonWords('test message asked')).toBe('پیام آزمایشی خواسته شد');
  });
});

/**
 * T-1906 (D-456): the computer's heartbeat. Tehran is UTC+03:30, so the
 * sync's 09:25, 15:25 and 21:25 are 05:55, 11:55 and 17:55 UTC; the snapshot
 * of the mock-ups arrived on 28 Aban at 01:54 (2026-11-18T22:24Z).
 */
describe("the computer's heartbeat (T-1906)", () => {
  const LOADED = '2026-11-18T22:24:00Z';
  const at = (iso: string) => new Date(iso);
  const bar = (heartbeat: ConsoleHeartbeat | null, now: string, compact = false) =>
    renderToStaticMarkup(<PcHeartbeat heartbeat={heartbeat} now={at(now)} compact={compact} />);
  const queued = { commands: 2, messages: 1 };

  it('words the four states at fixed clocks (rule 4)', () => {
    // Synced today at 09:28, read at 11:30.
    expect(freshness('2026-11-19T05:58:00Z', at('2026-11-19T08:00:00Z'))).toEqual({
      state: 'fresh',
      word: 'هم‌گام',
      title: 'آخرین هم‌گام‌سازی:',
      since: '۲ ساعت پیش (امروز ۰۹:۲۸)',
      detail: 'هم‌گام‌سازی بعدی حدود ۱۵:۲۵. دستورها و پیام‌های تازه تا آن‌وقت در صف می‌مانند.',
      next: '۱۵:۲۵',
    });
    // The mock-up's snapshot, read at 10:26: 09:25 was missed by more than an hour.
    expect(freshness(LOADED, at('2026-11-19T06:56:00Z'))).toEqual({
      state: 'late',
      word: 'دیر شده',
      title: 'هم‌گام‌سازی دیر شده؛',
      since: 'آخرین: ۸ ساعت پیش (۲۸ آبان ۰۱:۵۴)',
      detail: 'هم‌گام‌سازی نوبت ۰۹:۲۵ نرسیده است. آنچه می‌بینید از آخرین هم‌گام‌سازی در ۰۱:۵۴ است.',
      next: '۱۵:۲۵',
    });
    // Thirty hours on: the computer is taken to be off.
    expect(freshness(LOADED, at('2026-11-20T04:24:00Z'))).toEqual({
      state: 'silent',
      word: 'خاموش',
      title: 'رایانه خاموش است؛ دستورها در صف می‌مانند.',
      since: '',
      detail:
        'آخرین هم‌گام‌سازی: ۲۸ آبان ۰۱:۵۴، ۳۰ ساعت پیش. در این مدت هیچ عاملی اجرا نشده و یافته‌ها و گزارش‌ها همان زمان‌اند.',
      next: '۰۹:۲۵',
    });
    expect(freshness(null, at('2026-11-19T08:00:00Z'))).toEqual({
      state: 'never',
      word: 'بی‌داده',
      title: 'هنوز هیچ هم‌گام‌سازی از رایانه نرسیده است',
      since: '',
      detail:
        'یافته‌ها، گزارش‌ها و وضعیت عامل‌ها خالی‌اند چون از رایانه نیامده‌اند، نه چون چیزی نیست.',
      next: '۱۵:۲۵',
    });
  });

  it('holds the two limits to the minute: 60 past a slot, 26 hours', () => {
    const synced = '2026-11-19T05:58:00Z';
    expect(freshness(synced, at('2026-11-19T12:55:00Z')).state).toBe('fresh');
    expect(freshness(synced, at('2026-11-19T12:56:00Z')).state).toBe('late');
    expect(freshness(synced, at('2026-11-20T07:58:00Z')).state).toBe('late');
    expect(freshness(synced, at('2026-11-20T07:59:00Z')).state).toBe('silent');
  });

  it('a late sync says only what is known: it did not arrive, and what is shown is older', () => {
    const late = freshness(LOADED, at('2026-11-19T06:56:00Z'));
    // Whether the agents ran on the computer meanwhile is not known here.
    expect(late.detail).not.toMatch(/اجرا نمی‌شوند|اجرا نشده|خاموش/);
    expect(late.title).not.toContain('خاموش');
    // Two minutes before its slot (the computer's clock runs ahead) is that slot's sync.
    expect(freshness('2026-11-19T05:53:00Z', at('2026-11-19T06:56:00Z')).state).toBe('fresh');
  });

  it('never calls a slot "next" that has already passed, and dates a sync that is not of today', () => {
    // 10:15 on the mock-up's clock: 09:25 has passed, inside its hour of grace.
    const due = freshness(LOADED, at('2026-11-19T06:45:00Z'));
    expect(due.state).toBe('fresh');
    expect(due.detail).toBe(
      'هم‌گام‌سازی نوبت ۰۹:۲۵ هنوز نرسیده است. دستورها و پیام‌های تازه تا رسیدنش در صف می‌مانند.',
    );
    // Synced last night at 21:31, read at 08:00: yesterday's, so the day is named.
    const overnight = freshness('2026-11-18T18:01:00Z', at('2026-11-19T04:30:00Z'));
    expect(overnight.since).toBe('۱۰ ساعت پیش (۲۷ آبان ۲۱:۳۱)');
    expect(overnight.detail).toContain('حدود ۰۹:۲۵');
    // Late on a sync of the day before: "what you see is from" carries the day too.
    expect(freshness('2026-11-18T12:00:00Z', at('2026-11-19T07:00:00Z')).detail).toContain(
      'آنچه می‌بینید از آخرین هم‌گام‌سازی در ۲۷ آبان ۱۵:۳۰ است',
    );
    expect(freshness('2026-11-19T07:59:40Z', at('2026-11-19T08:00:00Z')).since).toContain(
      'کمتر از یک دقیقه پیش',
    );
    expect(freshness('2026-11-19T07:35:00Z', at('2026-11-19T08:00:00Z')).since).toContain(
      '۲۵ دقیقه پیش',
    );
    expect(freshness(LOADED, at('2026-11-22T08:00:00Z')).detail).toContain('۳ روز پیش');
  });

  it('draws a bar with a word and a shape for each state, never colour alone', () => {
    const shapes: Record<string, string> = {
      fresh: 'M4 12l5 5L20 6',
      late: 'M12 3l10 18H2z',
      silent: 'M12 3v9',
      never: 'M12 3v9',
    };
    const cases: [string, string | null, string, string][] = [
      ['fresh', '2026-11-19T05:58:00Z', '2026-11-19T08:00:00Z', 'هم‌گام'],
      ['late', LOADED, '2026-11-19T06:56:00Z', 'دیر شده'],
      ['silent', LOADED, '2026-11-20T04:24:00Z', 'خاموش'],
      ['never', null, '2026-11-19T08:00:00Z', 'بی‌داده'],
    ];
    for (const [state, loaded, now, word] of cases) {
      const html = bar({ loaded_at: loaded, queued }, now);
      const box = /^<div [^>]*>/.exec(html)?.[0] ?? '';
      expect(box, state).toContain(`data-state="${state}"`);
      expect(html, state).not.toContain('role="alert"');
      expect(html, state).toContain(`>${word}</span>`);
      expect(html, state).toContain(shapes[state]);
      expect(html, state).toContain('aria-hidden="true"');
      expect(html, state).toContain('مدل، تقویم و یادآورها بدون رایانه کار می‌کنند');
      // Logical properties only (rule 7), nothing animated, no inline style.
      expect(html, state).not.toMatch(/\b(ml|mr|pl|pr|left|right|border-l|border-r)-/);
      expect(html, state).not.toMatch(/animate-|transition|style=/);
    }
  });

  it('announces the state and nothing that ages: one live region, around the word and the state sentence', () => {
    const cases: [string | null, string][] = [
      ['2026-11-19T05:58:00Z', '2026-11-19T08:00:00Z'],
      [LOADED, '2026-11-19T06:56:00Z'],
      [LOADED, '2026-11-20T04:24:00Z'],
      [null, '2026-11-19T08:00:00Z'],
    ];
    for (const [loaded, now] of cases) {
      const fresh = freshness(loaded, at(now));
      const html = bar({ loaded_at: loaded, queued }, now);
      // The box itself is no live region: its sentences change with the clock.
      expect(/^<div [^>]*>/.exec(html)?.[0], fresh.state).not.toContain('role=');
      expect(html.split('role="status"'), fresh.state).toHaveLength(2);
      const region = html.slice(html.indexOf('<span role="status">'));
      // The region closes right after the state sentence; "… ago" follows it, outside.
      const tail = fresh.since === '' ? '</span></p>' : `</span> ${fresh.since}</p>`;
      expect(region.indexOf(`${fresh.title}${tail}`), fresh.state).toBeGreaterThan(0);
      expect(region.slice(0, region.indexOf(fresh.title)), fresh.state).toContain(fresh.word);
    }
    // An hour later in the same state the announced words are the same; only the age moved.
    const first = freshness('2026-11-19T05:58:00Z', at('2026-11-19T08:00:00Z'));
    const later = freshness('2026-11-19T05:58:00Z', at('2026-11-19T09:00:00Z'));
    expect(later.title).toBe(first.title);
    expect(later.since).not.toBe(first.since);
    expect(freshness(LOADED, at('2026-11-19T08:56:00Z')).title).toBe(
      freshness(LOADED, at('2026-11-19T06:56:00Z')).title,
    );
  });

  it("shows the queue's counts, and drops the chips, not the sentences, when they cannot be read", () => {
    const now = '2026-11-20T04:24:00Z';
    const counted = bar({ loaded_at: LOADED, queued }, now);
    expect(counted).toContain('۲ دستور در صف');
    expect(counted).toContain('۱ پیام در صف');
    expect(bar({ loaded_at: LOADED, queued: { commands: 0, messages: 0 } }, now)).toContain(
      '۰ دستور در صف',
    );
    const uncounted = bar({ loaded_at: LOADED, queued: null }, now);
    expect(uncounted).not.toContain('در صف</li>');
    expect(uncounted).toContain('رایانه خاموش است؛ دستورها در صف می‌مانند.');
    expect(uncounted).toContain('مدل، تقویم و یادآورها بدون رایانه کار می‌کنند');
    // Never synced: no queue to speak of, as drawn.
    expect(bar({ loaded_at: null, queued }, now)).not.toContain('در صف</li>');
  });

  it('says so when the heartbeat itself could not be read, and claims neither "off" nor "never"', () => {
    const html = bar(null, '2026-11-19T08:00:00Z');
    expect(html).toContain('data-state="unread"');
    expect(html).toContain('وضعیت رایانه خوانده نشد');
    expect(html).toContain('نامعلوم');
    expect(html).not.toContain('رایانه خاموش است؛');
    expect(html).not.toContain('هنوز هیچ هم‌گام‌سازی');
    expect(html).not.toContain('در صف</li>');
  });

  it("states the sync's times from the one list, on a desktop and behind a disclosure on a phone", () => {
    const html = bar({ loaded_at: LOADED, queued }, '2026-11-19T06:56:00Z');
    const schedule =
      'برنامه‌ی هم‌گام‌سازی (وقت تهران): <b class="font-bold">۰۹:۲۵ · ۱۵:۲۵ · ۲۱:۲۵</b> و اجرای روزانه‌ی تیم ۰۹:۰۹. «دیر شده» یعنی یک ساعت از نوبت گذشته؛ «خاموش» یعنی بیش از ۲۶ ساعت.';
    expect(html).toContain(
      `<p class="mt-1.5 hidden text-xs text-caption md:block">${schedule}</p>`,
    );
    const details = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    expect(details).toContain('md:hidden');
    expect(details).toMatch(/<summary [^>]*min-h-6[^>]*>برنامه‌ی هم‌گام‌سازی<\/summary>/);
    expect(details).toContain(schedule);
    // The page writes no time of its own: the bar and the sentences are the only source.
    for (const file of ['(app)/layout.tsx', '(app)/page.tsx', '(app)/agents/[name]/page.tsx']) {
      expect(readFileSync(join(__dirname, file), 'utf8'), file).not.toMatch(
        /[0-9۰-۹]{1,2}:[0-9۰-۹]{2}/,
      );
    }
  });

  it("is one line above an agent's controls, with the corrected sentence", () => {
    const html = bar({ loaded_at: LOADED, queued }, '2026-11-19T06:56:00Z', true);
    expect(html).toContain('data-testid="pc-heartbeat-compact"');
    expect(html).toContain('data-state="late"');
    expect(html).toContain('هم‌گام‌سازی دیر شده؛</span> آخرین: ۸ ساعت پیش (۲۸ آبان ۰۱:۵۴)');
    // The page's own bar is the status; this one repeats it beside the buttons.
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('در صف');
    expect(html).not.toContain('<details');

    expect(syncSentence(freshness('2026-11-19T05:58:00Z', at('2026-11-19T08:00:00Z')))).toBe(
      'هر دستور در صف می‌ماند تا رایانه آن را بردارد. هم‌گام‌سازی روزی سه بار است (۰۹:۲۵، ۱۵:۲۵، ۲۱:۲۵؛ وقت تهران)؛ بعدی حدود ۱۵:۲۵.',
    );
    // With the computer silent, or never seen, no next time is named.
    for (const loaded of [LOADED, null]) {
      const sentence = syncSentence(freshness(loaded, at('2026-11-20T04:24:00Z')));
      expect(sentence).toContain('روزی سه بار است (۰۹:۲۵، ۱۵:۲۵، ۲۱:۲۵؛ وقت تهران).');
      expect(sentence).not.toContain('بعدی');
    }
  });

  it("names the next slot in a queued command's success line only when one can be promised", () => {
    const beat = (loaded_at: string | null): ConsoleHeartbeat => ({ loaded_at, queued });
    // Syncing: the schedule's next slot.
    expect(queuedWords(beat('2026-11-19T05:58:00Z'), at('2026-11-19T08:00:00Z'))).toBe(
      'ثبت شد. رایانه در هم‌گام‌سازی بعدی (حدود ۱۵:۲۵) آن را انجام می‌دهد.',
    );
    expect(queuedWords(beat('2026-11-19T17:58:00Z'), at('2026-11-19T18:30:00Z'))).toContain(
      '(حدود ۰۹:۲۵)',
    );
    // Late: the computer may be back by the next slot, which is named as the schedule's.
    expect(queuedWords(beat(LOADED), at('2026-11-19T06:56:00Z'))).toContain('(حدود ۱۵:۲۵)');
    // Silent or never seen: the command waits, and no time is promised (design spec, section 6).
    for (const loaded of [LOADED, null]) {
      const words = queuedWords(beat(loaded), at('2026-11-20T04:24:00Z'));
      expect(words).toBe('ثبت شد. دستور در صف می‌ماند تا رایانه برگردد.');
      expect(words).not.toMatch(/[۰-۹]{2}:[۰-۹]{2}/);
    }
    // A sync overdue inside its grace, or the heartbeat unread: "the next sync", without a time.
    for (const words of [
      queuedWords(beat(LOADED), at('2026-11-19T06:45:00Z')),
      queuedWords(null, at('2026-11-19T08:00:00Z')),
    ]) {
      expect(words).toBe('ثبت شد. رایانه در هم‌گام‌سازی بعدی آن را انجام می‌دهد.');
    }
  });

  it('finds no "hourly sync" wording and one spelling of «هم‌گام‌سازی» in the console\'s strings', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    walk(__dirname);
    const lib = join(__dirname, '..', '..', 'lib');
    for (const name of readdirSync(lib))
      if (/^console-.*\.ts$/.test(name)) files.push(join(lib, name));
    expect(files.length).toBeGreaterThan(40);
    const HOURLY =
      /هم‌?گام‌سازی\s+ساعتی|ساعتی\s+هم‌?گام|هر\s+ساعت\s+هم‌?گام|hourly\s+sync|اجرای روزانه‌ی ۸ صبح/i;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(HOURLY);
      // «هم‌گام» with its half-space, never joined.
      expect(text, file).not.toContain('همگام');
    }
  });

  it("ages on the browser from the server's instant, with no request (rule 4 without keeping the session)", () => {
    // Only elapsed time is read from the browser: a clock set a day wrong changes nothing.
    const rendered = at('2026-11-19T08:00:00Z').getTime();
    const wrong = at('2026-11-18T03:00:00Z').getTime();
    expect(agedClock(rendered, wrong, wrong)).toBe(rendered);
    expect(agedClock(rendered, wrong, wrong + 90_000)).toBe(rendered + 90_000);
    expect(agedClock(rendered, wrong, wrong - 5_000)).toBe(rendered);

    // The server's HTML is the bar at the server's instant, so hydration changes nothing.
    const beat: ConsoleHeartbeat = { loaded_at: '2026-11-19T05:58:00Z', queued };
    expect(renderToStaticMarkup(<LiveHeartbeat heartbeat={beat} renderedAt={rendered} />)).toBe(
      bar(beat, '2026-11-19T08:00:00Z'),
    );
    expect(
      renderToStaticMarkup(<LiveHeartbeat heartbeat={beat} renderedAt={rendered} compact />),
    ).toBe(bar(beat, '2026-11-19T08:00:00Z', true));
    expect(renderToStaticMarkup(<LiveSyncSentence heartbeat={beat} renderedAt={rendered} />)).toBe(
      syncSentence(freshness(beat.loaded_at, at('2026-11-19T08:00:00Z'))),
    );
    expect(renderToStaticMarkup(<LiveSyncSentence heartbeat={null} renderedAt={rendered} />)).toBe(
      'هر دستور در صف می‌ماند تا رایانه آن را بردارد.',
    );

    // Left open and untouched, the same bar becomes late, then silent, by the clock alone.
    const after = (hours: number) =>
      freshness(beat.loaded_at, new Date(agedClock(rendered, wrong, wrong + hours * 3_600_000)));
    expect(after(0).state).toBe('fresh');
    expect(after(5).state).toBe('late');
    expect(after(25).state).toBe('silent');
    // The clock file asks the server for nothing.
    const source = readFileSync(join(__dirname, 'heartbeat-clock.tsx'), 'utf8');
    expect(source).not.toMatch(/fetch\(|useRouter|router\.|console-api|console-actions/);
  });
});

/**
 * T-1906, review of PR #957: asking for the layout again restarts the
 * session's 12-hour idle clock, so it happens only after the person has
 * touched the page. A console left open and untouched makes no request.
 */
describe('asking for the layout again (T-1906)', () => {
  const MINUTE = 60_000;
  function page(start = 1_000_000) {
    const state = { now: start, visible: true, online: true, asked: 0 };
    const refresher = layoutRefresher({
      refresh: () => {
        state.asked += 1;
      },
      now: () => state.now,
      visible: () => state.visible,
      online: () => state.online,
    });
    const pass = (ms: number) => {
      state.now += ms;
    };
    return { state, refresher, pass };
  }

  it('is ten minutes at most, and counts touching, typing, scrolling and coming to the window as input', () => {
    expect(LAYOUT_MAX_AGE_MS).toBe(10 * MINUTE);
    expect([...INPUT_EVENTS]).toEqual(['pointerdown', 'keydown', 'touchstart', 'scroll', 'focus']);
  });

  it('holds the rule: old, touched since it arrived, seen and online', () => {
    const fine = { visible: true, online: true };
    const old = 1_000 + LAYOUT_MAX_AGE_MS + 1;
    expect(shouldRefresh({ seenAt: 1_000, inputAt: 2_000 }, old, fine)).toBe(true);
    // Exactly at the limit is not old yet.
    expect(shouldRefresh({ seenAt: 1_000, inputAt: 2_000 }, old - 1, fine)).toBe(false);
    // Input before the render arrived is not input since.
    expect(shouldRefresh({ seenAt: 1_000, inputAt: 900 }, old, fine)).toBe(false);
    expect(shouldRefresh({ seenAt: 1_000, inputAt: 1_000 }, old, fine)).toBe(false);
    expect(shouldRefresh({ seenAt: 1_000, inputAt: 2_000 }, old, { ...fine, visible: false })).toBe(
      false,
    );
    expect(shouldRefresh({ seenAt: 1_000, inputAt: 2_000 }, old, { ...fine, online: false })).toBe(
      false,
    );
  });

  it('makes no request without input, however long the page stays open', () => {
    const { state, refresher, pass } = page();
    // A visible, online tab, ticking every minute for thirteen hours, and coming back from hidden.
    for (let minute = 0; minute < 13 * 60; minute += 1) {
      pass(MINUTE);
      refresher.tick();
    }
    state.visible = false;
    pass(MINUTE);
    refresher.tick();
    state.visible = true;
    refresher.tick();
    expect(state.asked).toBe(0);
  });

  it('asks once after input when the layout is old, and not again until the next input', () => {
    const { state, refresher, pass } = page();
    // Touched a minute in: too young to ask.
    pass(MINUTE);
    refresher.input();
    expect(state.asked).toBe(0);
    // Old at the next tick, and touched since it arrived: one ask.
    pass(10 * MINUTE);
    refresher.tick();
    expect(state.asked).toBe(1);
    // The new render arrives; with no further input, hours of ticks ask nothing.
    refresher.rendered();
    for (let minute = 0; minute < 180; minute += 1) {
      pass(MINUTE);
      refresher.tick();
    }
    expect(state.asked).toBe(1);
    // Touching an old page asks at once, once.
    refresher.input();
    refresher.input();
    refresher.tick();
    expect(state.asked).toBe(2);
  });

  it('asks once per age even when the ask fails, and not while hidden or offline', () => {
    const { state, refresher, pass } = page();
    pass(11 * MINUTE);
    state.online = false;
    refresher.input();
    state.online = true;
    state.visible = false;
    refresher.tick();
    expect(state.asked).toBe(0);
    // Seen again, with the earlier touch still newer than the render: one ask.
    state.visible = true;
    refresher.tick();
    expect(state.asked).toBe(1);
    // No new render came back (the ask failed): nothing more for this age without new input.
    pass(5 * MINUTE);
    refresher.tick();
    expect(state.asked).toBe(1);
    pass(6 * MINUTE);
    refresher.tick();
    expect(state.asked).toBe(1);
  });

  it('wires the menu to it: input listeners, and nothing asked at render', () => {
    const source = readFileSync(join(__dirname, 'console-nav.tsx'), 'utf8');
    // The only `router.refresh()` is the refresher's.
    expect(source.split('router.refresh()')).toHaveLength(2);
    expect(source).toContain(
      'for (const name of INPUT_EVENTS) window.addEventListener(name, made.input',
    );
    expect(source).not.toMatch(/setInterval\(\s*\(\)\s*=>\s*router/);
  });
});

describe('the console menu (T-1871)', () => {
  const ITEMS = [
    { path: '/', href: '/agents', label: 'نمای کلی' },
    { path: '/findings', href: '/agents/findings', label: 'یافته‌ها' },
    { path: '/requests', href: '/agents/requests', label: 'درخواست‌های هم‌تیمی', badge: '۳' },
    { path: '/audit', href: '/agents/audit', label: 'کارنامه‌ی کنسول' },
  ];
  const menu = (pathname: string, base = '/agents') => {
    nav.pathname = pathname;
    return renderToStaticMarkup(<ConsoleNav items={ITEMS} base={base} />);
  };
  const currentLinks = (html: string) =>
    [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>(.*?)<\/a>/g)].map((m) => m[1]);

  it('reads the console path under its base, under /console, or as it is', () => {
    expect(consolePathname('/agents', '/agents')).toBe('/');
    expect(consolePathname('/agents/findings', '/agents')).toBe('/findings');
    expect(consolePathname('/agents/agents/data-auditor', '/agents')).toBe('/agents/data-auditor');
    expect(consolePathname('/console/board', '/agents')).toBe('/board');
    expect(consolePathname('/console', '')).toBe('/');
    expect(consolePathname('/findings', '')).toBe('/findings');
    expect(consolePathname('/agentsx', '/agents')).toBe('/agentsx');
  });

  it('marks the overview only on itself, and a section with its sub-pages', () => {
    expect(isCurrent('/', '/')).toBe(true);
    expect(isCurrent('/', '/findings')).toBe(false);
    expect(isCurrent('/calendar', '/calendar/subscriptions')).toBe(true);
    expect(isCurrent('/calendar', '/calendarx')).toBe(false);
  });

  it('is a labelled list with the page shown marked, once', () => {
    const html = menu('/agents/findings');
    expect(html).toContain('<nav');
    expect(html).toContain('aria-label="منوی کنسول"');
    expect(currentLinks(html)).toHaveLength(1);
    expect(currentLinks(html)[0]).toContain('یافته‌ها');
    expect(currentLinks(menu('/agents'))[0]).toContain('نمای کلی');
    expect(currentLinks(menu('/console/audit', ''))[0]).toContain('کارنامه‌ی کنسول');
    expect(currentLinks(menu('/agents/agents/data-auditor'))).toEqual([]);
    for (const item of ITEMS) expect(html).toContain(`href="${item.href}"`);
    expect(html).toContain('۳<span class="sr-only"> درخواست باز</span>');
  });

  it('opens below 1024px as a <details>, with every link in the server HTML', () => {
    const html = menu('/agents/findings');
    // A disclosure the browser opens without JavaScript, closed at first.
    const details = /<details [^>]*>/.exec(html)?.[0] ?? '';
    expect(details).toContain('console-menu');
    expect(details).not.toMatch(/\sopen(=|\s|>)/);
    const summary = /<summary [^>]*>/.exec(html)?.[0] ?? '';
    expect(summary).toContain('min-h-touch');
    expect(summary).toContain('min-w-touch');
    expect(html).toMatch(/<summary [^>]*>.*فهرست<\/summary>/);
    expect(html).not.toContain('<button');
    // The links are inside the <details>, so they are there before any script runs.
    const inside = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    for (const item of ITEMS) expect(inside).toContain(`href="${item.href}"`);
  });

  it('is a column with its own scroll from 1024px, and a panel with its own scroll below', () => {
    const html = menu('/agents/findings');
    const navTag = /<nav [^>]*>/.exec(html)?.[0] ?? '';
    const list = /<ul [^>]*>/.exec(html)?.[0] ?? '';
    expect(navTag).toContain('lg:overflow-y-auto');
    expect(navTag).toContain('lg:flex-1');
    expect(navTag).toContain('lg:min-h-0');
    expect(list).toContain('max-h-[60dvh]');
    expect(list).toContain('overflow-y-auto');
    expect(list).toContain('lg:max-h-none');
    // From 1024px the <details> is no box and its summary is hidden.
    const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8');
    const rule = css.slice(css.indexOf('.console-menu,'));
    expect(rule).toMatch(
      /^\.console-menu,\s*\.console-menu::details-content \{\s*display: contents;/,
    );
    expect(rule).toContain('.console-menu > summary {\n      display: none;');
    expect(css.slice(0, css.indexOf('.console-menu,'))).toMatch(
      /@media \(width >= 64rem\) \{\s*@supports selector\(::details-content\) \{\s*$/,
    );
    // Logical sides only (rule 7).
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right|border-l|border-r)-/);
  });
});
