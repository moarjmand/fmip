import { createHash } from 'node:crypto';
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
    // The script records what it drew from (the mark and itself) and what it
    // wrote. An edit to the mark or the script without regenerating, or an
    // icon changed by hand, no longer matches the record. Rasterising the
    // icons again is the CI step `icons:check` (seconds of CPU on a busy
    // runner, too slow for a unit test); it also fails on a stale record.
    const manifest = JSON.parse(readFileSync(`${WEB}scripts/make-icons.manifest.json`, 'utf8')) as {
      source: string;
      script: string;
      icons: Record<string, string>;
    };
    const sha256 = (path: string) =>
      createHash('sha256')
        .update(readFileSync(`${WEB}${path}`))
        .digest('hex');
    expect(sha256('public/icons/mark.svg')).toBe(manifest.source);
    expect(sha256('scripts/make-icons.mjs')).toBe(manifest.script);
    expect(Object.keys(manifest.icons).sort()).toEqual([
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
    ]);
    for (const [name, hash] of Object.entries(manifest.icons)) {
      expect(sha256(`public/icons/${name}`), name).toBe(hash);
    }
  });
});
