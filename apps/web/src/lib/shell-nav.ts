/**
 * The site shell's navigations (T-1381, D-199; T-1610, D-281): the header's
 * nav, the phone's bottom tab bar and the site footer's links. Pure, so the
 * order, the targets and which entry is current are unit-tested
 * (`shell-nav.spec.ts`); the client components that draw the first two
 * (`shell-nav.tsx`) only add the pathname and the query.
 *
 * A path is the locale-free part of a URL: `''` is the homepage, `/scores`
 * the scores page. `match` lists the sections an entry stands for: a path is
 * in a section when it is the section or below it (`/match` covers
 * `/match/<id>`); `''` matches the homepage alone. A section may carry a
 * query (`/scores?unpicked=1`): it is that page in that view alone, and it
 * wins over a section without one, so the picks to make belong to
 * Predictions while the rest of the matches page belongs to Matches.
 */

export interface ShellLink {
  /** Stable name: the `data-testid` suffix and the label's lookup. */
  id: string;
  /** Where the entry leads, without the locale. May carry a `#fragment`. */
  path: string;
  /** The sections that make the entry current. */
  match: readonly string[];
}

/**
 * The matches page's "Not picked yet" view (T-1519, D-269), where picks are
 * made: the prediction league's "Make your picks" and the phone's Predict
 * tab lead there. A guest has no picks, so the page shows them every match,
 * each Pick asking them to sign in.
 */
export const PICKS_PATH = '/scores?unpicked=1';

/** Every page under Competitions and Leagues: the directory, a competition, a club, a player, a coach. */
const LEAGUES = ['/competitions', '/competition', '/team', '/player', '/coach'];

/**
 * The header's nav (D-281, amending D-267 and D-269): Matches, Competitions,
 * Predictions, The model, News, Highlights -- football first, then the
 * members' predictions and the model, then what to read and watch. The
 * wordmark leads home, so the homepage has no entry of its own.
 *
 * Each entry leads to a page of its own, and is current there: Predictions
 * is the prediction league (it led to the matches page, where Matches was
 * then the current entry), and the picks to make are its view of the
 * matches page. Highlights, a full page of clips, is no longer under More.
 */
export const HEADER_NAV: readonly ShellLink[] = [
  { id: 'matches', path: '/scores', match: ['/scores', '/match'] },
  { id: 'competitions', path: '/competitions', match: LEAGUES },
  { id: 'predictions', path: '/leaderboard', match: ['/leaderboard', PICKS_PATH] },
  { id: 'model', path: '/model-accuracy', match: ['/model-accuracy'] },
  { id: 'news', path: '/news', match: ['/news'] },
  { id: 'highlights', path: '/highlights', match: ['/highlights'] },
];

/**
 * The header's More (D-267, D-281): the founder's analysis, whose latest
 * pieces are a section of the matches page (there is no page of them alone),
 * and Watch. Each is current on its own pages, and More shows it; the
 * header's six do not claim them, so a page has one current link. What
 * Stadiomind is and its rules are site information, not sections: they are
 * in the site footer (`FOOTER_NAV`).
 */
export const MORE_NAV: readonly ShellLink[] = [
  { id: 'analysis', path: '/scores#analysis', match: ['/analyses', '/founder'] },
  { id: 'watch', path: '/watch', match: ['/watch'] },
];

/** The member's own pages: where "You" is current. */
const ME_SECTIONS = [
  '/settings',
  '/u',
  '/following',
  '/friends',
  '/messages',
  '/groups',
  '/notifications',
  '/login',
  '/register',
] as const;

/**
 * The bottom tab bar, phones only (D-263, D-267): Matches, Predict, Leagues,
 * News, You. Matches is current on the homepage too, as the canvas's phone
 * home shows it; Predict leads to the picks to make, and is current there
 * (D-281) and on the league, the model's record and the founder's analysis;
 * "You" is the member's settings, or Sign in for a guest.
 */
export function tabBarLinks(signedIn: boolean): readonly ShellLink[] {
  return [
    { id: 'matches', path: '/scores', match: ['', '/scores', '/match', '/watch'] },
    {
      id: 'predict',
      path: PICKS_PATH,
      match: [PICKS_PATH, '/leaderboard', '/model-accuracy', '/analyses', '/founder'],
    },
    {
      id: 'leagues',
      path: '/competitions',
      match: LEAGUES,
    },
    { id: 'news', path: '/news', match: ['/news', '/highlights'] },
    { id: 'you', path: signedIn ? '/settings' : '/login', match: ME_SECTIONS },
  ];
}

/** A link of the site footer: where it leads; its id names its words and its test id. */
export interface FooterLink {
  id:
    | 'matches'
    | 'competitions'
    | 'highlights'
    | 'watch'
    | 'news'
    | 'league'
    | 'model'
    | 'analysis'
    | 'about'
    | 'rules';
  path: string;
}

/** A column of the site footer, under its heading. */
export interface FooterGroup {
  id: 'football' | 'predictions' | 'site';
  links: readonly FooterLink[];
}

/**
 * The site footer's links (T-1610, D-281): every section once more at the
 * end of every page, in three columns. Football: the matches, the
 * competitions, highlights, where to watch, news. Predictions: the
 * prediction league, the model's record and the founder's analysis, each
 * under its own name and never as one (rule 6). Stadiomind: what it is and
 * its rules, which are linked from nowhere else (T-1572).
 */
export const FOOTER_NAV: readonly FooterGroup[] = [
  {
    id: 'football',
    links: [
      { id: 'matches', path: '/scores' },
      { id: 'competitions', path: '/competitions' },
      { id: 'highlights', path: '/highlights' },
      { id: 'watch', path: '/watch' },
      { id: 'news', path: '/news' },
    ],
  },
  {
    id: 'predictions',
    links: [
      { id: 'league', path: '/leaderboard' },
      { id: 'model', path: '/model-accuracy' },
      { id: 'analysis', path: '/scores#analysis' },
    ],
  },
  {
    id: 'site',
    links: [
      { id: 'about', path: '/about' },
      { id: 'rules', path: '/rules' },
    ],
  },
];

/** `/fa/scores?d=1` → `/scores`; `/fa` → `''`. The first segment is the locale. */
export function localeFreePath(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? '';
  const rest = path.replace(/^\/[^/]*/, '');
  return rest === '/' ? '' : rest.replace(/\/+$/, '');
}

function inSection(path: string, section: string): boolean {
  if (section === '') return path === '';
  return path === section || path.startsWith(`${section}/`);
}

/** A section with a query: that page exactly, with every one of its parameters set as it says. */
function inView(path: string, query: URLSearchParams, section: string): boolean {
  const [page = '', wanted = ''] = section.split('?', 2);
  if (path !== page) return false;
  return [...new URLSearchParams(wanted)].every(([key, value]) => query.get(key) === value);
}

/**
 * The id of the entry the page belongs to, or `null` (search, about, a 404).
 * `search` is the page's query (`unpicked=1`, with or without the `?`): a
 * section that names a view of a page wins over the page itself.
 */
export function currentLink(
  pathname: string,
  links: readonly ShellLink[],
  search = '',
): string | null {
  const path = localeFreePath(pathname);
  const query = new URLSearchParams(search);
  const view = links.find((link) =>
    link.match.some((section) => section.includes('?') && inView(path, query, section)),
  );
  if (view !== undefined) return view.id;
  return (
    links.find((link) =>
      link.match.some((section) => !section.includes('?') && inSection(path, section)),
    )?.id ?? null
  );
}
