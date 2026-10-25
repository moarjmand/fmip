import { describe, expect, it } from 'vitest';
import { HEADER_NAV, MORE_NAV, currentLink, localeFreePath, tabBarLinks } from './shell-nav';

/**
 * The shell's navigations (T-1381, D-199; Stadiomind, T-1494, D-267): the header's order and targets,
 * the tab bar's, and which entry a page belongs to.
 */

describe('the header nav', () => {
  it('is Matches, Predictions, Competitions, The model, News, in that order (D-267)', () => {
    expect(HEADER_NAV.map((link) => link.id)).toEqual([
      'matches',
      'predictions',
      'competitions',
      'model',
      'news',
    ]);
  });

  it('leads to the pages that exist: scores, the picks to make, the directory, the model, news', () => {
    expect(HEADER_NAV.map((link) => link.path)).toEqual([
      '/scores',
      '/scores?unpicked=1',
      '/competitions',
      '/model-accuracy',
      '/news',
    ]);
  });

  it('keeps the analysis, Watch and Highlights under More', () => {
    expect(MORE_NAV.map((link) => [link.id, link.path])).toEqual([
      ['analysis', '/scores#analysis'],
      ['watch', '/watch'],
      ['highlights', '/highlights'],
    ]);
  });

  it('marks the section a page belongs to, and nothing on the homepage', () => {
    expect(currentLink('/en', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/scores', HEADER_NAV)).toBe('matches');
    expect(currentLink('/fa/match/00000000-0000-4000-8000-000000000901', HEADER_NAV)).toBe(
      'matches',
    );
    expect(currentLink('/en/competitions', HEADER_NAV)).toBe('competitions');
    expect(currentLink('/en/competition/abc', HEADER_NAV)).toBe('competitions');
    expect(currentLink('/en/team/abc', HEADER_NAV)).toBe('competitions');
    expect(currentLink('/en/player/abc', HEADER_NAV)).toBe('competitions');
    // Picks are made on the matches page (T-1519): Matches is current there.
    expect(currentLink('/en/scores?unpicked=1', HEADER_NAV)).toBe('matches');
    expect(currentLink('/en/leaderboard?min=10', HEADER_NAV)).toBe('predictions');
    expect(currentLink('/en/model-accuracy', HEADER_NAV)).toBe('model');
    expect(currentLink('/en/news/story/1', HEADER_NAV)).toBe('news');
  });

  it('leaves the pages of More to More, so a page has one current link', () => {
    for (const path of [
      '/en/analyses/abc',
      '/en/founder/abc',
      '/en/watch',
      '/fa/highlights?page=2',
    ]) {
      expect(currentLink(path, HEADER_NAV)).toBeNull();
    }
    expect(currentLink('/en/analyses/abc', MORE_NAV)).toBe('analysis');
    expect(currentLink('/en/founder/abc', MORE_NAV)).toBe('analysis');
    expect(currentLink('/en/watch', MORE_NAV)).toBe('watch');
    expect(currentLink('/fa/highlights?page=2', MORE_NAV)).toBe('highlights');
  });

  it('marks nothing on a page outside the sections, and never by a prefix of a word', () => {
    expect(currentLink('/en/search?q=x', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/about', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/newsletter', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/scoresheet', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/teams', HEADER_NAV)).toBeNull();
  });
});

describe('the bottom tab bar', () => {
  it('is Matches, Predict, Leagues, News, You, in that order (D-263)', () => {
    expect(tabBarLinks(false).map((link) => link.id)).toEqual([
      'matches',
      'predict',
      'leagues',
      'news',
      'you',
    ]);
  });

  it('sends You to the settings of a member and to Sign in for a guest', () => {
    expect(tabBarLinks(true).find((link) => link.id === 'you')?.path).toBe('/settings');
    expect(tabBarLinks(false).find((link) => link.id === 'you')?.path).toBe('/login');
  });

  it('marks the tab a page belongs to, Matches on the homepage too', () => {
    const tabs = tabBarLinks(true);
    expect(currentLink('/en', tabs)).toBe('matches');
    expect(currentLink('/en/scores', tabs)).toBe('matches');
    expect(currentLink('/en/match/x', tabs)).toBe('matches');
    expect(currentLink('/en/watch', tabs)).toBe('matches');
    expect(currentLink('/fa/leaderboard', tabs)).toBe('predict');
    expect(tabs.find((link) => link.id === 'predict')?.path).toBe('/scores?unpicked=1');
    expect(currentLink('/fa/analyses/x', tabs)).toBe('predict');
    expect(currentLink('/en/model-accuracy', tabs)).toBe('predict');
    expect(currentLink('/en/competitions', tabs)).toBe('leagues');
    expect(currentLink('/en/competition/x', tabs)).toBe('leagues');
    expect(currentLink('/en/team/x', tabs)).toBe('leagues');
    expect(currentLink('/en/player/x', tabs)).toBe('leagues');
    expect(currentLink('/en/news', tabs)).toBe('news');
    expect(currentLink('/en/highlights', tabs)).toBe('news');
    expect(currentLink('/en/settings', tabs)).toBe('you');
    expect(currentLink('/en/u/someone', tabs)).toBe('you');
    expect(currentLink('/en/login', tabs)).toBe('you');
    expect(currentLink('/en/search', tabs)).toBeNull();
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
