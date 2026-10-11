import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Message, message } from '@/i18n/messages';
import { BottomTabBar, PrimaryNav } from './shell-nav';

/**
 * The header's nav and the phone's tab bar (T-1381, D-199), drawn: the
 * order, the current entry, the words in Persian, and the tab bar's place
 * (phones only, fixed, clear of the home indicator, never over content).
 */

let pathname = '/en';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const HEADER = readFileSync(join(__dirname, 'site-header.tsx'), 'utf8');
const LAYOUT = readFileSync(join(__dirname, '..', 'app', '[locale]', 'layout.tsx'), 'utf8');

const words = (locale: 'en' | 'fa', keys: Record<string, Parameters<typeof message>[1]>) =>
  Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, message(locale, key)])) as Record<
    string,
    Message
  >;

const NAV = {
  today: 'shell.nav.today',
  scores: 'nav.scores',
  predictions: 'nav.predictions',
  analysis: 'shell.nav.analysis',
  news: 'shell.nav.news',
  watch: 'nav.watch',
} as const;

const TABS = {
  today: 'shell.nav.today',
  results: 'shell.tab.results',
  predictions: 'shell.tab.predictions',
  news: 'shell.tab.news',
  me: 'shell.tab.me',
} as const;

/** The `data-testid`s with a prefix, in document order. */
const ids = (html: string, prefix: string): string[] =>
  [...html.matchAll(new RegExp(`data-testid="${prefix}-([a-z]+)"`, 'g'))].map((m) => m[1]!);

/** The opening tag of the element with this test id. */
const tag = (html: string, testId: string): string =>
  new RegExp(`<a[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

beforeEach(() => {
  pathname = '/en';
});

describe('the header nav', () => {
  it('reads Today, Scores, Predictions, Analysis, News, Watch, each to its page', () => {
    const html = renderToStaticMarkup(<PrimaryNav locale="en" labels={words('en', NAV)} />);
    expect(ids(html, 'nav')).toEqual([
      'today',
      'scores',
      'predictions',
      'analysis',
      'news',
      'watch',
    ]);
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      '/en',
      '/en/scores',
      '/en/predictions',
      '/en/predictions#analysis',
      '/en/news',
      '/en/watch',
    ]);
    expect(html).toContain('>Today<');
    expect(html).toContain('>Analysis<');
  });

  it('is in Persian on /fa, in the same order', () => {
    pathname = '/fa';
    const html = renderToStaticMarkup(<PrimaryNav locale="fa" labels={words('fa', NAV)} />);
    expect(ids(html, 'nav')).toEqual([
      'today',
      'scores',
      'predictions',
      'analysis',
      'news',
      'watch',
    ]);
    for (const word of ['امروز', 'نتایج', 'پیش‌بینی‌ها', 'تحلیل', 'خبر', 'تماشا']) {
      expect(html).toContain(`>${word}<`);
    }
  });

  it('marks the page’s section current, in brand green with the bar under it', () => {
    pathname = '/en/match/abc';
    const html = renderToStaticMarkup(<PrimaryNav locale="en" labels={words('en', NAV)} />);
    expect(tag(html, 'nav-scores')).toContain('aria-current="page"');
    expect(tag(html, 'nav-scores')).toContain('text-accent');
    expect(tag(html, 'nav-scores')).toContain('shadow-[inset_0_-3px_0_var(--token-accent)]');
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it('is in the header, which stays on paper with a double rule under it', () => {
    expect(HEADER).toContain('<header data-mode="editorial"');
    expect(HEADER).toContain('border-b-[3px] border-double border-fg');
    expect(HEADER).toMatch(/<PrimaryNav\s/);
    expect(HEADER).toContain('<LiveStrip locale={locale} timeZone={timeZone} />');
    expect(HEADER).toContain('data-testid="nav-search"');
    // The other language only, each in its own name.
    expect(HEADER).toMatch(/<LanguagePicker[\s\S]*?others\s*\/>/);
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

  it('has five tabs, Today, Results, Predictions, News, Me, each an icon and a label', () => {
    const html = render('en', false);
    expect(ids(html, 'tab').filter((id) => id !== 'bar')).toEqual([
      'today',
      'results',
      'predictions',
      'news',
      'me',
    ]);
    expect(html.match(/<svg/g)).toHaveLength(5);
    // "Scores", as the desktop nav says it (T-1391).
    for (const word of ['Today', 'Scores', 'Predictions', 'News', 'Me']) {
      expect(html).toContain(`>${word}<`);
    }
  });

  it('is in Persian on /fa', () => {
    pathname = '/fa';
    const html = render('fa', false);
    for (const word of ['امروز', 'نتایج', 'پیش‌بینی', 'اخبار', 'من']) {
      expect(html).toContain(`>${word}<`);
    }
  });

  it('marks the current tab in brand green with a bar along its top, and only that one', () => {
    pathname = '/en/scores';
    const html = render('en', false);
    expect(tag(html, 'tab-results')).toContain('aria-current="page"');
    expect(tag(html, 'tab-results')).toContain('text-accent');
    expect(tag(html, 'tab-results')).toContain('shadow-[inset_0_3px_0_var(--token-accent)]');
    expect(tag(html, 'tab-today')).not.toContain('aria-current');
    expect(tag(html, 'tab-today')).toContain('text-muted');
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it('sends Me to Sign in for a guest and to Settings for a member', () => {
    expect(tag(render('en', false), 'tab-me')).toContain('href="/en/login"');
    expect(tag(render('en', true), 'tab-me')).toContain('href="/en/settings"');
  });

  it('is a phone’s alone: fixed to the bottom, gone from 768px, tabs 56px tall, clear of the home indicator', () => {
    const html = render('en', false);
    const bar = /<nav[^>]*data-testid="tab-bar"[^>]*>/.exec(html)?.[0] ?? '';
    expect(bar).toContain('fixed');
    expect(bar).toContain('bottom-0');
    expect(bar).toContain('md:hidden');
    expect(bar).toContain('env(safe-area-inset-bottom)');
    expect(bar).toContain('data-mode="editorial"');
    expect(tag(html, 'tab-today')).toContain('min-h-14');
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
