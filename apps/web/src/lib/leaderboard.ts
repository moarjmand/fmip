import type { LeaderboardEntry, RatingTier } from '@fmip/contracts';

/**
 * The leaderboard page's pure helpers (T-055): reading the minimum-sample
 * filter and page from the URL, the API query, the links that keep state,
 * and how an entry reads. No fetching here, so all of it is unit-tested.
 */

export const PAGE_SIZE = 50;

export interface LeaderboardPageQuery {
  /** The minimum-sample filter, or null for the API's floor. */
  min: number | null;
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function positiveInteger(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,9}$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

/** `?min=50&page=2`. A missing or bad value means the default, never an error page. */
export function readLeaderboardQuery(params: SearchParams): LeaderboardPageQuery {
  return {
    min: positiveInteger(first(params.min)),
    page: positiveInteger(first(params.page)) ?? 1,
  };
}

/** The `GET /leaderboard` query string for this page. */
export function apiQuery(q: LeaderboardPageQuery): string {
  const params = new URLSearchParams();
  if (q.min !== null) params.set('min_settled', String(q.min));
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String((q.page - 1) * PAGE_SIZE));
  return params.toString();
}

/** A link to the page with some of the state changed; page one and the floor need no parameter. */
export function pageHref(
  locale: string,
  q: LeaderboardPageQuery,
  change: Partial<LeaderboardPageQuery>,
): string {
  const next = { ...q, ...change };
  const params = new URLSearchParams();
  if (next.min !== null) params.set('min', String(next.min));
  if (next.page > 1) params.set('page', String(next.page));
  const query = params.toString();
  return `/${locale}/leaderboard${query === '' ? '' : `?${query}`}`;
}

/** How many pages a board of `total` entries has, at least one. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function tierLabel(tier: RatingTier): string {
  switch (tier) {
    case 'bronze':
      return 'Bronze';
    case 'silver':
      return 'Silver';
    case 'gold':
      return 'Gold';
    case 'platinum':
      return 'Platinum';
    case 'elite':
      return 'Elite';
  }
}

/** One decimal, always: 72 reads as "72.0" so the column lines up and the precision is honest. */
export function ratingLabel(entry: Pick<LeaderboardEntry, 'rating'>): string {
  return entry.rating.toFixed(1);
}

/** Established, or provisional (never on the board, but the API says so), or neither. */
export function statusLabel(entry: Pick<LeaderboardEntry, 'provisional' | 'established'>): string {
  if (entry.established) return 'Established';
  if (entry.provisional) return 'Provisional';
  return 'Building';
}
