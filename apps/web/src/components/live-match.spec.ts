import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FreshnessWords } from './freshness-stamp';
import { LiveAge, LiveClockProvider } from './live-age';
import { matchWords } from '@/lib/words-server';

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
      /const parts = liveParts\(slotsRef\.current\);\s*if \(parts\.length === 0\) return;/,
    );
    expect(SOURCE).toMatch(/liveChange\(asked \?\? drawn\.current, latest, parts\)/);
    expect(SOURCE).toMatch(
      /planRefresh\(plan, change, \{ now: at, random: Math\.random\(\), lite \}\)/,
    );
    // One call at a time, the trailing one when it settles.
    expect(SOURCE).toMatch(/refreshDue\(plan, Date\.now\(\)\)/);
    expect(SOURCE).toMatch(/const next = refreshSettled\(plan\);[^]*if \(next\.call\) call\(\);/);
    // The function is the only way the modules are drawn again: no refresh of the page for it.
    expect(SOURCE.match(/router\.refresh\(\)/g)).toHaveLength(2);
  });

  it('keeps what it has when a call fails or answers nothing, and never unmounts the view', () => {
    expect(SOURCE).toMatch(/if \(stopped \|\| modules === null\) return;/);
    // A failure other than a replaced build is swallowed; the view stays.
    expect(SOURCE).toMatch(
      /if \(stopped \|\| skewed \|\| !unstable_isUnrecognizedActionError\(error\)\) return;\s*skewed = true;\s*router\.refresh\(\);/,
    );
  });

  it('after a deploy: a reopened stream makes one call, and an unknown function one page render', () => {
    expect(SOURCE).toMatch(/source\.onerror = \(\) => \{\s*broken = true;/);
    expect(SOURCE).toMatch(/if \(broken\) consider\('reopen'\);\s*broken = false;/);
  });

  it('a newer render of the page wins over an older answer of the function', () => {
    expect(SOURCE).toMatch(
      /slots=\{fresh !== null && fresh\.from === slots \? \{ \.\.\.slots, \.\.\.fresh\.slots \} : slots\}/,
    );
    expect(SOURCE).toMatch(
      /slotsRef\.current = slots;\s*drawn\.current = liveSignature\(seen\.current\);/,
    );
  });

  it('gives the server modules the page’s clock, and says on the live region when they may be behind', () => {
    expect(SOURCE).toMatch(/<LiveClockProvider value=\{\{ now, behind \}\}>/);
    expect(SOURCE).toMatch(/data-modules=\{behind \? 'behind' : 'current'\}/);
    // A statistics change held on purpose in lite mode is not "behind".
    expect(SOURCE).toMatch(/if \(change !== 'reopen' && !\(lite && change === 'stats'\)\)/);
  });

  it('clears the call’s timer when the page goes away', () => {
    expect(SOURCE).toMatch(/if \(timer !== null\) clearTimeout\(timer\);\s*stop\(\);/);
  });
});

describe('live age: a server module’s age on the live clock (T-1811)', () => {
  // T-1782's words, as the statistics card will hand them in (T-1813).
  const m = matchWords('en').m;
  const words: FreshnessWords = {
    'freshness.checked': m['matchCentre.statsUpdated'],
    'freshness.behind': m['freshness.behind'],
  };
  const at = Date.parse('2026-11-13T20:30:00.000Z');
  const age = (now: number | undefined) =>
    renderToStaticMarkup(
      createElement(
        LiveClockProvider,
        { value: { now, behind: false } },
        createElement(LiveAge, {
          checkedAt: new Date(at).toISOString(),
          staleAfterMs: 10 * 60_000,
          locale: 'en',
          words,
          testId: 'stats-freshness',
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

describe('live match: a finished match is not live (T-1394)', () => {
  it('draws the stream line only while showsLiveLine says the match can still change', () => {
    expect(SOURCE).toMatch(/const live = showsLiveLine\(centre\.fixture\.status\) \?/);
    expect(SOURCE).toMatch(/\) : undefined;/);
  });
});

describe('live match: no counter before kick-off (T-1743, D-364)', () => {
  const from = SOURCE.indexOf('const live = showsLiveLine');
  const line = SOURCE.slice(from, SOURCE.indexOf('return (', from));

  it('ticks "last checked" only while the match is in play', () => {
    expect(SOURCE).toMatch(/const inPlay = status === 'live' \|\| status === 'suspended';/);
    expect(line).toMatch(/\? \(\s*inPlay \? \([^]*<FreshnessStamp[^]*\) : broken \? \(/);
    // The stamp is in the in-play branch and nowhere after it.
    expect(line.slice(line.indexOf(') : broken ? ('))).not.toContain('FreshnessStamp');
  });

  it('before kick-off names the stream only when it has broken, as a status in the warning colour', () => {
    expect(SOURCE).toMatch(/const broken = state === 'stale' \|\| state === 'unavailable';/);
    expect(line).toMatch(
      /\) : broken \? \(\s*<p\s+className="text-xs font-medium text-warning"\s+data-testid="live-state"\s+data-state=\{state\}\s+role="status"\s*>\s*\{liveLabel\(state, clock, locale, timeZone, words\.m\)\}/,
    );
    expect(line).toMatch(/\) : undefined\s*\) : undefined;/);
  });

  it('keeps the stream state on the live region, for a page that draws no line about it', () => {
    expect(SOURCE).toMatch(/data-testid="live-announcements"[^>]*data-stream=\{state\}/);
  });
});
