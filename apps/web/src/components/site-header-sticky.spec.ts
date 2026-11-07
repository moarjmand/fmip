import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The sticky header (T-1759, D-376; board P4-7), held to the stylesheet that
 * draws it, since it is CSS alone: 48px on a phone and 56px from 768px, stuck
 * at the top at layer 30 on every page but the match page (which keeps
 * D-363's own sticky stack and the header it had), nothing stuck under 28rem
 * of height, and `--site-header-height` saying how much of the top it holds
 * (0 where it does not stick) for the other sticky elements and the jumps.
 */

const HERE = __dirname;
const STYLES = readFileSync(join(HERE, '..', 'app', 'globals.css'), 'utf8');
const HEADER = readFileSync(join(HERE, 'site-header.tsx'), 'utf8');
const MATCH = readFileSync(join(HERE, 'match-centre-view.tsx'), 'utf8');
const TABS = readFileSync(join(HERE, 'shell-nav.tsx'), 'utf8');
const PICK = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'match', '[id]', 'match-pick.tsx'),
  'utf8',
);

/** The declarations of the first unlayered rule with exactly this selector. */
function rule(selector: string, from = 0): string {
  const at = STYLES.indexOf(`\n${selector} {`, from);
  expect(at, selector).toBeGreaterThan(-1);
  const open = STYLES.indexOf('{', at);
  return STYLES.slice(open + 1, STYLES.indexOf('}', open)).trim();
}

/** The body of the first `@media (...)` block, from `from`, whose query is exactly this. */
function media(query: string, from = 0): { body: string; at: number } {
  const at = STYLES.indexOf(`@media ${query} {`, from);
  expect(at, query).toBeGreaterThan(-1);
  let depth = 0;
  let i = STYLES.indexOf('{', at);
  const start = i + 1;
  for (; i < STYLES.length; i += 1) {
    if (STYLES[i] === '{') depth += 1;
    if (STYLES[i] === '}') depth -= 1;
    if (depth === 0) break;
  }
  return { body: STYLES.slice(start, i), at };
}

const BLOCK = STYLES.indexOf('The sticky header (T-1759, D-376');

describe('the header sticks (T-1759, D-376)', () => {
  it('is the header itself, by two classes, with no script and no height of its own', () => {
    expect(HEADER).toContain('<header className="site-header ');
    expect(HEADER).toContain('className={`site-bar page-frame flex items-center');
    expect(HEADER).not.toMatch(/<header className="relative/);
    expect(HEADER).not.toMatch(/\bmin-h-15\b|\blg:h-16\b/);
    expect(HEADER).not.toMatch(/^'use client'/);
  });

  it('holds only the bar: the notices follow it and scroll away', () => {
    const end = HEADER.indexOf('</header>');
    expect(HEADER.indexOf('<RulesPrompt')).toBeGreaterThan(end);
    expect(HEADER.indexOf('<HeldLanguageNotice')).toBeGreaterThan(end);
    expect(HEADER.indexOf('<MomentsRail')).toBeGreaterThan(end);
  });

  it('sticks at the top at layer 30, under the tab bar (40) and over the pick bar (20)', () => {
    expect(BLOCK).toBeGreaterThan(-1);
    expect(rule('.site-header', BLOCK)).toBe(
      'position: sticky;\n  inset-block-start: 0;\n  z-index: 30;',
    );
    expect(TABS).toMatch(/fixed inset-x-0 bottom-0 z-40 /);
    expect(PICK).toMatch(/fixed inset-x-0 bottom-0 z-20 /);
  });

  it('is 48px on a phone (its hairline included) and 56px from 768px', () => {
    expect(rule(':root', BLOCK)).toMatch(/^--site-header-height: 3rem;/);
    expect(rule('.site-bar', BLOCK)).toBe('min-block-size: calc(3rem - 1px);');
    const md = media('(width >= 48rem)', BLOCK).body;
    expect(md).toMatch(/:root \{\s*--site-header-height: 3\.5rem;\s*\}/);
    expect(md).toMatch(/\.site-bar \{\s*min-block-size: 3\.5rem;\s*\}/);
    const lg = media('(width >= 64rem)', BLOCK).body;
    expect(lg).toMatch(/\.site-bar \{\s*block-size: 3\.5rem;\s*\}/);
    // The hairline is the phone's alone, so 56px from 768px is the bar's own.
    expect(HEADER).toContain('border-b border-default bg-surface md:border-b-0');
  });

  it('lets a jump land clear of it', () => {
    expect(rule(':root', BLOCK)).toContain(
      'scroll-padding-block-start: var(--site-header-height);',
    );
  });

  it('does not stick on the match page, which keeps D-363’s stack and its header’s height', () => {
    expect(MATCH).toContain('data-match-root=""');
    expect(rule(':root:has([data-match-root])', BLOCK)).toBe('--site-header-height: 0px;');
    expect(rule(':root:has([data-match-root]) .site-header', BLOCK)).toBe(
      'position: relative;\n  z-index: auto;',
    );
    // 60px and the hairline on a phone, 64px from 1024px: as before T-1759,
    // so the page's first screen (the pick buttons above the pick bar) holds.
    expect(rule(':root:has([data-match-root]) .site-bar', BLOCK)).toBe('min-block-size: 3.75rem;');
    const lg = media('(width >= 64rem)', STYLES.indexOf(':root:has([data-match-root]) .site-bar'));
    expect(lg.body).toMatch(/:root:has\(\[data-match-root\]\) \.site-bar \{\s*block-size: 4rem;/);
  });

  it('sticks nowhere under 28rem of height (a phone on its side), last, so it wins', () => {
    const short = media('(height < 28rem)', BLOCK);
    expect(short.body).toMatch(/:root \{\s*--site-header-height: 0px;\s*\}/);
    expect(short.body).toMatch(/\.site-header \{\s*position: relative;\s*z-index: auto;\s*\}/);
    expect(short.at).toBeGreaterThan(STYLES.indexOf(':root:has([data-match-root]) .site-bar'));
    expect(short.at).toBeGreaterThan(media('(width >= 48rem)', BLOCK).at);
  });

  it('lets the open competitions menu still lift the header over its scrim', () => {
    // `header:has(#competitions-menu…)` outranks `.site-header` whatever the order.
    expect(STYLES).toMatch(/header:has\(#competitions-menu:not\(\[hidden\]\)\) \{\s*z-index: 40;/);
  });

  it('uses logical properties only (rule 7)', () => {
    const short = STYLES.indexOf('@media (height < 28rem)', BLOCK);
    const block = STYLES.slice(BLOCK, STYLES.indexOf('/*', short))
      // From inside the block's own comment: drop it, then any other.
      .replace(/^[\s\S]*?\*\//, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block).not.toMatch(
      /^\s*(?:top|bottom|left|right|height|(?:margin|padding)-(?:top|bottom|left|right))\s*:/m,
    );
  });
});
