import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(SOURCE).toMatch(/if \(panelRefresh !== null\) clearTimeout\(panelRefresh\)/);
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
