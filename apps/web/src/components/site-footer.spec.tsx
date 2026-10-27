import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LanguageHold from '@/lib/language-hold';
import { SiteFooter } from './site-footer';

/**
 * The site footer (T-1610, D-281): the name and a line on what the site is,
 * every section in three columns with the three prediction products each
 * under its own name (rule 6), What Stadiomind is and the rules (linked from
 * nowhere else), the languages, the year in the page's digits; in the
 * layout before the phone's tab bar, so it is never under it.
 */

let pathname = '/en/scores';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

// The holds the API reports: none, so Persian is offered beside English.
let holds: Map<string, string> | null = new Map();
vi.mock('@/lib/language-hold', async (original) => ({
  ...(await original<typeof LanguageHold>()),
  currentHolds: async () => holds,
}));

const LAYOUT = readFileSync(join(__dirname, '..', 'app', '[locale]', 'layout.tsx'), 'utf8');

const draw = async (locale: string) => renderToStaticMarkup(await SiteFooter({ locale }));

/** The `data-testid`s with a prefix, in document order. */
const ids = (html: string, prefix: string): string[] =>
  [...html.matchAll(new RegExp(`data-testid="${prefix}-([a-z-]+)"`, 'g'))].map((m) => m[1]!);

/** The opening tag of the link with this test id. */
const tag = (html: string, testId: string): string =>
  new RegExp(`<a[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

beforeEach(() => {
  pathname = '/en/scores';
  holds = new Map();
});

describe('the site footer', () => {
  it('is the page’s contentinfo: the name leading home, the line, the columns, the year', async () => {
    const html = await draw('en');
    expect(html).toMatch(/^<footer [^>]*data-testid="site-footer"/);
    expect(tag(html, 'footer-home')).toContain('href="/en"');
    expect(html).toContain('>Stadiomind</span>');
    expect(html).toContain(
      'Live football, a statistical model, the founder’s analysis and members’ predictions: side by side, never blended.',
    );
    expect(html).toMatch(/<nav aria-label="Site links"/);
    expect(html).toMatch(/data-testid="footer-copyright">© \d{4} <span/);
  });

  it('lists every section under Football, Predictions and Stadiomind, each to its page', async () => {
    const html = await draw('en');
    expect(ids(html, 'footer').filter((id) => !id.startsWith('language'))).toEqual([
      'home',
      'tagline',
      'football',
      'matches',
      'competitions',
      'highlights',
      'watch',
      'news',
      'predictions',
      'league',
      'model',
      'analysis',
      'site',
      'about',
      'rules',
      'copyright',
    ]);
    for (const [id, href] of [
      ['matches', '/en/scores'],
      ['competitions', '/en/competitions'],
      ['highlights', '/en/highlights'],
      ['watch', '/en/watch'],
      ['news', '/en/news'],
      ['league', '/en/leaderboard'],
      ['model', '/en/model-accuracy'],
      ['analysis', '/en/scores#analysis'],
      ['about', '/en/about'],
      ['rules', '/en/rules'],
    ] as const) {
      expect(tag(html, `footer-${id}`), id).toContain(`href="${href}"`);
      expect(tag(html, `footer-${id}`), id).toContain('class="footer-link"');
    }
    for (const word of ['>Football<', '>Predictions<', '>Leaderboard<', '>The model<']) {
      expect(html).toContain(word);
    }
    // The founder's analysis by its own name, never folded into the others (rule 6).
    expect(html).toContain('>Founder’s analysis<');
    expect(html).toContain('>What Stadiomind is<');
    expect(html).toContain('>Platform rules<');
  });

  it('offers this page in each language, with test ids of its own', async () => {
    const html = await draw('en');
    expect(tag(html, 'footer-language-fa')).toContain('href="/fa/scores"');
    expect(tag(html, 'footer-language-en')).toContain('aria-current="page"');
    expect(html).not.toContain('data-testid="language-picker"');
  });

  it('offers no language when the holds cannot be read, rather than one', async () => {
    holds = null;
    const html = await draw('en');
    expect(html).not.toContain('footer-language');
  });

  it('is in Persian on /fa, the year in Persian digits', async () => {
    pathname = '/fa/scores';
    const html = await draw('fa');
    for (const word of [
      'فوتبال',
      'پیش‌بینی‌ها',
      'جدول برترین‌ها',
      'تحلیل بنیان‌گذار',
      'پیوندهای سایت',
      'زبان',
    ]) {
      expect(html).toContain(word);
    }
    expect(html).toMatch(/© [۰-۹]{4} /);
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('is drawn by the layout after the page and before the tab bar, so the bar never covers it', () => {
    const footer = LAYOUT.indexOf('<SiteFooter locale={locale} />');
    expect(footer).toBeGreaterThan(LAYOUT.indexOf('{children}'));
    expect(footer).toBeLessThan(LAYOUT.indexOf('<SiteTabBar locale={locale} />'));
  });
});
