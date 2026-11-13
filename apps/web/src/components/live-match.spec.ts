import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FreshnessWords } from './freshness-stamp';
import { LiveAge, LiveBehind, LiveClockProvider } from './live-age';
import { message } from '@/i18n/messages';
import { both } from '@/lib/live-modules';
import { matchWords } from '@/lib/words-server';

const EN_KEY_EVENTS = message('en', 'matchCentre.keyEventsUpdated');

/**
 * The match page listens for the public discussion moving (T-254, D-068).
 *
 * Read from the source rather than rendered, like every component spec here.
 * Two things are asserted: that the page reacts to the stream's `panel` event
 * by asking the server to render it again, and that it renders nothing from
 * the event itself -- the same shape `LiveConversation` set, so there is one
 * way a post can look.
 */
const SOURCE = readFileSync(join(__dirname, 'live-match.tsx'), 'utf8');

describe('live match: the panel event', () => {
  it('listens for the panel event on the stream it already holds open', () => {
    expect(SOURCE).toMatch(/addEventListener\('panel'/);
  });

  it('asks the page to render itself again, collapsed, rather than rendering a post', () => {
    expect(SOURCE).toMatch(/router\.refresh\(\)/);
    // One refresh for a burst: a reply and the reaction it draws are two
    // events and one change to what the reader sees.
    expect(SOURCE).toMatch(/PANEL_REFRESH_MS/);
    // No post is parsed or pushed from the event; the panel is server-rendered.
    expect(SOURCE).not.toMatch(/panel_post|setPosts|posts\.push/);
  });

  it('counts the event as a sign of life without calling it a snapshot', () => {
    // A panel event proves the stream is alive, so the freshness line may say
    // so -- but it is not a picture of the match, and must not move the
    // snapshot time that "updated 20:31:07" is read from (rule 4).
    expect(SOURCE).toMatch(/addEventListener\('panel', \(\) => \{\s*stamp\(false\);/);
  });

  it('clears the pending refresh when the page goes away', () => {
    expect(SOURCE).toMatch(/if \(pageRefresh !== null\) clearTimeout\(pageRefresh\)/);
  });
});

describe('live match: the server modules in play (T-1811, D-409)', () => {
  const listener = SOURCE.slice(
    SOURCE.indexOf("addEventListener('snapshot'"),
    SOURCE.indexOf("addEventListener('heartbeat'"),
  );

  it('draws the page again once for a status change, and plans a call for anything else', () => {
    expect(listener).toMatch(
      /if \(before\.fixture\.status !== next\.fixture\.status\) refreshPage\(\);\s*else consider\(\);/,
    );
    // The panel event and the status change share one collapsed render.
    expect(SOURCE).toMatch(
      /addEventListener\('panel', \(\) => \{\s*stamp\(false\);\s*refreshPage\(\);/,
    );
  });

  it('asks only through the policy: the signature without the clock, the parts the page drew', () => {
    expect(SOURCE).toMatch(
      /const read = liveParts\(slotsRef\.current\);\s*if \(read\.length === 0\) return;/,
    );
    expect(SOURCE).toMatch(/liveChange\(asked \?\? drawn\.current, latest, read\)/);
    expect(SOURCE).toMatch(
      /planRefresh\(plan, change, \{ now: at, random: Math\.random\(\), lite \}\)/,
    );
    // One call at a time, the trailing one when it settles.
    expect(SOURCE).toMatch(/refreshDue\(plan, Date\.now\(\)\)/);
    expect(SOURCE).toMatch(/const next = refreshSettled\(plan\);[^]*if \(next\.call\) call\(\);/);
    // The function is the only way the modules are drawn again: no refresh of the page for it.
    expect(SOURCE.match(/router\.refresh\(\)/g)).toHaveLength(3);
  });

  it('asks only for the parts that changed, every part after a reopen (review m2)', () => {
    expect(SOURCE).toMatch(
      /const want = reopened \? read : changedParts\(drawn\.current, latest, read\);/,
    );
    // From the public address every reader of the match asks (D-422), not a server function.
    expect(SOURCE).toMatch(
      /fetch\(liveModulesPath\(id, \{ instance, locale, parts: want, timeZone \}\)\)/,
    );
    expect(SOURCE).not.toMatch(/live-modules-actions|'use server'/);
    expect(SOURCE).toMatch(/if \(want\.length === 0\) \{\s*settle\(\);\s*return;/);
  });

  it('marks as drawn only what the server drew, from the data it read (review B2)', () => {
    expect(SOURCE).toMatch(
      /drawn\.current = markDrawn\(drawn\.current, answer\.drawn, answer\.parts\);/,
    );
    // Never the signature it asked for.
    expect(SOURCE).not.toMatch(/drawn\.current = signature/);
    // An answer older than one already drawn is not drawn over it.
    expect(SOURCE).toMatch(/if \(answer\.readAt < drawnRead\.current\) return;/);
    // Still behind: ask again after the shared read, a few times at most.
    expect(SOURCE).toMatch(/if \(still\.length > 0 && followUps < MAX_FOLLOW_UPS\)/);
    expect(SOURCE).toMatch(/planFollowUp\(plan, \{ now: at, random: Math\.random\(\) \}\)/);
  });

  it('after a render of the page, its slots are drawn from `initial`, not the newest snapshot (review B2)', () => {
    expect(SOURCE).toMatch(
      /slotsRef\.current = slots;\s*drawn\.current = liveSignature\(initial\);/,
    );
    expect(SOURCE).toMatch(/considerRef\.current\?\.\(\);\s*\}, \[slots, initial\]\);/);
  });

  it('keeps what it has when a call fails or answers nothing, and never unmounts the view', () => {
    expect(SOURCE).toMatch(/if \(stopped \|\| reply === null\) return;/);
    // A failed request or a status other than 200 or 409 is no answer; the view stays.
    expect(SOURCE).toMatch(
      /response\.ok \|\| response\.status === 409\s*\? \(response\.json\(\) as Promise<LiveAnswer \| LiveReload>\)\s*: null/,
    );
    // A 409 from the address: this page's server process is gone, one render (R2-B1).
    expect(SOURCE).toMatch(
      /if \('reload' in reply\) \{\s*if \(mayRefreshForSkew\(Date\.now\(\)\)\) router\.refresh\(\);\s*return;/,
    );
    expect(SOURCE).toMatch(/\(\) => undefined,\s*\)\s*\.finally\(settle\);/);
  });

  it('after a deploy: a reopened stream makes one call, and an answer from another process one page render (D-422)', () => {
    expect(SOURCE).toMatch(
      /if \(answer\.v !== LIVE_FORMAT \|\| answer\.instance !== instance\) \{[^]*?if \(mayRefreshForSkew\(Date\.now\(\)\)\) router\.refresh\(\);/,
    );
    // Once a minute at most, across loads too.
    expect(SOURCE).toMatch(/sessionStorage\.getItem\(SKEW_KEY\)/);
    expect(SOURCE).toMatch(/source\.onerror = \(\) => \{\s*broken = true;/);
    expect(SOURCE).toMatch(/if \(broken\) consider\('reopen'\);\s*broken = false;/);
  });

  it('a newer render of the page wins over an older answer of the function', () => {
    expect(SOURCE).toMatch(
      /slots=\{fresh !== null && fresh\.from === slots \? \{ \.\.\.slots, \.\.\.fresh\.slots \} : slots\}/,
    );
  });

  it('gives the server modules the page’s clock, per part, and says on the live region when they may be behind', () => {
    expect(SOURCE).toMatch(/<LiveClockProvider value=\{\{ now, behind, drawnAt \}\}>/);
    expect(SOURCE).toMatch(
      /data-modules=\{behind\.events \|\| behind\.stats \? 'behind' : 'current'\}/,
    );
    // A statistics change held on purpose in lite mode is not "behind".
    expect(SOURCE).toMatch(/stats: parts\.includes\('stats'\) && !lite \?/);
  });

  it('clears the call’s timer when the page goes away', () => {
    expect(SOURCE).toMatch(
      /if \(timer !== null\) clearTimeout\(timer\);\s*considerRef\.current = null;\s*stop\(\);/,
    );
  });
});

const m = matchWords('en').m;
const at = Date.parse('2026-11-13T20:30:00.000Z');
const clock = (now: number | undefined, behind = both(false), drawnAt = both(at)) => ({
  now,
  behind,
  drawnAt,
});

describe('live age: a server module’s age on the live clock (T-1811)', () => {
  // T-1782's words, as the statistics card hands them in (T-1813).
  const words: FreshnessWords = {
    'freshness.checked': m['matchCentre.statsUpdated'],
    'freshness.behind': m['freshness.behind'],
  };
  const age = (now: number | undefined, behind = both(false)) =>
    renderToStaticMarkup(
      createElement(
        LiveClockProvider,
        { value: clock(now, behind) },
        createElement(LiveAge, {
          checkedAt: new Date(at).toISOString(),
          staleAfterMs: 10 * 60_000,
          locale: 'en',
          words,
          testId: 'stats-freshness',
          followsModules: 'stats',
        }),
      ),
    );

  it('ticks with the clock it is given, and turns to "may be behind" past its threshold', () => {
    const fresh = age(at + 2 * 60_000);
    expect(fresh).toContain('data-freshness="current"');
    expect(fresh).toContain('2 min');
    expect(age(at + 11 * 60_000)).toContain('data-freshness="behind"');
    expect(age(at + 11 * 60_000)).toContain(m['freshness.behind'].text);
  });

  it('turns to "may be behind" at once when its own part is behind the stream, not another', () => {
    expect(age(at + 60_000, { events: false, stats: true })).toContain('data-freshness="behind"');
    expect(age(at + 60_000, { events: true, stats: false })).toContain('data-freshness="current"');
  });

  it('draws nothing without a live clock', () => {
    expect(age(undefined)).toBe('');
    expect(
      renderToStaticMarkup(
        createElement(LiveAge, {
          checkedAt: at,
          staleAfterMs: 1,
          locale: 'en',
          words,
        }),
      ),
    ).toBe('');
  });
});

describe('the key events’ "may be behind" line (review B1; designer option A)', () => {
  const words: FreshnessWords = {
    'freshness.checked': EN_KEY_EVENTS,
    'freshness.behind': m['freshness.behind'],
  };
  const line = (value: ReturnType<typeof clock>) =>
    renderToStaticMarkup(
      createElement(
        LiveClockProvider,
        { value },
        createElement(LiveBehind, {
          part: 'events',
          locale: 'en',
          words,
          testId: 'events-freshness',
        }),
      ),
    );

  it('normal: nothing at all, no line held open', () => {
    expect(line(clock(at + 5 * 60_000))).toBe('');
    // Behind on the statistics only: the key events are current.
    expect(line(clock(at + 5 * 60_000, { events: false, stats: true }))).toBe('');
  });

  it('behind: the triangle, "Key events updated 3 min ago · may be behind", in the warning colour', () => {
    const html = line(clock(at + 3 * 60_000, { events: true, stats: false }));
    expect(html).toContain('data-testid="events-freshness"');
    expect(html).toContain('data-freshness="behind"');
    expect(html).toContain('▲');
    expect(html).toContain('text-warning');
    expect(html.replace(/<[^>]+>/g, '')).toContain('Key events updated 3 min ago · may be behind');
    // No live region of its own: the page's polite region has said the change.
    expect(html).not.toMatch(/role=|aria-live/);
  });

  it('recovered: the next drawing takes the line away', () => {
    expect(line(clock(at + 3 * 60_000, both(false), both(at + 3 * 60_000)))).toBe('');
  });

  it('says it in Persian from the catalogue', () => {
    const fa = matchWords('fa').m;
    const html = renderToStaticMarkup(
      createElement(
        LiveClockProvider,
        { value: clock(at + 3 * 60_000, { events: true, stats: false }) },
        createElement(LiveBehind, {
          part: 'events',
          locale: 'fa',
          words: {
            'freshness.checked': message('fa', 'matchCentre.keyEventsUpdated'),
            'freshness.behind': fa['freshness.behind'],
          },
        }),
      ),
    );
    expect(html).toContain('به‌روزرسانی رویدادها');
    expect(html).toContain('شاید عقب باشد');
  });
});
