import type { HighlightCompetition, HighlightListItem } from '@fmip/contracts';
import { dayKey } from '@/lib/competition-overview';
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

// ---------------------------------------------------------------------------
// The page's layout (T-1614, D-285): the competitions the filter shows first,
// the featured clip, and the rest by the reader's day. Pure.
// ---------------------------------------------------------------------------

/** How many competition chips the filter shows before "more competitions". */
export const FILTER_LEAD = 11;

/**
 * The filter's competitions, split: the first `lead` (the API sends them by
 * how many clips, most first) are shown, the rest wait behind a disclosure.
 * The picked competition is always among the shown, so the current choice is
 * never hidden.
 */
export function splitFilter(
  competitions: readonly HighlightCompetition[],
  picked: string | null,
  lead = FILTER_LEAD,
): { shown: HighlightCompetition[]; more: HighlightCompetition[] } {
  const shown = competitions.slice(0, lead);
  const more = competitions.slice(lead);
  const at = more.findIndex((c) => c.id === picked);
  if (at === -1) return { shown, more };
  return { shown: [...shown, more[at]!], more: more.filter((_, i) => i !== at) };
}

/**
 * The featured clip: the newest match's, on the first page only, where the
 * list starts. Every other page is the grid alone, so a clip is never shown
 * twice and paging never moves one into the featured place.
 */
export function featuredOf(
  items: readonly HighlightListItem[],
  page: number,
): { featured: HighlightListItem | null; rest: HighlightListItem[] } {
  if (page !== 1 || items.length === 0) return { featured: null, rest: [...items] };
  return { featured: items[0]!, rest: items.slice(1) };
}

export interface HighlightDay {
  /** `YYYY-MM-DD` in the reader's zone. */
  day: string;
  /** The day's clips, in the API's order (newest match first). */
  items: HighlightListItem[];
}

/** The clips by the reader's calendar day of kick-off, days in the order they first appear. */
export function groupByDay(items: readonly HighlightListItem[], timeZone: string): HighlightDay[] {
  const days = new Map<string, HighlightListItem[]>();
  for (const item of items) {
    const day = dayKey(item.fixture.kickoff_at, timeZone);
    const held = days.get(day);
    if (held === undefined) days.set(day, [item]);
    else held.push(item);
  }
  return [...days].map(([day, dayItems]) => ({ day, items: dayItems }));
}

/** `today` or `yesterday` when `day` is one of them in the reader's zone, else `null`. */
export function relativeDay(day: string, today: string): 'today' | 'yesterday' | null {
  if (day === today) return 'today';
  const before = new Date(`${today}T12:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  return day === before.toISOString().slice(0, 10) ? 'yesterday' : null;
}
