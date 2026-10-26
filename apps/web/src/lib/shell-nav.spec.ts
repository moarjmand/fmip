import { describe, expect, it } from 'vitest';
import {
  FOOTER_NAV,
  HEADER_NAV,
  MORE_NAV,
  PICKS_PATH,
  currentLink,
  localeFreePath,
  tabBarLinks,
} from './shell-nav';

/**
 * The shell's navigations (T-1381, D-199; Stadiomind, T-1494, D-267; T-1610,
 * D-281): the header's order and targets, the tab bar's, the footer's, and
 * which entry a page belongs to.
 */

describe('the header nav', () => {
  it('is Matches, Competitions, Predictions, The model, News, Highlights, in that order (D-281)', () => {
    expect(HEADER_NAV.map((link) => link.id)).toEqual([
      'matches',
      'competitions',
      'predictions',
      'model',
      'news',
      'highlights',
    ]);
  });

  it('leads each entry to a page of its own: Predictions to the prediction league', () => {
    expect(HEADER_NAV.map((link) => link.path)).toEqual([
      '/scores',
      '/competitions',
      '/leaderboard',
      '/model-accuracy',
      '/news',
      '/highlights',
    ]);
    // Only Matches and the founder's analysis, a section of the matches
    // page with no page of its own, lead to the matches page (D-281).
    const pages = [...HEADER_NAV, ...MORE_NAV].map((link) => link.path.split(/[?#]/)[0]);
    expect(pages.filter((page) => page === '/scores')).toHaveLength(2);
    expect(MORE_NAV.find((link) => link.path.startsWith('/scores'))?.id).toBe('analysis');
  });

  it('keeps only the founder’s analysis and Watch under More', () => {
    expect(MORE_NAV.map((link) => [link.id, link.path])).toEqual([
      ['analysis', '/scores#analysis'],
      ['watch', '/watch'],
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
    expect(currentLink('/en/leaderboard', HEADER_NAV, 'min=10')).toBe('predictions');
    expect(currentLink('/en/model-accuracy', HEADER_NAV)).toBe('model');
    expect(currentLink('/en/news/story/1', HEADER_NAV)).toBe('news');
    expect(currentLink('/fa/highlights', HEADER_NAV, 'page=2')).toBe('highlights');
  });

  it('gives the picks to make to Predictions, and the rest of the matches page to Matches', () => {
    expect(PICKS_PATH).toBe('/scores?unpicked=1');
    expect(currentLink('/en/scores', HEADER_NAV, 'unpicked=1')).toBe('predictions');
    expect(currentLink('/fa/scores', HEADER_NAV, '?date=2026-10-26&unpicked=1')).toBe(
      'predictions',
    );
    expect(currentLink('/en/scores', HEADER_NAV, 'unpicked=0')).toBe('matches');
    expect(currentLink('/en/scores', HEADER_NAV, 'live=1')).toBe('matches');
    // A view is that page alone, not the pages below it.
    expect(currentLink('/en/match/abc', HEADER_NAV, 'unpicked=1')).toBe('matches');
  });

  it('leaves the pages of More to More, so a page has one current link', () => {
    for (const path of ['/en/analyses/abc', '/en/founder/abc', '/en/watch']) {
      expect(currentLink(path, HEADER_NAV)).toBeNull();
    }
    expect(currentLink('/en/analyses/abc', MORE_NAV)).toBe('analysis');
    expect(currentLink('/en/founder/abc', MORE_NAV)).toBe('analysis');
    expect(currentLink('/en/watch', MORE_NAV)).toBe('watch');
    expect(currentLink('/fa/highlights', MORE_NAV)).toBeNull();
  });

  it('marks nothing on a page outside the sections, and never by a prefix of a word', () => {
    expect(currentLink('/en/search?q=x', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/about', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/rules', MORE_NAV)).toBeNull();
    expect(currentLink('/en/newsletter', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/scoresheet', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/teams', HEADER_NAV)).toBeNull();
    expect(currentLink('/en/highlightsx', HEADER_NAV)).toBeNull();
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

  it('leads Predict to the picks to make, and marks it there rather than Matches (D-281)', () => {
    const tabs = tabBarLinks(false);
    expect(tabs.find((link) => link.id === 'predict')?.path).toBe(PICKS_PATH);
    expect(currentLink('/en/scores', tabs, 'unpicked=1')).toBe('predict');
    expect(currentLink('/en/scores', tabs, 'date=2026-10-26')).toBe('matches');
  });
});

describe('the site footer', () => {
  it('lists every section in three columns: Football, Predictions, Stadiomind (D-281)', () => {
    expect(FOOTER_NAV.map((group) => [group.id, group.links.map((link) => link.id)])).toEqual([
      ['football', ['matches', 'competitions', 'highlights', 'watch', 'news']],
      ['predictions', ['league', 'model', 'analysis']],
      ['site', ['about', 'rules']],
    ]);
  });

  it('keeps What Stadiomind is and the rules reachable, now that More does not carry them', () => {
    const paths = FOOTER_NAV.flatMap((group) => group.links.map((link) => link.path));
    expect(paths).toEqual(expect.arrayContaining(['/about', '/rules']));
    for (const link of [...HEADER_NAV, ...MORE_NAV]) expect(paths).toContain(link.path);
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
