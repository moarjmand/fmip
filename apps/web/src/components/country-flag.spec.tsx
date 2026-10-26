import type { EntityMedia } from '@fmip/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CountryFlag, RegionMark } from './country-flag';

/**
 * Country flags and region marks (T-1612, D-283): a flag from our own origin
 * in a flag's 4:3 shape (T-1611), or a neutral dashed box with the country's
 * code that cannot pass for a flag (rule 3); a globe and a map for the two
 * regions. Rendered, not read from the source.
 */

const FLAG: EntityMedia = {
  coverage: 'available',
  url: '/api/media/flag/c-1/0123456789ab.svg',
};
const NONE: EntityMedia = { coverage: 'not_supplied', url: null };

describe('CountryFlag', () => {
  it('draws a stored flag at 4:3, as stored, decorative and lazy', () => {
    const out = renderToStaticMarkup(<CountryFlag flag={FLAG} code="ENG" />);
    expect(out).toMatch(/^<img /);
    expect(out).toContain('src="/api/media/flag/c-1/0123456789ab.svg"');
    expect(out).toContain('width="32"');
    expect(out).toContain('height="24"');
    expect(out).toContain('alt=""');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('data-coverage="available"');
    const small = renderToStaticMarkup(<CountryFlag flag={FLAG} code="ENG" size="sm" />);
    expect(small).toContain('width="24"');
    expect(small).toContain('height="18"');
  });

  it('asks for the WebP of a raster flag, at twice its box', () => {
    const png: EntityMedia = { coverage: 'available', url: '/api/media/flag/c-1/0123456789ab.png' };
    expect(renderToStaticMarkup(<CountryFlag flag={png} code="ESP" />)).toContain(
      'src="/api/media/flag/c-1/0123456789ab-96.webp"',
    );
  });

  it('is a neutral box with the code when there is no flag, or one from elsewhere', () => {
    const foreign: EntityMedia = {
      coverage: 'available',
      url: 'https://media.api-sports.io/flags/gb-eng.svg',
    };
    for (const flag of [NONE, foreign, undefined]) {
      const out = renderToStaticMarkup(<CountryFlag flag={flag} code="eng" />);
      expect(out).not.toContain('<img');
      expect(out).not.toContain('api-sports');
      expect(out).toContain('data-coverage="not_supplied"');
      expect(out).toContain('data-letters="ENG"');
      expect(out).toContain('aria-hidden="true"');
      expect(out).toContain('border-dashed');
    }
  });
});

describe('RegionMark', () => {
  it('draws a globe, a map and the All mark, hidden from assistive technology', () => {
    for (const region of ['international', 'continental', 'all'] as const) {
      const out = renderToStaticMarkup(<RegionMark region={region} />);
      expect(out).toContain(`data-region="${region}"`);
      expect(out).toContain('aria-hidden="true"');
      expect(out).toContain('<svg');
    }
  });

  it('uses logical properties only (rule 7)', () => {
    const source = readFileSync(join(__dirname, 'country-flag.tsx'), 'utf8');
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-[\w[]/);
    expect(source).not.toMatch(/text-(?:left|right)\b/);
  });
});
