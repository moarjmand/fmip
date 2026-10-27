import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Message, message } from '@/i18n/messages';
import { BottomTabBar, PrimaryNav } from './shell-nav';

/**
 * The header's nav and the phone's tab bar (T-1381, D-199; Stadiomind,
 * T-1494, D-267; T-1610, D-281), drawn: the order, the current entry (by the
 * pathname and the query), the words in Persian, and the tab bar's place
 * (phones only, fixed, clear of the home indicator, never over content).
 */

let pathname = '/en';
let search = '';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

const HEADER = readFileSync(join(__dirname, 'site-header.tsx'), 'utf8');
const CSS = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

/** The body of a `@utility` in globals.css. */
const utility = (name: string): string =>
  new RegExp(`@utility ${name} \\{([\\s\\S]*?)\\n\\}`).exec(CSS)?.[1] ?? '';
const LAYOUT = readFileSync(join(__dirname, '..', 'app', '[locale]', 'layout.tsx'), 'utf8');

const words = (locale: 'en' | 'fa', keys: Record<string, Parameters<typeof message>[1]>) =>
  Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, message(locale, key)])) as Record<
    string,
    Message
  >;

const NAV = {
  matches: 'shell.nav.matches',
  competitions: 'shell.nav.competitions',
  predictions: 'nav.predictions',
  model: 'shell.nav.model',
  news: 'shell.nav.news',
  highlights: 'nav.highlights',
  more: 'shell.nav.more',
  analysis: 'analysis.founder.title',
  watch: 'nav.watch',
} as const;

const TABS = {
  matches: 'shell.tab.matches',
  predict: 'shell.tab.predict',
  leagues: 'shell.tab.leagues',
  news: 'shell.tab.news',
  you: 'shell.tab.you',
} as const;

/** The `data-testid`s with a prefix, in document order. */
const ids = (html: string, prefix: string): string[] =>
  [...html.matchAll(new RegExp(`data-testid="${prefix}-([a-z]+)"`, 'g'))].map((m) => m[1]!);

/** The opening tag of the link with this test id. */
const tag = (html: string, testId: string): string =>
  new RegExp(`<a[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

beforeEach(() => {
  pathname = '/en';
  search = '';
});

describe('the header nav', () => {
  const ORDER = [
    'matches',
    'competitions',
    'predictions',
    'model',
    'news',
    'highlights',
    'more',
    'analysis',
    'watch',
  ];
  const nav = (locale: 'en' | 'fa' = 'en') =>
    renderToStaticMarkup(<PrimaryNav locale={locale} labels={words(locale, NAV)} />);

  it('reads Matches, Competitions, Predictions, The model, News, Highlights, then More, each to its page', () => {
    const html = nav();
    expect(ids(html, 'nav')).toEqual(ORDER);
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      '/en/scores',
      '/en/competitions',
      '/en/leaderboard',
      '/en/model-accuracy',
      '/en/news',
      '/en/highlights',
      '/en/scores#analysis',
      '/en/watch',
    ]);
    for (const word of ['Matches', 'Predictions', 'The model', 'Highlights', 'More']) {
      expect(html).toContain(`>${word}<`);
    }
    // The founder's analysis by name (rule 6): "Analysis" alone could be the model's.
    expect(html).toContain('>Founder’s analysis<');
  });

  it('marks Predictions on the league and on the picks to make, Matches on the rest of the matches page', () => {
    pathname = '/en/leaderboard';
    expect(tag(nav(), 'nav-predictions')).toContain('aria-current="page"');
    pathname = '/en/scores';
    search = 'unpicked=1';
    let html = nav();
    expect(tag(html, 'nav-predictions')).toContain('aria-current="page"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    search = 'live=1';
    html = nav();
    expect(tag(html, 'nav-matches')).toContain('aria-current="page"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it('keeps the founder’s analysis and Watch in More, a disclosure', () => {
    const more = /<details class="more-menu[^"]*" data-testid="nav-more">[\s\S]*<\/details>/.exec(
      nav(),
    )?.[0];
    expect(more).toBeDefined();
    expect(ids(more ?? '', 'nav')).toEqual(['more', 'analysis', 'watch']);
    expect(more).toMatch(/<summary[^>]*>/);
  });

  it('is in Persian on /fa, in the same order', () => {
    pathname = '/fa';
    const html = nav('fa');
    expect(ids(html, 'nav')).toEqual(ORDER);
    for (const word of [
      'بازی‌ها',
      'پیش‌بینی‌ها',
      'رقابت‌ها',
      'مدل',
      'هایلایت‌ها',
      'بیشتر',
      'تحلیل بنیان‌گذار',
      'تماشا',
    ]) {
      expect(html).toContain(`>${word}<`);
    }
  });

  it('marks the section of the page current, ink on the raised surface, and only that one', () => {
    pathname = '/en/match/abc';
    const html = nav();
    expect(tag(html, 'nav-matches')).toContain('aria-current="page"');
    expect(tag(html, 'nav-news')).toContain('class="nav-entry"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    // Drawn by its mark, in globals.css: muted, the current one ink on the raised surface.
    const entry = utility('nav-entry');
    expect(entry).toMatch(/@apply [^;]*text-muted/);
    expect(entry).toMatch(
      /&\[aria-current='page'\],\s*&\[data-on\] \{\s*@apply bg-surface-raised font-bold text-fg;/,
    );
  });

  it('marks a page of More in More, with More itself raised', () => {
    pathname = '/en/watch';
    const html = nav();
    expect(tag(html, 'nav-watch')).toContain('aria-current="page"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(/<summary[^>]*>/.exec(html)?.[0]).toContain('data-on=""');
  });

  it('gives every entry a 44px target', () => {
    const html = nav();
    for (const id of ORDER.filter((id) => id !== 'more')) {
      expect(tag(html, `nav-${id}`), id).toContain('nav-entry');
    }
    expect(/<summary[^>]*>/.exec(html)?.[0]).toContain('nav-entry');
    expect(utility('nav-entry')).toMatch(/@apply [^;]*min-h-touch/);
  });

  it('is in the header, which follows the theme (D-267)', () => {
    expect(HEADER).not.toContain('data-mode="editorial"');
    expect(HEADER).toContain('<header className="relative border-b border-default bg-surface');
    expect(HEADER).toMatch(/<PrimaryNav\s/);
    expect(HEADER).toContain(
      '<MatchdayRail locale={locale} timeZone={timeZone} signedIn={me !== null} />',
    );
    expect(HEADER).toContain('data-testid="nav-search"');
    expect(HEADER).toContain('data-testid="nav-search-form"');
    // The mark in both sets of colours, the theme showing one.
    expect(HEADER).toContain('ground="day" className="brand-mark-day');
    expect(HEADER).toContain('ground="night" className="brand-mark-night');
    // The globe and its menu of every offered language (D-281), no longer the other one alone.
    expect(HEADER).toMatch(
      /<LanguagePicker\s+languages=\{[^}]*\)\}\s+label=\{attribute\(lang, 'shell\.language'\)\}\s*\/>/,
    );
  });
});

describe('the bottom tab bar', () => {
  const render = (locale: 'en' | 'fa', signedIn: boolean) =>
    renderToStaticMarkup(
      <BottomTabBar
        locale={locale}
        labels={words(locale, TABS)}
        signedIn={signedIn}
        navLabel={{ text: 'Sections' }}
      />,
    );

  it('has five tabs, Matches, Predict, Leagues, News, You, each an icon and a label', () => {
    const html = render('en', false);
    expect(ids(html, 'tab').filter((id) => id !== 'bar')).toEqual([
      'matches',
      'predict',
      'leagues',
      'news',
      'you',
    ]);
    expect(html.match(/<svg/g)).toHaveLength(5);
    for (const word of ['Matches', 'Predict', 'Leagues', 'News', 'You']) {
      expect(html).toContain(`>${word}<`);
    }
    expect(tag(html, 'tab-leagues')).toContain('href="/en/competitions"');
  });

  it('is in Persian on /fa', () => {
    pathname = '/fa';
    const html = render('fa', false);
    for (const word of ['بازی‌ها', 'پیش‌بینی', 'لیگ‌ها', 'اخبار', 'شما']) {
      expect(html).toContain(`>${word}<`);
    }
  });

  it('marks the current tab saffron and bold, and only that one', () => {
    pathname = '/en/competition/abc';
    const html = render('en', false);
    expect(tag(html, 'tab-leagues')).toContain('aria-current="page"');
    expect(tag(html, 'tab-matches')).not.toContain('aria-current');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    const entry = utility('tab-entry');
    expect(entry).toMatch(/@apply [^;]*text-muted/);
    expect(entry).toMatch(/&\[aria-current='page'\] \{\s*@apply font-extrabold text-accent;/);
  });

  it('marks Matches on the homepage', () => {
    expect(tag(render('en', false), 'tab-matches')).toContain('aria-current="page"');
  });

  it('marks Predict, not Matches, on the picks to make, where it leads (D-281)', () => {
    pathname = '/en/scores';
    search = 'unpicked=1';
    const html = render('en', false);
    expect(tag(html, 'tab-predict')).toContain('href="/en/scores?unpicked=1"');
    expect(tag(html, 'tab-predict')).toContain('aria-current="page"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it('sends You to Sign in for a guest and to Settings for a member', () => {
    expect(tag(render('en', false), 'tab-you')).toContain('href="/en/login"');
    expect(tag(render('en', true), 'tab-you')).toContain('href="/en/settings"');
  });

  it('is for phones alone: fixed to the bottom, gone from 768px, tabs 56px tall, clear of the home indicator', () => {
    const html = render('en', false);
    const bar = /<nav[^>]*data-testid="tab-bar"[^>]*>/.exec(html)?.[0] ?? '';
    expect(bar).toContain('fixed');
    expect(bar).toContain('bottom-0');
    expect(bar).toContain('md:hidden');
    expect(bar).toContain('env(safe-area-inset-bottom)');
    // It follows the theme (D-267).
    expect(bar).not.toContain('data-mode');
    expect(bar).toContain('bg-surface');
    expect(tag(html, 'tab-matches')).toContain('tab-entry');
    expect(utility('tab-entry')).toMatch(/@apply [^;]*min-h-14/);
    // The focus ring inside the tab, where the edge of the screen cannot cut it.
    expect(tag(html, 'tab-matches')).toContain('focus-inset');
  });

  it('ends the page with a spacer of its own height, so no content is hidden under it', () => {
    const html = render('en', false);
    expect(html).toMatch(
      /^<div aria-hidden="true" class="h-\[calc\([^"]*env\(safe-area-inset-bottom\)\)\] md:hidden"><\/div><nav/,
    );
  });

  it('comes after the page in the layout, so it is last in the reading and tab order', () => {
    expect(LAYOUT.indexOf('<SiteTabBar locale={locale} />')).toBeGreaterThan(
      LAYOUT.indexOf('{children}'),
    );
  });
});
