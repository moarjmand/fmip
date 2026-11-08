import type {
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardPeriodKind,
  LeaderboardResponse,
  LeaderboardScope,
  Rating,
  RatingResponse,
  RatingTier,
} from '@fmip/contracts';
import { formatNumber, intlLocale } from '@/i18n/format';
import { type MessageKey, interpolate, plural, t } from '@/i18n/messages';
import { asLocale, ratingText } from './prediction-text';

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
  /** T-844: a primary language subtag, to rank only members who chose it; null for all. */
  language: string | null;
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
  const language = first(params.language);
  return {
    min: positiveInteger(first(params.min)),
    page: positiveInteger(first(params.page)) ?? 1,
    scope: scope === 'friends' ? 'friends' : 'everyone',
    period: kind,
    month: kind === 'month' && month !== undefined && MONTH.test(month) ? month : null,
    season: kind === 'season' && season !== undefined && season.length <= 32 ? season : null,
    competition:
      competition !== undefined && UUID.test(competition) ? competition.toLowerCase() : null,
    language:
      language !== undefined && /^[a-z]{2,3}$/i.test(language) ? language.toLowerCase() : null,
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
  if (q.language !== null) params.set('language', q.language);
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
  if (next.language !== null) params.set('language', next.language);
  if (next.min !== null) params.set('min', String(next.min));
  if (next.page > 1) params.set('page', String(next.page));
  const query = params.toString();
  return `/${locale}/leaderboard${query === '' ? '' : `?${query}`}`;
}

/**
 * A language's name in the reader's language (T-844), e.g. `ar` -> "Arabic";
 * the code itself when the runtime has no name for it.
 */
export function languageLabel(code: string, locale = 'en'): string {
  try {
    return (
      new Intl.DisplayNames([locale === 'x-rtl' ? 'en' : locale], { type: 'language' }).of(code) ??
      code
    );
  } catch {
    return code;
  }
}

/**
 * `2026-09` as "September 2026", in UTC so the name is the month the API rated.
 * Always the Gregorian month, in the locale's words and digits: the board is
 * cut on Gregorian months, and a Solar Hijri name would straddle two of them.
 */
export function monthLabel(month: string, locale = 'en'): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
    calendar: 'gregory',
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
  const l = asLocale(locale);
  const say = (key: MessageKey, params: Record<string, string> = {}): string =>
    interpolate(t(l, key), params);
  switch (period.kind) {
    case 'all':
      return competition === null
        ? say('leaderboardPage.ranked.current')
        : say('leaderboardPage.ranked.competition', { competition });
    case 'month': {
      const month = monthLabel(period.month, l);
      return competition === null
        ? say('leaderboardPage.ranked.month', { month })
        : say('leaderboardPage.ranked.monthCompetition', { competition, month });
    }
    case 'season':
      return period.label === null
        ? say('leaderboardPage.ranked.noSeason')
        : competition === null
          ? say('leaderboardPage.ranked.season', { season: period.label })
          : say('leaderboardPage.ranked.seasonCompetition', { competition, season: period.label });
  }
}

/** A phrase that follows another in a sentence: a space before it, or nothing. */
function after(phrase: string | null): string {
  return phrase === null ? '' : ` ${phrase}`;
}

/**
 * The line under the switchers: what is ranked, among whom, behind which
 * filter, and -- on a month or season board -- that a member appears only
 * where their prediction history is visible to the viewer.
 */
export function boardExplainer(
  board: Pick<LeaderboardResponse, 'scope' | 'period' | 'min_settled' | 'floor'> & {
    competition?: LeaderboardResponse['competition'];
    language?: LeaderboardResponse['language'];
  },
  locale = 'en',
): string {
  const l = asLocale(locale);
  const competition = board.competition?.name ?? null;
  const language = board.language ?? null;
  const readers = language === null ? '' : languageLabel(language, l);
  const among =
    board.scope === 'friends'
      ? language === null
        ? t(l, 'leaderboardPage.among.friends')
        : interpolate(t(l, 'leaderboardPage.among.friendsLanguage'), { language: readers })
      : language === null
        ? null
        : interpolate(t(l, 'leaderboardPage.among.membersLanguage'), { language: readers });
  const inPeriod =
    board.period.kind !== 'all'
      ? t(l, 'leaderboardPage.inPeriod.period')
      : competition !== null
        ? t(l, 'leaderboardPage.inPeriod.competition')
        : null;
  const privacy =
    board.period.kind === 'all' && competition === null && language === null
      ? ''
      : ` ${t(l, 'leaderboardPage.privacy')}`;
  const ranked = plural(l, 'leaderboardPage.explainer', board.min_settled, {
    ranked: periodSentence(board.period, l, competition),
    among: after(among),
    inPeriod: after(inPeriod),
  }).text;
  const floor = interpolate(t(l, 'leaderboardPage.floorRule'), {
    floor: formatNumber(l, board.floor),
  });
  return `${ranked} ${floor}${privacy}`;
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
  language: string | null = null,
): string {
  const l = asLocale(locale);
  if (pastTheEnd) return t(l, 'leaderboardPage.empty.pastEnd');
  if (period.kind === 'season' && period.label === null) {
    return t(l, 'leaderboardPage.empty.noSeason');
  }
  const key =
    scope === 'friends'
      ? language === null
        ? 'leaderboardPage.empty.friends'
        : 'leaderboardPage.empty.friendsLanguage'
      : language === null
        ? 'leaderboardPage.empty.members'
        : 'leaderboardPage.empty.membersLanguage';
  const when =
    period.kind === 'month'
      ? interpolate(t(l, 'leaderboardPage.empty.whenMonth'), {
          month: monthLabel(period.month, l),
        })
      : period.kind === 'season'
        ? interpolate(t(l, 'leaderboardPage.empty.whenSeason'), { season: period.label ?? '' })
        : null;
  const where =
    competition === null ? null : interpolate(t(l, 'leaderboardPage.empty.where'), { competition });
  return plural(l, key, minSettled, {
    language: language === null ? '' : languageLabel(language, l),
    where: after(where),
    when: after(when),
  }).text;
}

/** How many pages a board of `total` entries has, at least one. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

const TIER_KEY: Record<RatingTier, MessageKey> = {
  bronze: 'leaderboardPage.tier.bronze',
  silver: 'leaderboardPage.tier.silver',
  gold: 'leaderboardPage.tier.gold',
  platinum: 'leaderboardPage.tier.platinum',
  elite: 'leaderboardPage.tier.elite',
};

/** A tier's name; English unless a caller passes its page's locale (T-1307). */
export function tierLabel(tier: RatingTier, locale = 'en'): string {
  return t(asLocale(locale), TIER_KEY[tier]);
}

/** One decimal, always: 72 reads as "72.0" so the column lines up and the precision is honest. */
export function ratingLabel(entry: Pick<LeaderboardEntry, 'rating'>, locale = 'en'): string {
  return ratingText(locale, entry.rating);
}

/** Established, or provisional (never on the board, but the API says so), or neither. */
export function statusLabel(
  entry: Pick<LeaderboardEntry, 'provisional' | 'established'>,
  locale = 'en',
): string {
  const l = asLocale(locale);
  if (entry.established) return t(l, 'leaderboardPage.status.established');
  if (entry.provisional) return t(l, 'leaderboardPage.status.provisional');
  return t(l, 'leaderboardPage.status.building');
}

/**
 * How many of the board's filters narrow it (T-1783, D-388), for the folded
 * line "Filters · 2 applied": friends, a month or season, a competition, a
 * language, and a minimum other than the floor. `floor` is null when the API
 * did not answer, and then any `?min=` counts.
 */
export function activeFilterCount(q: LeaderboardPageQuery, floor: number | null): number {
  return [
    q.scope !== 'everyone',
    q.period !== 'all',
    q.competition !== null,
    q.language !== null,
    q.min !== null && q.min !== floor,
  ].filter(Boolean).length;
}

/** Whether the board is narrowed, so its explainer stays outside the folded filters (D-388). */
export function boardNarrowed(
  board: Pick<LeaderboardResponse, 'scope' | 'period' | 'competition' | 'language'>,
): boolean {
  return (
    board.scope !== 'everyone' ||
    board.period.kind !== 'all' ||
    board.competition !== null ||
    board.language !== null
  );
}

/**
 * The id of the About page's rating step (D-388, D7), where "How ratings
 * work" leads; the member profile links to the same id.
 */
export const ABOUT_RATING_ANCHOR = 'about-rating';

/** A step of "How a rating is earned": marked by fill and a tick, never by colour alone. */
export type RatingStepState = 'done' | 'current' | 'todo';

/**
 * Who is looking at the card "How a rating is earned" (T-1784, D-388), and
 * only what is true of them:
 *
 * - `guest`: nothing about the viewer is read, so no count -- the bar is a
 *   picture of the rule (also a member whose own rating could not be read);
 * - `unconfirmed`: a member whose e-mail is not confirmed, told the D-361
 *   rule; their settled count, never a count of pending picks;
 * - `member`: their own settled count from `GET /me/rating` (0 while the
 *   rating is null);
 * - `rated`: rated and at or above the floor, so on the board.
 *
 * No "N picks are waiting for their results": `settled_count` is the
 * formula's window (the last 100) and the history's `total` counts every
 * stored pick, voided ones included, so their difference is not a true count.
 */
export type RatingCardViewer =
  | { kind: 'guest' }
  | { kind: 'unconfirmed'; settled: number }
  | { kind: 'member'; settled: number }
  | { kind: 'rated'; username: string; rating: Rating };

export function ratingCardViewer(
  me: { email_verified: boolean } | null,
  mine: RatingResponse | null,
  floor: number,
): RatingCardViewer {
  if (me === null || mine === null) return { kind: 'guest' };
  const settled = mine.rating?.settled_count ?? 0;
  if (!me.email_verified) return { kind: 'unconfirmed', settled };
  if (mine.rating !== null && settled >= floor) {
    return { kind: 'rated', username: mine.username, rating: mine.rating };
  }
  return { kind: 'member', settled };
}

/**
 * The three steps' states: the first is where everyone starts; from the
 * first settled pick the results have scored and reaching the floor is what
 * is left; on the board, all three are done.
 */
export function ratingSteps(
  viewer: RatingCardViewer,
): readonly [RatingStepState, RatingStepState, RatingStepState] {
  if (viewer.kind === 'rated') return ['done', 'done', 'done'];
  if (viewer.kind !== 'guest' && viewer.settled > 0) return ['done', 'done', 'current'];
  return ['current', 'todo', 'todo'];
}

/** How far a member is towards the floor: the leaderboard card's bar and the profile's. */
export interface FloorProgress {
  count: number;
  floor: number;
  /** The bar's fill from the start edge, 0 to 99: below the floor it is never full. */
  percent: number;
}

/**
 * The bar to the floor (D-388, D-390), or null where none is drawn: at or
 * above the floor (the member is on the board), and when the floor is not a
 * positive number (an API that does not send it yet). Only below the floor is
 * "N of floor" true: `settled_count` is the formula's window (the last 100),
 * which equals every settled pick only while it is under the window -- and
 * the floor is under the window (`formula.spec.ts` holds it). So a member
 * with 34, or 250, settled picks gets no "34 of 30" or "100 of 30".
 */
export function floorProgress(settled: number, floor: number): FloorProgress | null {
  if (!(floor > 0) || settled >= floor) return null;
  const count = Math.max(0, settled);
  return { count, floor, percent: Math.floor((count / floor) * 100) };
}
