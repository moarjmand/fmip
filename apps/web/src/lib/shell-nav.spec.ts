import { describe, expect, it } from 'vitest';
import { HEADER_NAV, currentLink, localeFreePath, tabBarLinks } from './shell-nav';

/**
 * The shell's navigations (T-1381, D-199): the header's order and targets,
 * the tab bar's, and which entry a page belongs to.
 */

describe('the header nav', () => {
  it('is Today, Scores, Predictions, Analysis, News, Watch, in that order', () => {
    expect(HEADER_NAV.map((link) => link.id)).toEqual([
      'today',
      'scores',
      'predictions',
      'analysis',
      'news',
      'watch',
    ]);
  });

  it('leads to the pages that exist: home, scores, predictions and its analysis, news, watch', () => {
    expect(HEADER_NAV.map((link) => link.path)).toEqual([
      '',
      '/scores',
      '/predictions',
      '/predictions#analysis',
      '/news',
      '/watch',
    ]);
  });

  it('has no Competitions entry while there is no competitions index to lead to', () => {
    expect(HEADER_NAV.some((link) => link.path.startsWith('/competition'))).toBe(false);
  });

  it('marks the section a page belongs to, Today on the homepage alone', () => {
    expect(currentLink('/en', HEADER_NAV)).toBe('today');
    expect(currentLink('/fa/', HEADER_NAV)).toBe('today');
    expect(currentLink('/en/scores', HEADER_NAV)).toBe('scores');
    expect(currentLink('/fa/match/00000000-0000-4000-8000-000000000901', HEADER_NAV)).toBe(
      'scores',
    );
    expect(currentLink('/en/competition/abc', HEADER_NAV)).toBe('scores');
    expect(currentLink('/en/predictions', HEADER_NAV)).toBe('predictions');
    expect(currentLink('/en/leaderboard?min=10', HEADER_NAV)).toBe('predictions');
    expect(currentLink('/en/analyses/abc', HEADER_NAV)).toBe('analysis');
    expect(currentLink('/en/founder/abc', HEADER_NAV)).toBe('analysis');
    expect(currentLink('/en/news/story/1', HEADER_NAV)).toBe('news');
    expect(currentLink('/en/watch', HEADER_NAV)).toBe('watch');
  });

  it('marks nothing on a page outside the sections, and never by a prefix of a word', () => {
    expect(currentLink('/en/search?q=x', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/about', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/newsletter', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/scoresheet', HEADER_NAV)).toBeNull();
  });
});

describe('the bottom tab bar', () => {
  it('is Today, Results, Predictions, News, Me, in that order', () => {
    expect(tabBarLinks(false).map((link) => link.id)).toEqual([
      'today',
      'results',
      'predictions',
      'news',
      'me',
    ]);
  });

  it('sends Me to the settings of a member and to Sign in for a guest', () => {
    expect(tabBarLinks(true).find((link) => link.id === 'me')?.path).toBe('/settings');
    expect(tabBarLinks(false).find((link) => link.id === 'me')?.path).toBe('/login');
  });

  it('marks the tab a page belongs to', () => {
    const tabs = tabBarLinks(true);
    expect(currentLink('/en', tabs)).toBe('today');
    expect(currentLink('/en/scores', tabs)).toBe('results');
    expect(currentLink('/en/match/x', tabs)).toBe('results');
    expect(currentLink('/fa/predictions', tabs)).toBe('predictions');
    expect(currentLink('/fa/analyses/x', tabs)).toBe('predictions');
    expect(currentLink('/en/news', tabs)).toBe('news');
    expect(currentLink('/en/settings', tabs)).toBe('me');
    expect(currentLink('/en/u/someone', tabs)).toBe('me');
    expect(currentLink('/en/login', tabs)).toBe('me');
    expect(currentLink('/en/watch', tabs)).toBeNull();
  });
});

describe('a pathname without its locale', () => {
  it('drops the first segment, a trailing slash, the query and the fragment', () => {
    expect(localeFreePath('/en')).toBe('');
    expect(localeFreePath('/en/')).toBe('');
    expect(localeFreePath('/x-rtl/scores/')).toBe('/scores');
    expect(localeFreePath('/fa/scores?date=2026-10-11#top')).toBe('/scores');
  });
});
