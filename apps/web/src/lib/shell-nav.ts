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
 * The header's nav, in the order the Hybrid header gives (D-199): Today,
 * Scores, Predictions, Analysis, News, Watch, then Highlights (T-1434,
 * D-226), the page of every highlight link. The board's "Competitions" is
 * the competitions bar under the header instead (T-1433, D-225), whose
 * "All competitions" leads to `/competitions`. Analysis
 * is the founder's analysis, which is published on the Predictions page; its
 * own sections (`/analyses/<id>`, `/founder/<id>`) make it current.
 */
export const HEADER_NAV: readonly ShellLink[] = [
  { id: 'today', path: '', match: [''] },
  { id: 'scores', path: '/scores', match: ['/scores', '/match', '/competition'] },
  {
    id: 'predictions',
    path: '/predictions',
    match: ['/predictions', '/leaderboard', '/model-accuracy'],
  },
  { id: 'analysis', path: '/predictions#analysis', match: ['/analyses', '/founder'] },
  { id: 'news', path: '/news', match: ['/news'] },
  { id: 'watch', path: '/watch', match: ['/watch'] },
  { id: 'highlights', path: '/highlights', match: ['/highlights'] },
];

/** The member's own pages: where "Me" is current. */
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
 * The bottom tab bar, phones only (D-199): Today, Results, Predictions, News,
 * Me. "Me" is the member's settings, or Sign in for a guest.
 */
export function tabBarLinks(signedIn: boolean): readonly ShellLink[] {
  return [
    { id: 'today', path: '', match: [''] },
    { id: 'results', path: '/scores', match: ['/scores', '/match', '/competition'] },
    {
      id: 'predictions',
      path: '/predictions',
      match: ['/predictions', '/leaderboard', '/model-accuracy', '/analyses', '/founder'],
    },
    { id: 'news', path: '/news', match: ['/news'] },
    { id: 'me', path: signedIn ? '/settings' : '/login', match: ME_SECTIONS },
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
