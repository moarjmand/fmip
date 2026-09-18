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
