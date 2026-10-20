import { readTerritoryQuery } from '@/lib/viewing';

/**
 * The Highlights page's address (T-1434, D-226): the competition filter, the
 * page and a guest's territory, read from the query and written back into
 * every link, so a filtered page is an address to share. Pure.
 */

type Params = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most pages the API answers (`MAX_PAGE` in its controller). */
export const HIGHLIGHTS_MAX_PAGE = 500;

export interface HighlightsQuery {
  competition: string | undefined;
  page: number;
  territory: string | undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

/** The query as the page reads it: a value that cannot be one is dropped, never sent on. */
export function readHighlightsQuery(params: Params): HighlightsQuery {
  const competition = first(params.competition);
  const page = first(params.page);
  const n = page !== undefined && /^\d{1,3}$/.test(page) ? Number(page) : 1;
  return {
    competition:
      competition !== undefined && UUID.test(competition) ? competition.toLowerCase() : undefined,
    page: n >= 1 && n <= HIGHLIGHTS_MAX_PAGE ? n : 1,
    territory: readTerritoryQuery(params),
  };
}

/** The API's query for this page. */
export function highlightsApiQuery(q: HighlightsQuery): string {
  const p = new URLSearchParams();
  if (q.competition !== undefined) p.set('competition', q.competition);
  if (q.page > 1) p.set('page', String(q.page));
  if (q.territory !== undefined) p.set('territory', q.territory);
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

/**
 * The page's own address with some of it changed. Picking a competition goes
 * back to page 1; the territory travels only where a guest carried one.
 */
export function highlightsHref(
  locale: string,
  q: HighlightsQuery,
  over: { competition?: string | null; page?: number } = {},
): string {
  const competition =
    over.competition === undefined ? q.competition : (over.competition ?? undefined);
  const page = over.page ?? (over.competition === undefined ? q.page : 1);
  const s = highlightsApiQuery({ competition, page, territory: q.territory });
  return `/${locale}/highlights${s}`;
}

/** How many pages `total` clips fill; at least one, so "page 1 of 1" is said for an empty list. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}
