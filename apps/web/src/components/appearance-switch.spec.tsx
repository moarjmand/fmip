import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE,
  DEFAULT_APPEARANCE,
  appearanceOf,
  parseAppearance,
  reconcilePreference,
} from '@/lib/appearance';
import { AppearanceSwitch } from './appearance-switch';

/**
 * Text size, contrast and motion (blueprint 2.2, T-621), kept the way the
 * theme is (T-602): each value one of its own list; the page rendered with
 * the choice already on <html>; a member's choice on the account; and each
 * control a plain form whose pressed button says so to a screen reader.
 */

const HERE = __dirname;
const LAYOUT = readFileSync(join(HERE, '..', 'app', '[locale]', 'layout.tsx'), 'utf8');
const SETTINGS = readFileSync(join(HERE, '..', 'app', '[locale]', 'settings', 'page.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'theme-actions.ts'), 'utf8');
const COOKIES = readFileSync(join(HERE, '..', 'lib', 'theme-cookie.ts'), 'utf8');
const GLOBALS = readFileSync(join(HERE, '..', 'app', 'globals.css'), 'utf8');

describe('an appearance value', () => {
  it('is one of its own preference’s values, exactly', () => {
    expect(parseAppearance('text_size', 'larger')).toBe('larger');
    expect(parseAppearance('contrast', 'more')).toBe('more');
    expect(parseAppearance('motion', 'reduce')).toBe('reduce');
    // One preference's value is not another's.
    expect(parseAppearance('contrast', 'larger')).toBeUndefined();
    expect(parseAppearance('text_size', 'system')).toBeUndefined();
    for (const raw of ['Larger', 'huge', '', undefined, null, 1]) {
      expect(parseAppearance('text_size', raw), String(raw)).toBeUndefined();
    }
  });

  it('keeps its cookie under the names the layout reads', () => {
    expect(APPEARANCE.text_size.cookie).toBe('fmip_text_size');
    expect(APPEARANCE.contrast.cookie).toBe('fmip_contrast');
    expect(APPEARANCE.motion.cookie).toBe('fmip_motion');
  });

  it('renders as the default when none was chosen or a cookie holds something else', () => {
    expect(appearanceOf({})).toEqual(DEFAULT_APPEARANCE);
    expect(appearanceOf({ text_size: 'huge', contrast: 'high', motion: 'off' })).toEqual(
      appearanceOf({}),
    );
    expect(appearanceOf({ text_size: 'larger', contrast: 'more', motion: 'reduce' })).toEqual({
      text_size: 'larger',
      contrast: 'more',
      motion: 'reduce',
    });
    expect(DEFAULT_APPEARANCE).toEqual({
      text_size: 'default',
      contrast: 'system',
      motion: 'system',
    });
  });
});

describe('the browser and the account at sign-in', () => {
  it('the account’s own choice reaches the browser', () => {
    expect(reconcilePreference('larger', undefined, 'default')).toEqual({ cookie: 'larger' });
    expect(reconcilePreference('standard', 'more', 'system')).toEqual({ cookie: 'standard' });
    expect(reconcilePreference('reduce', 'reduce', 'system')).toEqual({});
  });

  it('an account that never chose takes the browser’s, and nothing is written when neither chose', () => {
    expect(reconcilePreference('default', 'large', 'default')).toEqual({ account: 'large' });
    expect(reconcilePreference('system', 'system', 'system')).toEqual({});
    expect(reconcilePreference('system', undefined, 'system')).toEqual({});
  });

  it('runs for all three beside the theme, in one read and at most one write', () => {
    expect(COOKIES).toContain('for (const key of APPEARANCE_KEYS)');
    expect(COOKIES.match(/'\/me\/preferences'/g)).toHaveLength(1);
  });
});

describe('the page', () => {
  it('is rendered with the choices on <html>, from the cookies, before any script', () => {
    expect(LAYOUT).toContain('const appearance = await readAppearance();');
    expect(LAYOUT).toContain('data-text-size={appearance.text_size}');
    expect(LAYOUT).toContain('data-contrast={appearance.contrast}');
    expect(LAYOUT).toContain('data-motion={appearance.motion}');
  });

  it('scales every rem with the root font size, and reduces motion when asked', () => {
    expect(GLOBALS).toMatch(/:root\[data-text-size='large'\] \{\s*font-size: 112\.5%;/);
    expect(GLOBALS).toMatch(/:root\[data-text-size='larger'\] \{\s*font-size: 125%;/);
    // The whole type scale is in rem, so nothing is left behind at a larger size.
    const scale = [...GLOBALS.matchAll(/--text-[a-z0-9]+: ([^;]+);/g)].map((m) => m[1]);
    expect(scale.length).toBeGreaterThanOrEqual(7);
    for (const size of scale) expect(size).toMatch(/rem$/);
    expect(GLOBALS).toContain(":root[data-motion='reduce'] *,");
  });

  it('offers the three in Settings → Appearance, for a member and a guest alike', () => {
    for (const preference of ['text_size', 'contrast', 'motion']) {
      expect(SETTINGS).toContain(
        `<AppearanceSwitch locale={locale} preference="${preference}" current={appearance.${preference}} />`,
      );
    }
    expect(SETTINGS.match(/<AppearanceSection /g)).toHaveLength(2);
    expect(SETTINGS).not.toContain('redirect(');
  });

  it('keeps a member’s choice on the account as well as in the browser', () => {
    expect(ACTIONS).toContain('await writeAppearance(key, value);');
    expect(ACTIONS).toContain("'/me/preferences', { method: 'PATCH', body, cookie }");
  });
});

describe('a switch', () => {
  const html = renderToStaticMarkup(
    <AppearanceSwitch locale="en" preference="text_size" current="large" />,
  );

  it('is one submit button per value, named after the preference, the current one pressed', () => {
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(3);
    for (const [size, pressed] of [
      ['default', 'false'],
      ['large', 'true'],
      ['larger', 'false'],
    ]) {
      const button = buttons.find((b) => b.includes(`value="${size}"`));
      expect(button, size).toBeDefined();
      expect(button).toContain('type="submit"');
      expect(button).toContain('name="text_size"');
      expect(button).toContain(`aria-pressed="${pressed}"`);
    }
  });

  it('is a named group, with its labels from the catalogue', () => {
    expect(html).toMatch(/role="group" aria-labelledby="appearance-text_size-label"/);
    for (const label of ['Text size', 'Standard', 'Large', 'Larger']) expect(html).toContain(label);
    const contrast = renderToStaticMarkup(
      <AppearanceSwitch locale="en" preference="contrast" current="system" />,
    );
    for (const label of ['Contrast', 'Device', 'Standard', 'More'])
      expect(contrast).toContain(label);
    const motion = renderToStaticMarkup(
      <AppearanceSwitch locale="en" preference="motion" current="reduce" />,
    );
    expect([...motion.matchAll(/<button/g)]).toHaveLength(2);
    expect(motion).toContain('Reduced');
    expect(motion).toMatch(
      /value="reduce"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*value="reduce"/,
    );
  });

  it('marks an untranslated label as English on a locale nobody has finished', () => {
    const arabic = renderToStaticMarkup(
      <AppearanceSwitch locale="ar" preference="contrast" current="more" />,
    );
    expect(arabic).toContain('lang="en"');
  });

  it('paints only with token classes', () => {
    expect(html).not.toMatch(/\b(?:bg|text|border)-(?:red|green|gray|black|white)\b/);
    expect(html).toContain('bg-accent');
    expect(html).toContain('text-on-accent');
  });
});
