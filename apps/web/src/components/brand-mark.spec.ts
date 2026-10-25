import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Fragment, createElement, isValidElement, type ReactElement } from 'react';
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
  const tile = renderToStaticMarkup(createElement(BrandMark, { size: 20, ground: 'tile' }));

  it('draws exactly the shapes of public/icons/mark.svg on its tile', () => {
    expect(shapes(SOURCE).length).toBe(4);
    expect(shapes(tile)).toEqual(shapes(SOURCE));
    expect(tile).toContain('viewBox="0 0 64 64"');
    expect(SOURCE).toContain('viewBox="0 0 64 64"');
  });

  it('is the Design System logo off the tile: three bars, home longest, in the Day or Night set', () => {
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(shapes(html)).toEqual([
      'rect fill=#0e7a75 height=4 rx=2 width=18 x=3 y=4',
      'rect fill=#626c76 height=4 rx=2 width=11 x=3 y=10',
      'rect fill=#b87818 height=4 rx=2 width=7 x=3 y=16',
    ]);
    const night = renderToStaticMarkup(createElement(BrandMark, { size: 20, ground: 'night' }));
    expect(shapes(night).map((shape) => /fill=(\S+)/.exec(shape)![1])).toEqual([
      '#2bb3ad',
      '#56616b',
      '#eba53c',
    ]);
  });

  it('draws the tile’s bars at twice the logo’s scale, centred', () => {
    const geometry = (shape: string) => shape.replace(/ fill=\S+/, '');
    expect(shapes(SOURCE).slice(1).map(geometry)).toEqual([
      'rect height=8 rx=4 width=36 x=14 y=16',
      'rect height=8 rx=4 width=22 x=14 y=28',
      'rect height=8 rx=4 width=14 x=14 y=40',
    ]);
  });

  it('draws its shapes as siblings, never in a fragment, which next/og cannot draw', () => {
    for (const ground of ['day', 'night', 'tile'] as const) {
      const svg = BrandMark({ size: 20, ground }) as ReactElement<{ children: unknown }>;
      const children = [svg.props.children].flat(2).filter(isValidElement);
      expect(children.length).toBeGreaterThanOrEqual(3);
      expect(children.some((child) => child.type === Fragment)).toBe(false);
    }
  });

  it('is decorative: the name beside it is the label', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="20"');
  });

  it('has left the D-089 green behind', () => {
    expect(SOURCE).not.toContain('#0b6b3a');
    expect(SOURCE).toContain('fill="#0f1215"');
  });
});

describe('the share cards', () => {
  it('carry the mark beside the name, on the plain card and in every card footer', () => {
    const day = shapes(renderToStaticMarkup(createElement(BrandMark, { size: 20 })));
    const plain = renderToStaticMarkup(createElement(PlainCard));
    expect(shapes(plain)).toEqual(day);
    const table = renderToStaticMarkup(
      createElement(TableCardImage, {
        text: { title: 'Premier League', season: '2026/27', rows: [], absence: 'No table yet' },
        host: 'example.org',
      }),
    );
    expect(shapes(table)).toEqual(day);
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
      'icon-32.png',
      'icon-512.png',
      'icon-maskable-512.png',
    ]);
    for (const [name, hash] of Object.entries(manifest.icons)) {
      expect(sha256(`public/icons/${name}`), name).toBe(hash);
    }
  });
});
