import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './brand-mark';
import { PlainCard, TableCardImage } from './share-card-image';

/**
 * T-604: one mark. `public/icons/mark.svg` is the source; the icons are drawn
 * from it and the inline component is a transcription of it.
 */

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = readFileSync(`${WEB}public/icons/mark.svg`, 'utf8');

/** The drawing's shapes as normalised strings, comments and wrapper left out. */
function shapes(svg: string): string[] {
  return [...svg.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(rect|circle)\b([^>]*?)\/?>/g)].map(
    ([, tag, rest]) =>
      `${tag} ${[...rest!.matchAll(/([a-z-]+)="([^"]*)"/g)]
        .map(([, name, value]) => `${name}=${value}`)
        .sort()
        .join(' ')}`,
  );
}

describe('BrandMark', () => {
  const html = renderToStaticMarkup(createElement(BrandMark, { size: 20 }));

  it('draws exactly the shapes of public/icons/mark.svg', () => {
    expect(shapes(SOURCE).length).toBeGreaterThan(1);
    expect(shapes(html)).toEqual(shapes(SOURCE));
    expect(html).toContain('viewBox="0 0 64 64"');
    expect(SOURCE).toContain('viewBox="0 0 64 64"');
  });

  it('is decorative: the name beside it is the label', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="20"');
  });

  it('is in the primary green of the theme colour', () => {
    expect(SOURCE).toContain('fill="#0b6b3a"');
  });
});

describe('the share cards', () => {
  it('carry the mark beside the name, on the plain card and in every card footer', () => {
    const plain = renderToStaticMarkup(createElement(PlainCard));
    expect(shapes(plain)).toEqual(shapes(SOURCE));
    const table = renderToStaticMarkup(
      createElement(TableCardImage, {
        text: { title: 'Premier League', season: '2026/27', rows: [], absence: 'No table yet' },
        host: 'example.org',
      }),
    );
    expect(shapes(table)).toEqual(shapes(SOURCE));
    expect(table).toContain('FMIP · example.org');
  });
});

describe('make-icons.mjs', () => {
  it('has drawn the committed icons from the current mark', () => {
    // Exits 1 and names the icon when a committed PNG is not what the mark
    // draws, which is how an edit to the mark without regenerating shows up.
    const out = execFileSync(process.execPath, [`${WEB}scripts/make-icons.mjs`, '--check'], {
      encoding: 'utf8',
    });
    expect(out).toBe('');
  });
});
