import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { matchWords } from '@/lib/words-server';
import type { FreshnessWords } from './freshness-stamp';
import { LiveAge, LiveBehind, LiveClockProvider } from './live-age';

/**
 * The server's markup carries no age on the live clock: the server's `now`
 * and the browser's differ, so an age both printed would fail hydration
 * (React error 418, seen on cold loads of a live match page). The
 * age appears in the browser right after hydration.
 */
const m = matchWords('en').m;
const words: FreshnessWords = {
  'freshness.checked': m['matchCentre.statsUpdated'],
  'freshness.behind': m['freshness.behind'],
};
const now = Date.parse('2026-11-14T20:00:00.000Z');

describe('a live age on the server', () => {
  it('draws nothing though the page gives a clock', () => {
    const html = renderToStaticMarkup(
      <LiveClockProvider
        value={{
          now,
          behind: { events: false, stats: true },
          drawnAt: { events: now, stats: now },
        }}
      >
        <LiveAge
          checkedAt={now - 8_000}
          staleAfterMs={600_000}
          locale="en"
          words={words}
          testId="stats-freshness"
          followsModules="stats"
        />
        <LiveBehind part="stats" locale="en" words={words} testId="stats-behind" />
      </LiveClockProvider>,
    );
    expect(html).toBe('');
  });
});
