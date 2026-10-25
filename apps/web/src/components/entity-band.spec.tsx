import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contrast } from '@/lib/band-colour';
import { BRAND_COLOURS } from '@/lib/brand-colours';
import { EntityBand } from './entity-band';

/** The club or player band with and without a club colour (T-1418, D-204, D-218). */

const band = (colour?: string | null) =>
  renderToStaticMarkup(
    <EntityBand
      testId="team-header"
      media={<span>crest</span>}
      eyebrow="England · Club"
      title="Manchester United"
      details={<p className="text-sm text-muted">Old Trafford</p>}
      actions={<button type="button">Follow</button>}
      tabs={<nav data-testid="tabs">tabs</nav>}
      colour={colour}
    />,
  );

describe('EntityBand', () => {
  it('is the surface band when no colour is known (T-1499)', () => {
    for (const out of [band(), band(null), band('not a colour')]) {
      expect(out).toContain('data-band="surface"');
      expect(out).toContain('bg-surface');
      expect(out).not.toContain('background-color');
      expect(out).not.toContain('--token-text');
    }
  });

  it('fills the identity block with the club’s colour and every text on it with one text colour', () => {
    const out = band('#c41f17');
    expect(out).toContain('data-band="club"');
    expect(out).toContain('background-color:#c41f17');
    const white = BRAND_COLOURS['on-accent'];
    for (const token of ['--token-text', '--token-text-muted', '--token-caption']) {
      expect(out).toContain(`${token}:${white}`);
    }
    // The tabs and the follow button stay below the fill, on the theme's
    // surface: the colour is the band's, never a control's (D-276).
    const fill = out.slice(0, out.indexOf('data-testid="tabs"'));
    expect(fill).toContain('background-color:#c41f17');
    expect(fill).not.toContain('Follow');
    expect(out.indexOf('Follow')).toBeGreaterThan(out.indexOf('data-testid="tabs"'));
  });

  it('passes 4.5:1 for white on the band, or switches to the ink (T-1499)', () => {
    for (const colour of ['#88002d', '#c41f17', '#ffd700', '#6cabdd', '#00a650', '#ffffff']) {
      const out = band(colour);
      const fill = /background-color:(#[0-9a-f]{6})/.exec(out)![1]!;
      const text = /--token-text:(#[0-9a-f]{6})/.exec(out)![1]!;
      expect(contrast(fill, text)).toBeGreaterThanOrEqual(4.5);
      expect([BRAND_COLOURS['on-accent'], BRAND_COLOURS.text]).toContain(text);
    }
  });

  it('puts where the club stands at the end of the identity block, inside the fill', () => {
    const out = renderToStaticMarkup(
      <EntityBand
        testId="team-header"
        media={null}
        eyebrow="England · Club"
        title="Aston Villa"
        details={null}
        aside={<span data-testid="standing">6th</span>}
        actions={null}
        tabs={<nav data-testid="tabs">tabs</nav>}
        colour="#88002d"
      />,
    );
    expect(out.indexOf('data-testid="standing"')).toBeLessThan(out.indexOf('data-testid="tabs"'));
    expect(out).toContain('sm:ms-auto');
  });

  it('puts the ink on a light club colour', () => {
    expect(band('#ffffff')).toContain(`--token-text:${BRAND_COLOURS.text}`);
  });
});
