import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
  it('is the brand’s band, with its green rule, when no colour is known', () => {
    for (const out of [band(), band(null), band('not a colour')]) {
      expect(out).toContain('data-band="brand"');
      expect(out).toContain('h-1 bg-accent');
      expect(out).not.toContain('background-color');
    }
  });

  it('fills the identity block with the club’s colour and every text on it with one text colour', () => {
    const out = band('#c41f17');
    expect(out).toContain('data-band="club"');
    expect(out).not.toContain('h-1 bg-accent');
    expect(out).toContain('background-color:#c41f17');
    const white = BRAND_COLOURS['on-accent'];
    for (const token of ['--token-text', '--token-text-muted', '--token-caption']) {
      expect(out).toContain(`${token}:${white}`);
    }
    // The tabs stay below the fill, on the theme's surface.
    const fillEnds = out.indexOf('Follow');
    expect(out.indexOf('data-testid="tabs"')).toBeGreaterThan(fillEnds);
  });

  it('puts the ink on a light club colour', () => {
    expect(band('#ffffff')).toContain(`--token-text:${BRAND_COLOURS.text}`);
  });
});
