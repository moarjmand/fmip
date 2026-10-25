/**
 * The site shell's two navigations (T-1381, D-199): the header's nav and the
 * phone's bottom tab bar. Pure, so the order, the targets and which entry is
 * current are unit-tested (`shell-nav.spec.ts`); the client components that
 * draw them (`shell-nav.tsx`) only add the pathname.
 *
 * A path is the locale-free part of a URL: `''` is the homepage, `/scores`
 * the scores page. `match` lists the sections an entry stands for: a path is
 * in a section when it is the section or below it (`/match` covers
 * `/match/<id>`); `''` matches the homepage alone.
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
 * Where Predictions and Predict lead (T-1519, D-269): the matches page's "Not
 * picked yet" view. A guest has no picks, so the page shows them every match,
 * each Pick asking them to sign in.
 */
const PICKS = '/scores?unpicked=1';

/** Every page under Competitions and Leagues: the directory, a competition, a club, a player, a coach. */
const LEAGUES = ['/competitions', '/competition', '/team', '/player', '/coach'];

/**
 * The header's nav, in the order the Stadiomind header gives (D-263, D-267):
 * Matches, Predictions, Competitions, The model, News. The wordmark leads
 * home, so the homepage has no entry of its own. Matches is the scores page
 * and the matches below it; Competitions the directory and every
 * competition, club, player and coach page; The model the model's record.
 * Predictions leads to the matches still to pick (T-1519, D-269: picks are
 * made on the matches page) and is current on the prediction league.
 */
export const HEADER_NAV: readonly ShellLink[] = [
  { id: 'matches', path: '/scores', match: ['/scores', '/match'] },
  { id: 'predictions', path: PICKS, match: ['/leaderboard'] },
  {
    id: 'competitions',
    path: '/competitions',
    match: LEAGUES,
  },
  { id: 'model', path: '/model-accuracy', match: ['/model-accuracy'] },
  { id: 'news', path: '/news', match: ['/news'] },
];

/**
 * The header's More (D-267): the sections the Design System's header has no
 * place for, kept one click away rather than dropped. Each is current on its
 * own pages, and More shows it; the header's five do not claim them, so a
 * page has one current link.
 */
export const MORE_NAV: readonly ShellLink[] = [
  { id: 'analysis', path: '/scores#analysis', match: ['/analyses', '/founder'] },
  { id: 'watch', path: '/watch', match: ['/watch'] },
  { id: 'highlights', path: '/highlights', match: ['/highlights'] },
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
 * home shows it; "You" is the member's settings, or Sign in for a guest.
 */
export function tabBarLinks(signedIn: boolean): readonly ShellLink[] {
  return [
    { id: 'matches', path: '/scores', match: ['', '/scores', '/match', '/watch'] },
    {
      id: 'predict',
      path: PICKS,
      match: ['/leaderboard', '/model-accuracy', '/analyses', '/founder'],
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

/** The id of the entry the page belongs to, or `null` (search, about, a 404). */
export function currentLink(pathname: string, links: readonly ShellLink[]): string | null {
  const path = localeFreePath(pathname);
  return links.find((link) => link.match.some((section) => inSection(path, section)))?.id ?? null;
}
