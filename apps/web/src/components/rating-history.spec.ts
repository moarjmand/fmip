import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rating over time on a profile (blueprint 9.3, T-640) keeps four promises.
 *
 * **Nothing settled is a sentence, not an empty chart** (rule 3). **A private
 * history stays private**: the section follows the API's restricted shape
 * rather than drawing what it was not given. **The picture is never the only
 * place a number lives**: a table carries every point for a screen reader.
 * **No chart library**: inline SVG, because a dependency needs a decision.
 */

const HERE = __dirname;
const SECTION = readFileSync(join(HERE, 'rating-history.tsx'), 'utf8');
const PROFILE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'u', '[username]', 'page.tsx'),
  'utf8',
);

describe('the rating over time on a profile', () => {
  it('is mounted on the profile with the viewer’s session and the page direction', () => {
    expect(PROFILE).toContain('<RatingHistorySection');
    expect(PROFILE).toContain('fetchRatingHistory(profile.username, cookie)');
    expect(PROFILE).toContain('direction={directionOf(locale)}');
  });

  it('says so in words when nothing has settled, is restricted, or cannot be fetched', () => {
    for (const testId of [
      'rating-history-none',
      'rating-history-restricted',
      'rating-history-unreachable',
    ]) {
      expect(SECTION, `no stated state for ${testId}`).toContain(`data-testid="${testId}"`);
    }
    // The chart is drawn only after the null history has returned its sentence.
    expect(SECTION.indexOf('rating-history-none')).toBeLessThan(
      SECTION.indexOf('rating-history-chart'),
    );
  });

  it('labels the chart and repeats its points in a table', () => {
    expect(SECTION).toMatch(/role="img"\s+aria-label=\{summary\}/);
    expect(SECTION).toContain('className="sr-only" data-testid="rating-history-table"');
    expect(SECTION).toContain('data-testid="rating-highest"');
    expect(SECTION).toContain('data-testid="rating-by-competition"');
  });

  it('uses no chart library and no physical sides', () => {
    const imports = [...SECTION.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((path) => path?.startsWith('@/') || path === '@fmip/contracts')).toBe(
      true,
    );
    expect(SECTION).not.toMatch(/\b(?:text|ml|mr|pl|pr|left|right)-(?:left|right|\d)/);
    expect(SECTION).not.toMatch(/scale-x|scaleX/);
  });
});
