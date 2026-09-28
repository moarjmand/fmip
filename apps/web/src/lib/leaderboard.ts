import type {
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardPeriodKind,
  LeaderboardResponse,
  LeaderboardScope,
  RatingTier,
} from '@fmip/contracts';

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
  /** T-641: everyone, or the viewer and their friends. */
  scope: LeaderboardScope;
  /** T-641: the current rating, or a rating over one month's or one season's settlements. */
  period: LeaderboardPeriodKind;
  /** `YYYY-MM`, only with `period: 'month'`; null means the API's default (this month). */
  month: string | null;
  /** A season label, only with `period: 'season'`; null means the newest season. */
  season: string | null;
  /** T-843: a competition id, to rate only its settlements; null for every competition. */
  competition: string | null;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function positiveInteger(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,9}$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

const MONTH = /^2\d{3}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?min=50&page=2&scope=friends&period=month&month=2026-09`. A missing or bad
 * value means the default, never an error page; a month or season without its
 * period is dropped rather than sent for the API to refuse.
 */
export function readLeaderboardQuery(params: SearchParams): LeaderboardPageQuery {
  const scope = first(params.scope);
  const period = first(params.period);
  const kind: LeaderboardPeriodKind = period === 'month' || period === 'season' ? period : 'all';
  const month = first(params.month);
  const season = first(params.season);
  const competition = first(params.competition);
  return {
    min: positiveInteger(first(params.min)),
    page: positiveInteger(first(params.page)) ?? 1,
    scope: scope === 'friends' ? 'friends' : 'everyone',
    period: kind,
    month: kind === 'month' && month !== undefined && MONTH.test(month) ? month : null,
    season: kind === 'season' && season !== undefined && season.length <= 32 ? season : null,
    competition:
      competition !== undefined && UUID.test(competition) ? competition.toLowerCase() : null,
  };
}

/** The `GET /leaderboard` query string for this page. */
export function apiQuery(q: LeaderboardPageQuery): string {
  const params = new URLSearchParams();
  if (q.min !== null) params.set('min_settled', String(q.min));
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String((q.page - 1) * PAGE_SIZE));
  if (q.scope !== 'everyone') params.set('scope', q.scope);
  if (q.period !== 'all') params.set('period', q.period);
  if (q.period === 'month' && q.month !== null) params.set('month', q.month);
  if (q.period === 'season' && q.season !== null) params.set('season', q.season);
  if (q.competition !== null) params.set('competition', q.competition);
  return params.toString();
}

/**
 * A link to the page with some of the state changed; page one, the floor,
 * everyone and all time need no parameter. Changing the period drops a month
 * or season that belonged to the old one.
 */
export function pageHref(
  locale: string,
  q: LeaderboardPageQuery,
  change: Partial<LeaderboardPageQuery>,
): string {
  const next = { ...q, ...change };
  const params = new URLSearchParams();
  if (next.scope !== 'everyone') params.set('scope', next.scope);
  if (next.period !== 'all') params.set('period', next.period);
  if (next.period === 'month' && next.month !== null) params.set('month', next.month);
  if (next.period === 'season' && next.season !== null) params.set('season', next.season);
  if (next.competition !== null) params.set('competition', next.competition);
  if (next.min !== null) params.set('min', String(next.min));
  if (next.page > 1) params.set('page', String(next.page));
  const query = params.toString();
  return `/${locale}/leaderboard${query === '' ? '' : `?${query}`}`;
}

/** `2026-09` as "September 2026", in UTC so the name is the month the API rated. */
export function monthLabel(month: string, locale = 'en'): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, index - 1, 1)));
}

/**
 * What the board ranks, as the sentence under the switcher says it. With a
 * competition (T-843), only its fixtures' settlements are rated.
 */
export function periodSentence(
  period: LeaderboardPeriod,
  locale = 'en',
  competition: string | null = null,
): string {
  const where = competition === null ? '' : ` on ${competition} fixtures`;
  switch (period.kind) {
    case 'all':
      return competition === null
        ? 'Ranked by current Performance Rating'
        : `Ranked by the Performance Rating computed over predictions${where} only`;
    case 'month':
      return `Ranked by the Performance Rating computed over predictions${where} settled in ${monthLabel(period.month, locale)} (UTC) only`;
    case 'season':
      return period.label === null
        ? 'No season has a settled prediction yet'
        : competition === null
          ? `Ranked by the Performance Rating computed over predictions on ${period.label} season fixtures, in every competition, only`
          : `Ranked by the Performance Rating computed over predictions${where} in its ${period.label} season only`;
  }
}

/**
 * The line under the switchers: what is ranked, among whom, behind which
 * filter, and -- on a month or season board -- that a member appears only
 * where their prediction history is visible to the viewer.
 */
export function boardExplainer(
  board: Pick<LeaderboardResponse, 'scope' | 'period' | 'min_settled' | 'floor'> & {
    competition?: LeaderboardResponse['competition'];
  },
  locale = 'en',
): string {
  const competition = board.competition?.name ?? null;
  const among = board.scope === 'friends' ? ' among you and your friends' : '';
  const inPeriod =
    board.period.kind !== 'all'
      ? ' in that period'
      : competition !== null
        ? ' in that competition'
        : '';
  const privacy =
    board.period.kind === 'all' && competition === null
      ? ''
      : ' A member appears only where their prediction history is visible to you.';
  return (
    `${periodSentence(board.period, locale, competition)}${among}, counting members with at least ` +
    `${board.min_settled} settled predictions${inPeriod}. Ratings are provisional below ` +
    `${board.floor}, so no smaller sample is ranked.${privacy}`
  );
}

/**
 * The sentence for a board with nobody on it: which population, which period
 * and which filter emptied it -- never a table of nobody.
 */
export function emptyBoardSentence(
  scope: LeaderboardScope | 'group',
  period: LeaderboardPeriod,
  minSettled: number,
  pastTheEnd: boolean,
  locale = 'en',
  competition: string | null = null,
): string {
  if (pastTheEnd) return 'There is nobody on this page of the board.';
  if (period.kind === 'season' && period.label === null)
    return 'No season has a settled prediction yet, so there is no season board.';
  const who = scope === 'friends' ? 'Neither you nor any of your friends has' : 'No member has';
  const when =
    period.kind === 'month'
      ? ` in ${monthLabel(period.month, locale)}`
      : period.kind === 'season'
        ? ` on ${period.label} season fixtures`
        : '';
  const where = competition === null ? '' : ` in ${competition}`;
  return `${who} ${minSettled} settled predictions${where}${when} yet.`;
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
