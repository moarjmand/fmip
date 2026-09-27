import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every colour in the web app comes from a token (T-602, D-090).
 *
 * The values live in `app/tokens.css`, and `lib/brand-colours.ts` mirrors the
 * light ones for the image renderers that cannot read a CSS variable. Anywhere
 * else in `src`, a colour written out is a colour that will not follow the
 * theme and whose contrast nobody measured -- so this spec refuses it: a
 * Tailwind palette class, a hex or functional colour, a `dark:` colour
 * variant, the text colour borrowed as a fill or an edge (`bg-current/10`,
 * `border-current/30`), a system colour, or an element faded with `opacity-*`
 * to look secondary (that is `text-muted`, which keeps AA; a fade does not
 * say what it lands on). `disabled:opacity-*` stays: a disabled control is
 * exempt from contrast, and fading is how it says so.
 *
 * Specs are left out: they quote values in order to check them.
 */

const SRC = join(__dirname, '..');
const ALLOWED = new Set(['app/tokens.css', 'lib/brand-colours.ts']);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const PALETTE =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone';
const COLOUR_UTILITIES =
  'text|bg|border(?:-[xytblrse])?|ring|ring-offset|outline|fill|stroke|divide|decoration|placeholder|caret|accent|shadow|from|via|to';

const RULES: [name: string, pattern: RegExp][] = [
  [
    'a Tailwind palette colour',
    new RegExp(`\\b(?:${COLOUR_UTILITIES})-(?:(?:${PALETTE})-\\d{2,3}|black|white)(?:/\\d+)?\\b`),
  ],
  ['a hex colour', /(?:^|[\s'"`(:,=])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/],
  ['a functional colour', /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|light-dark)\(/],
  ['a `dark:` colour variant', new RegExp(`\\bdark:(?:${COLOUR_UTILITIES})-`)],
  ['the text colour used as a colour', new RegExp(`\\b(?:${COLOUR_UTILITIES})-current\\b`)],
  ['an arbitrary colour value', new RegExp(`\\b(?:${COLOUR_UTILITIES})-\\[(?:color:|#|rgb|hsl)`)],
  ['a system colour', /\b(?:Canvas|CanvasText|LinkText|ButtonFace|ButtonText|GrayText)\b/],
  ['a fade standing in for muted text', /(?<![\w:-])opacity-\d+\b/],
];

function offences(source: string): string[] {
  const found: string[] = [];
  source.split('\n').forEach((line, index) => {
    for (const [name, pattern] of RULES) {
      const match = pattern.exec(line);
      if (match !== null) found.push(`${index + 1}: ${name}: ${match[0].trim()}`);
    }
  });
  return found;
}

describe('raw colours', () => {
  const all = files(SRC).map((path) => relative(SRC, path).split(sep).join('/'));

  it('are looked for in every source file of the web app', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all).toContain('app/globals.css');
    for (const allowed of ALLOWED) expect(all).toContain(allowed);
  });

  it.each(all.filter((path) => !ALLOWED.has(path)))('%s names no colour of its own', (path) => {
    expect(offences(readFileSync(join(SRC, path), 'utf8'))).toEqual([]);
  });

  it('would catch each kind of raw colour', () => {
    for (const sample of [
      'className="text-red-800"',
      'className="dark:text-red-300"',
      'className="bg-gray-100/50"',
      'className="bg-white"',
      "const INK = '#111827';",
      'fill="#fff"',
      'color: rgb(0 0 0);',
      'className="border-current/30"',
      'className="bg-current/10"',
      'className="bg-[color:CanvasText]"',
      'background-color: Canvas;',
      'className="text-sm opacity-70"',
    ]) {
      expect(offences(sample), sample).not.toEqual([]);
    }
  });

  it('lets the tokens, anchors and a disabled fade through', () => {
    for (const sample of [
      'className="bg-surface text-muted border-default"',
      'className="bg-accent text-on-accent disabled:opacity-50"',
      'href="#content"',
      'href="#territory"',
      'fill="currentColor"',
      'color: var(--token-text);',
    ]) {
      expect(offences(sample), sample).toEqual([]);
    }
  });
});
