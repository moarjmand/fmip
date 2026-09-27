import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_COLOURS } from '@/lib/brand-colours';

/**
 * The colour tokens (T-602, D-089) keep their promises.
 *
 * Every pair a page actually draws -- text of each role on each background,
 * text on the green, a field's edge and the focus ring on each background --
 * meets WCAG 2 AA in both themes: 4.5:1 for text, 3:1 for a control's edge
 * and the focus indicator. The figures are computed here from the values in
 * tokens.css, not copied, and the figures written in its comments must match
 * what is computed, so a changed value cannot leave a stale claim behind.
 * The two ways to reach dark (the device, and a chosen `data-theme="dark"`)
 * carry the same values, and every token globals.css maps to a class exists.
 */

const HERE = __dirname;
const TOKENS = readFileSync(join(HERE, 'tokens.css'), 'utf8');
const GLOBALS = readFileSync(join(HERE, 'globals.css'), 'utf8');

type Declaration = { value: string; comment: string | undefined };

function block(selector: string): Map<string, Declaration> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(TOKENS);
  if (match === null) throw new Error(`no block for ${selector}`);
  const declarations = new Map<string, Declaration>();
  const pattern = /(?:\/\*((?:(?!\*\/)[\s\S])*)\*\/\s*)?(--token-[a-z-]+):\s*(#[0-9a-f]{6});/g;
  for (const [, comment, name, value] of (match[1] ?? '').matchAll(pattern)) {
    if (name !== undefined && value !== undefined) declarations.set(name, { value, comment });
  }
  return declarations;
}

const LIGHT = block('\n:root');
const DARK = block(":root:not([data-theme='light'])");
const DARK_CHOSEN = block(":root[data-theme='dark']");

// More contrast (T-621): the first of each kind carries the figures, the
// others are the same values reached another way.
const LIGHT_MORE = block(":root[data-contrast='more']");
const LIGHT_MORE_DEVICE = block(":root:not([data-contrast='standard'])");
const DARK_MORE = block(":root[data-theme='dark'][data-contrast='more']");
const DARK_MORE_COPIES = [
  block(":root:not([data-theme='light'])[data-contrast='more']"),
  block(":root[data-theme='dark']:not([data-contrast='standard'])"),
  block(":root:not([data-theme='light']):not([data-contrast='standard'])"),
];

function luminance(hex: string): number {
  const linear = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => sum + weight * (linear[i] ?? 0), 0);
}

/** WCAG 2 contrast ratio, rounded to two places as the comments write it. */
export function contrast(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

const BACKGROUNDS = ['--token-canvas', '--token-surface', '--token-surface-raised'];
const TEXT = [
  '--token-text',
  '--token-text-muted',
  '--token-accent',
  '--token-danger',
  '--token-warning',
  '--token-success',
  '--token-live',
];
const NON_TEXT = ['--token-border-strong', '--token-focus'];
const ON_ACCENT_BACKGROUNDS = ['--token-accent', '--token-accent-strong'];

function value(theme: Map<string, Declaration>, name: string): string {
  const found = theme.get(name);
  if (found === undefined) throw new Error(`${name} is not declared`);
  return found.value;
}

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
  ['light, more contrast,', LIGHT_MORE],
  ['dark, more contrast,', DARK_MORE],
])('the %s theme', (_name, theme) => {
  it.each(TEXT)('%s is AA text (4.5:1) on the page and both surfaces', (token) => {
    for (const background of BACKGROUNDS) {
      expect(
        contrast(value(theme, token), value(theme, background)),
        `${token} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(NON_TEXT)('%s is at least 3:1 on the page and both surfaces', (token) => {
    for (const background of BACKGROUNDS) {
      expect(
        contrast(value(theme, token), value(theme, background)),
        `${token} on ${background}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('text on the green is AA, plain and pressed', () => {
    for (const background of ON_ACCENT_BACKGROUNDS) {
      expect(
        contrast(value(theme, '--token-on-accent'), value(theme, background)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every figure written in a comment is the one the values give', () => {
    let checked = 0;
    for (const [token, { comment }] of theme) {
      const written = [...(comment ?? '').matchAll(/\b\d+\.\d{2}\b/g)].map((m) => Number(m[0]));
      const against = token === '--token-on-accent' ? ON_ACCENT_BACKGROUNDS : BACKGROUNDS;
      written.forEach((figure, index) => {
        const background = against[index] ?? '(none)';
        expect(figure, `${token} against ${background}`).toBe(
          contrast(value(theme, token), value(theme, background)),
        );
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe.each([
  ['light', LIGHT_MORE],
  ['dark', DARK_MORE],
])('more contrast on %s (T-621)', (_name, theme) => {
  it.each(TEXT)('%s is AAA text (7:1) on the page and both surfaces', (token) => {
    for (const background of BACKGROUNDS) {
      expect(
        contrast(value(theme, token), value(theme, background)),
        `${token} on ${background}`,
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it('text on the green is AAA, plain and pressed', () => {
    for (const background of ON_ACCENT_BACKGROUNDS) {
      expect(
        contrast(value(theme, '--token-on-accent'), value(theme, background)),
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it('even the hairline is a visible edge (3:1), and a field or the focus ring 4.5:1', () => {
    for (const background of BACKGROUNDS) {
      expect(
        contrast(value(theme, '--token-border'), value(theme, background)),
      ).toBeGreaterThanOrEqual(3);
      for (const token of NON_TEXT) {
        expect(
          contrast(value(theme, token), value(theme, background)),
          `${token} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('more contrast, as a whole (T-621)', () => {
  const standard = { light: LIGHT, dark: DARK };
  const more = { light: LIGHT_MORE, dark: DARK_MORE };

  it('raises every text role that was below 7:1, and never lowers one', () => {
    for (const name of ['light', 'dark'] as const) {
      for (const token of TEXT) {
        for (const background of BACKGROUNDS) {
          expect(
            contrast(value(more[name], token), value(more[name], background)),
            `${name} ${token} on ${background}`,
          ).toBeGreaterThanOrEqual(
            Math.min(7, contrast(value(standard[name], token), value(standard[name], background))),
          );
        }
      }
    }
  });

  it('brings muted text close to body text and makes the edges stronger', () => {
    for (const name of ['light', 'dark'] as const) {
      const canvas = value(more[name], '--token-canvas');
      expect(contrast(value(more[name], '--token-text-muted'), canvas)).toBeGreaterThanOrEqual(9);
      for (const edge of ['--token-border', '--token-border-strong']) {
        expect(contrast(value(more[name], edge), canvas), `${name} ${edge}`).toBeGreaterThan(
          contrast(value(standard[name], edge), value(standard[name], '--token-canvas')),
        );
      }
    }
  });

  it('reaches the same values whether the member chose it or the device asked for it', () => {
    const names = [...LIGHT.keys()].sort();
    const pairs = [
      [LIGHT_MORE_DEVICE, LIGHT_MORE],
      ...DARK_MORE_COPIES.map((copy) => [copy, DARK_MORE]),
    ];
    for (const [copy, of] of pairs) {
      if (copy === undefined || of === undefined) throw new Error('missing block');
      expect([...copy.keys()].sort()).toEqual(names);
      expect([...of.keys()].sort()).toEqual(names);
      for (const [name, declared] of of) expect(value(copy, name), name).toBe(declared.value);
    }
  });

  it('is layered so dark beats light-and-more, and dark-and-more beats dark', () => {
    const at = (text: string) => {
      const index = TOKENS.indexOf(text);
      expect(index, text).toBeGreaterThan(-1);
      return index;
    };
    const lightMore = at(":root[data-contrast='more'] {");
    const lightMoreDevice = at(
      "@media (prefers-contrast: more) {\n  :root:not([data-contrast='standard']) {",
    );
    const firstDark = at(
      "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {",
    );
    const chosenDark = at(":root[data-theme='dark'] {");
    const darkMore = [
      at(":root[data-theme='dark'][data-contrast='more'] {"),
      at(
        "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light'])[data-contrast='more'] {",
      ),
      at(
        "@media (prefers-contrast: more) {\n  :root[data-theme='dark']:not([data-contrast='standard']) {",
      ),
      at(
        "@media (prefers-color-scheme: dark) and (prefers-contrast: more) {\n  :root:not([data-theme='light']):not([data-contrast='standard']) {",
      ),
    ];
    expect(at('\n:root {')).toBeLessThan(lightMore);
    expect(Math.max(lightMore, lightMoreDevice)).toBeLessThan(firstDark);
    expect(firstDark).toBeLessThan(chosenDark);
    for (const index of darkMore) expect(index).toBeGreaterThan(chosenDark);
  });
});

describe('the tokens themselves', () => {
  it('declare the same names in light and in both ways to dark', () => {
    const names = [...LIGHT.keys()].sort();
    expect(names.length).toBe(15);
    expect([...DARK.keys()].sort()).toEqual(names);
    expect([...DARK_CHOSEN.keys()].sort()).toEqual(names);
  });

  it('reach dark with the same values whether the device or the member chose it', () => {
    for (const [name, { value: dark }] of DARK) {
      expect(value(DARK_CHOSEN, name), name).toBe(dark);
    }
  });

  it('are what the image renderers draw with: brand-colours.ts mirrors the light values', () => {
    const entries = Object.entries(BRAND_COLOURS);
    expect(entries.length).toBeGreaterThan(3);
    for (const [name, colour] of entries) {
      expect(colour, name).toBe(value(LIGHT, `--token-${name}`));
    }
  });

  it('keep the green D-089 names: #0b6b3a on light, #4cc88a on dark', () => {
    expect(value(LIGHT, '--token-accent')).toBe('#0b6b3a');
    expect(value(DARK, '--token-accent')).toBe('#4cc88a');
  });

  it('are what every Tailwind colour class in globals.css reads', () => {
    const theme = /@theme inline \{([^}]*)\}/.exec(GLOBALS)?.[1] ?? '';
    const mapped = [...theme.matchAll(/var\((--token-[a-z-]+)\)/g)].map((m) => m[1] ?? '');
    expect(mapped.length).toBeGreaterThan(10);
    for (const name of mapped) expect(LIGHT.has(name), name).toBe(true);
    // And the page itself, the options of a select and the focus ring.
    expect(GLOBALS).toContain('background-color: var(--token-canvas);');
    expect(GLOBALS).toContain('outline: 2px solid var(--token-focus);');
    expect(GLOBALS).toContain("@import './tokens.css';");
  });
});
