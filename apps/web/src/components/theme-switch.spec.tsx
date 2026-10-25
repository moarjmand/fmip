import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, parseTheme, reconcileTheme, themeAttribute } from '@/lib/theme';
import { ThemeSwitch } from './theme-switch';

/**
 * The theme switch (T-602). Three answers and no others; the page is rendered
 * with the choice already on <html>, so nothing flashes; a member's choice
 * travels with the account; and the control is a plain form whose pressed
 * button says so to a screen reader.
 */

const HERE = __dirname;
const LAYOUT = readFileSync(join(HERE, '..', 'app', '[locale]', 'layout.tsx'), 'utf8');
const HEADER = readFileSync(join(HERE, 'site-header.tsx'), 'utf8');
const SETTINGS = readFileSync(join(HERE, '..', 'app', '[locale]', 'settings', 'page.tsx'), 'utf8');
const ACTIONS = readFileSync(join(HERE, '..', 'lib', 'theme-actions.ts'), 'utf8');
const AUTH = readFileSync(join(HERE, '..', 'lib', 'auth-actions.ts'), 'utf8');

describe('a theme value', () => {
  it('is light, dark or system, exactly', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    for (const raw of ['Dark', 'sepia', '', undefined, null, 1]) {
      expect(parseTheme(raw), String(raw)).toBeUndefined();
    }
  });

  it('renders as the device when none was chosen or the cookie is not one of the three', () => {
    expect(themeAttribute(undefined)).toBe('system');
    expect(themeAttribute('neon')).toBe('system');
    expect(themeAttribute('dark')).toBe('dark');
  });
});

describe('the browser and the account at sign-in', () => {
  it('the account’s own choice reaches the browser', () => {
    expect(reconcileTheme('dark', undefined)).toEqual({ cookie: 'dark' });
    expect(reconcileTheme('dark', 'light')).toEqual({ cookie: 'dark' });
    expect(reconcileTheme('light', 'light')).toEqual({});
  });

  it('an account that never chose takes the browser’s choice, and nothing is written when neither chose', () => {
    expect(reconcileTheme('system', 'dark')).toEqual({ account: 'dark' });
    expect(reconcileTheme('system', 'system')).toEqual({});
    expect(reconcileTheme('system', undefined)).toEqual({});
  });

  it('runs after both sign-in and sign-up', () => {
    expect(AUTH.match(/await reconcileThemeAtSignIn\(result\.setCookie\);/g)).toHaveLength(2);
  });
});

describe('the page', () => {
  it('is rendered with the chosen theme on <html>, from the cookie, before any script', () => {
    expect(LAYOUT).toContain('const theme = await readTheme();');
    expect(LAYOUT).toContain('data-theme={theme}');
    expect(THEME_COOKIE).toBe('fmip_theme');
  });

  it('offers the switch in the header on every page and in Settings', () => {
    expect(HEADER).toContain('<ThemeSwitch locale={locale} current={theme} variant="compact" />');
    expect(SETTINGS).toContain('<ThemeSwitch locale={locale} current={theme} variant="full" />');
  });

  it('keeps a member’s choice on the account as well as in the browser', () => {
    expect(ACTIONS).toContain('await writeTheme(theme);');
    expect(ACTIONS).toContain("'/me/preferences', { method: 'PATCH', body: { theme }, cookie }");
  });
});

describe('the switch', () => {
  const html = renderToStaticMarkup(<ThemeSwitch locale="en" current="dark" variant="compact" />);

  it('is three submit buttons named theme, the current one pressed', () => {
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(3);
    for (const [theme, pressed] of [
      ['light', 'false'],
      ['dark', 'true'],
      ['system', 'false'],
    ]) {
      const button = buttons.find((b) => b.includes(`value="${theme}"`));
      expect(button, theme).toBeDefined();
      expect(button).toContain('type="submit"');
      expect(button).toContain('name="theme"');
      expect(button).toContain(`aria-pressed="${pressed}"`);
    }
  });

  it('is a named group, with its labels from the catalogue', () => {
    expect(html).toMatch(/role="group" aria-labelledby="theme-switch-compact-label"/);
    expect(html).toContain('id="theme-switch-compact-label"');
    for (const label of ['Theme', 'Auto', 'Day', 'Night']) expect(html).toContain(label);
    // Auto first, then Day and Night (D-198).
    expect(html.indexOf('value="system"')).toBeLessThan(html.indexOf('value="light"'));
    expect(html.indexOf('value="light"')).toBeLessThan(html.indexOf('value="dark"'));
  });

  it('marks an untranslated label as English on a locale nobody has finished', () => {
    const arabic = renderToStaticMarkup(
      <ThemeSwitch locale="ar" current="system" variant="full" />,
    );
    expect(arabic).toContain('lang="en"');
  });

  it('paints only with token classes', () => {
    expect(html).not.toMatch(/\b(?:bg|text|border)-(?:red|green|gray|black|white)\b/);
    expect(html).toContain('bg-accent');
    expect(html).toContain('text-on-accent');
  });
});

describe('the header at every width (T-1479)', () => {
  it('gives the phone Menu thumb-sized theme buttons and the desktop bar one 40px icon (D-267)', () => {
    const SWITCH = readFileSync(join(HERE, 'theme-switch.tsx'), 'utf8');
    expect(SWITCH).toContain('`min-h-touch px-3 lg:size-10');
    // The words stay for a screen reader where the icon stands in for them.
    const html = renderToStaticMarkup(<ThemeSwitch locale="en" current="dark" variant="compact" />);
    expect(html).toMatch(/<span class="lg:sr-only">Night<\/span>/);
    expect(html.match(/<svg[^>]*class="hidden lg:block"/g)).toHaveLength(3);
    // Night is on, so the desktop bar draws Auto alone, the next press.
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons.filter((b) => /lg:flex/.test(b))).toHaveLength(1);
    expect(buttons.find((b) => /lg:flex/.test(b))).toContain('value="system"');
  });

  it('keeps the bar one row from 1024px, the search giving way first (T-1534)', () => {
    // A fixed height and no wrap: a face arriving late cannot add a row.
    expect(HEADER).toContain('lg:h-16 lg:gap-x-4"');
    expect(HEADER).not.toContain('lg:flex-wrap');
    expect(HEADER).not.toContain('lg:max-xl:order-last');
    // The field shrinks to its icon rather than pushing the tools on; below
    // 1280px it is the search link, and the mark stands without its name.
    expect(HEADER).toContain('xl:ms-auto xl:flex xl:max-w-64 xl:min-w-11 xl:grow xl:basis-64');
    expect(HEADER).toContain('`${tool} lg:ms-auto lg:shrink-0 xl:hidden`');
    expect(HEADER).toContain('lg:text-lg lg:max-xl:sr-only');
  });
});
