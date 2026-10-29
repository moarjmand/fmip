import {
  MOMENT_KINDS,
  MOMENTS_LIMIT,
  type ForecastSummary,
  type Moment,
  type MomentForecast,
  type MomentKind,
  type ScoreCard,
  type ScoresResponse,
} from '@fmip/contracts';
import { isTimeZone } from '../../fixtures/fixtures.service';

/**
 * Today's moments that matter (T-1641, D-299), pure: which matches the top
 * bar shows and why, from the scores answer, the pre-kick-off published
 * forecasts and what the viewer follows. Every threshold below is the one the
 * maintainer approved on 2026-10-29.
 */

export const AGAINST_FORECAST_FROM_MINUTE = 60;
/** The leading side's pre-kick-off chance at most this: against the forecast. */
export const AGAINST_FORECAST_MAX_CHANCE = 0.35;
export const LEVEL_LATE_FROM_MINUTE = 75;
/** After half time. */
export const FAVOURITE_HELD_FROM_MINUTE = 46;
/** The model's favourite: a side given at least this before kick-off. */
export const FAVOURITE_MIN_CHANCE = 0.65;
/** The winner's pre-kick-off chance at most this: an upset. */
export const UPSET_MAX_CHANCE = 0.3;
/** `minutes_left` counts to the end of normal time. */
export const REGULATION_MINUTES = 90;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const STARTING_SOON_MS = 30 * MINUTE_MS;
export const CLOSEST_CALL_WITHIN_MS = 12 * HOUR_MS;
export const UPSET_WITHIN_MS = 12 * HOUR_MS;
/** A quiet day looks this far back for upsets. */
export const QUIET_UPSET_WITHIN_MS = 36 * HOUR_MS;
export const COMING_UP_WITHIN_MS = 72 * HOUR_MS;
/**
 * When a match is reckoned to have finished: kick-off plus two hours (two
 * halves, half time and stoppage). The store keeps no reliable end time (the
 * provider gives the periods' starts), and the reckoning only bounds and
 * orders `upset`; no reader is shown it.
 */
export const MATCH_LENGTH_MS = 2 * HOUR_MS;
/** Fewer moments than this is a quiet day: wider upsets and `coming_up`. */
export const QUIET_DAY_BELOW = 3;

/**
 * The homepage's big competitions and its window, mirrored from
 * `apps/web/src/lib/home.ts` (`BIG_COMPETITIONS`, `HOME_DAYS`, D-270) so the
 * big one here is the homepage's hero.
 */
export const BIG_COMPETITIONS = 6;
export const HOME_DAYS = 14;
/** The read starts this many days before today, for a quiet day's upsets. */
export const READ_DAYS_BEFORE = 2;

/** At most this many of a kind; a kind not listed is bounded by `MOMENTS_LIMIT` alone. */
export const KIND_CAPS: Readonly<Partial<Record<MomentKind, number>>> = {
  starting_soon: 2,
  closest_call: 1,
  upset: 2,
  coming_up: 3,
};

/** The kinds a fixture can earn, in the order it earns them; `followed` is the fallback. */
const EARNED_KINDS = MOMENT_KINDS.filter((kind) => kind !== 'followed');
/** Ranking among one viewer's followed moments: the plain `followed` one comes last. */
const RANK_OF = new Map<MomentKind, number>(
  [...EARNED_KINDS, 'followed' as const].map((kind, index) => [kind, index]),
);

export type ParsedMomentsQuery =
  | { ok: true; timeZone: string; bigOneLive: boolean }
  | { ok: false; fields: Record<string, string> };

/** Fastify hands a repeated parameter over as an array; the first one counts. */
function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * `?timezone=` (IANA, UTC by default), read as `GET /scores` reads its zone;
 * `?tz=`, the name `/scores` and `/model/upset` use, is read too.
 * `?big_one=live`: the client can say "Big one, live", so the big one stays
 * while it is played (T-1644, D-302); without it, as before.
 */
export function parseMomentsQuery(raw: Record<string, unknown>): ParsedMomentsQuery {
  const timeZone = first(raw.timezone) ?? first(raw.tz) ?? 'UTC';
  if (!isTimeZone(timeZone)) {
    return { ok: false, fields: { timezone: 'must be an IANA time zone, e.g. Europe/London' } };
  }
  return { ok: true, timeZone, bigOneLive: first(raw.big_one) === 'live' };
}

/** `day` moved by whole days, as YYYY-MM-DD. */
export function shiftDate(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** One formatter for the zone: the calendar date of an instant there, YYYY-MM-DD. */
export function dayIn(timeZone: string): (at: Date | string) => string {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (at) => {
    const parts = format.formatToParts(typeof at === 'string' ? new Date(at) : at);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
}

/**
 * The days read: two before today (a quiet day's upsets reach 38 hours back)
 * to the end of the homepage's own window, so the competitions the big one
 * ranks among are the homepage's.
 */
export function readRange(
  timeZone: string,
  now: Date,
): { today: string; from: string; to: string } {
  const today = dayIn(timeZone)(now);
  return { today, from: shiftDate(today, -READ_DAYS_BEFORE), to: shiftDate(today, HOME_DAYS - 1) };
}

/** A pre-kick-off summary as a moment carries it: available probabilities, else none. */
export function momentForecast(summary: ForecastSummary | null): MomentForecast | null {
  if (summary === null || summary.status !== 'available' || summary.probabilities === null) {
    return null;
  }
  const { home, draw, away } = summary.probabilities;
  return {
    home,
    draw,
    away,
    model_version: summary.model_version,
    computed_at: summary.computed_at,
  };
}

/** Every card of the answer, each once. */
export function cardsOf(scores: ScoresResponse): ScoreCard[] {
  const seen = new Set<string>();
  return [...scores.pinned, ...scores.groups.flatMap((group) => group.fixtures)].filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}

/**
 * The fixtures that can be a moment at `now`, whose forecasts are read in one
 * batch: in play, to come within the widest window (or still marked to come
 * today), or finished within a quiet day's reach.
 */
export function forecastCandidates(
  cards: readonly ScoreCard[],
  timeZone: string,
  now: Date,
): string[] {
  const dayOf = dayIn(timeZone);
  const today = dayOf(now);
  const t = now.getTime();
  return cards
    .filter((card) => {
      const kickoff = Date.parse(card.kickoff_at);
      if (card.status === 'live') return true;
      if (card.status === 'scheduled') {
        return (
          kickoff <= t + COMING_UP_WITHIN_MS && (kickoff >= t || dayOf(card.kickoff_at) === today)
        );
      }
      return card.status === 'finished' && kickoff + MATCH_LENGTH_MS >= t - QUIET_UPSET_WITHIN_MS;
    })
    .map((card) => card.id);
}

export interface MomentsInput {
  now: Date;
  timeZone: string;
  /** A guest's scores answer over `readRange` (nothing pinned), in the competitions' order. */
  scores: ScoresResponse;
  /** Each competition's stated place, `null` for none (D-154, D-207). */
  statedOrder: ReadonlyMap<string, number | null>;
  /** The fixtures an editor features now (D-153). */
  featured: ReadonlySet<string>;
  /** Available pre-kick-off published forecasts by fixture; a fixture absent has none. */
  forecasts: ReadonlyMap<string, MomentForecast>;
  /** The teams the viewer follows; empty for a guest. */
  followedTeams: ReadonlySet<string>;
  /** Whether the big one stays while it is played (`?big_one=live`, T-1644, D-302). */
  bigOneLive?: boolean;
}

export interface PickedMoments {
  live_count: number;
  today_count: number;
  moments: Moment[];
}

type Side = 'home' | 'away';
const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');

/**
 * The homepage's own answer within the read: the cards from today to the end
 * of its window, and each of their competitions' place among them, in the
 * answer's order (D-154) -- the homepage's `scores.groups` index.
 */
function homeAnswer(
  cards: readonly ScoreCard[],
  days: ReadonlyMap<string, string>,
  today: string,
  importance: ReadonlyMap<string, number>,
): { home: ScoreCard[]; order: Map<string, number> } {
  const last = shiftDate(today, HOME_DAYS - 1);
  const home = cards.filter((card) => {
    const day = days.get(card.id) ?? '';
    return day >= today && day <= last;
  });
  const competitions = [...new Set(home.map((card) => card.competition.id))].sort(
    (a, b) => (importance.get(a) ?? importance.size) - (importance.get(b) ?? importance.size),
  );
  return { home, order: new Map(competitions.map((id, index) => [id, index])) };
}

/**
 * The homepage's hero for a guest, mirrored from `heroMatch` in
 * `apps/web/src/lib/home.ts` (D-270) over the homepage's own window (today
 * and the 13 days after it): a featured match, else one of the first
 * `BIG_COMPETITIONS` competitions in the answer's order; one in play first,
 * else the next today or tomorrow, else on the first day with a match. The
 * big one is that match while it is still to come today, and while it is
 * played for a client that asks (`keepLive`, T-1644, D-302): the homepage's
 * hero then stays on the rail to its end.
 */
export function bigOneOf(
  cards: readonly ScoreCard[],
  importance: ReadonlyMap<string, number>,
  featured: ReadonlySet<string>,
  timeZone: string,
  now: Date,
  keepLive = false,
): string | null {
  const dayOf = dayIn(timeZone);
  const today = dayOf(now);
  const days = new Map(cards.map((card) => [card.id, dayOf(card.kickoff_at)]));
  const day = (card: ScoreCard): string => days.get(card.id) ?? '';
  const { home, order } = homeAnswer(cards, days, today, importance);
  const rank = (card: ScoreCard): number => order.get(card.competition.id) ?? order.size;
  const tier = (card: ScoreCard): number =>
    featured.has(card.id) ? 1 : rank(card) < BIG_COMPETITIONS ? 2 : 3;

  const live = home.filter((card) => card.status === 'live' && tier(card) < 3);
  const scheduled = home.filter((card) => card.status === 'scheduled');
  const scheduledDays = [...new Set(scheduled.map(day))].sort();
  const soon = scheduledDays.filter((d) => d <= shiftDate(today, 1));
  const window = new Set(soon.length > 0 ? soon : scheduledDays.slice(0, 1));
  const [best] = [...live, ...scheduled.filter((card) => window.has(day(card)))].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      Number(b.status === 'live') - Number(a.status === 'live') ||
      day(a).localeCompare(day(b)) ||
      rank(a) - rank(b) ||
      a.kickoff_at.localeCompare(b.kickoff_at) ||
      a.id.localeCompare(b.id),
  );
  if (best === undefined) return null;
  return (keepLive && best.status === 'live') ||
    (best.status === 'scheduled' && day(best) === today)
    ? best.id
    : null;
}

/**
 * The moments (D-299): each fixture once, with the highest kind it earns;
 * the viewer's followed matches first, then by kind, then within a kind by
 * the competition's importance and the minute, the kick-off or the finish.
 * At most `MOMENTS_LIMIT`. A probability is only ever the stored forecast's,
 * a score and a minute only the card's: a card without them earns no kind
 * that needs them.
 */
export function pickMoments(input: MomentsInput): PickedMoments {
  const { now, timeZone, forecasts, followedTeams, statedOrder, featured } = input;
  const t = now.getTime();
  const dayOf = dayIn(timeZone);
  const today = dayOf(now);
  const cards = cardsOf(input.scores);
  const days = new Map(cards.map((card) => [card.id, dayOf(card.kickoff_at)]));
  const importance = new Map(
    input.scores.groups.map((group, index) => [group.competition.id, index]),
  );
  const importanceOf = (card: ScoreCard): number =>
    importance.get(card.competition.id) ?? importance.size;
  const kickoff = (card: ScoreCard): number => Date.parse(card.kickoff_at);
  const isFollowed = (card: ScoreCard): boolean =>
    followedTeams.has(card.home.id) || followedTeams.has(card.away.id);

  const moment = (
    kind: MomentKind,
    card: ScoreCard,
    side: Side | null = null,
    minutesLeft: number | null = null,
  ): Moment => ({
    kind,
    followed: isFollowed(card),
    fixture: card,
    forecast: forecasts.get(card.id) ?? null,
    side,
    minutes_left: minutesLeft,
  });

  const bigOne = bigOneOf(cards, importance, featured, timeZone, now, input.bigOneLive === true);
  // The top competitions `coming_up` draws from: the homepage's big ones.
  const { order: homeOrder } = homeAnswer(cards, days, today, importance);
  const bigCompetitions = new Set(
    [...homeOrder].filter(([, index]) => index < BIG_COMPETITIONS).map(([id]) => id),
  );
  // The closest call is a superlative: the most even of all, or no card.
  const highest = (f: MomentForecast): number => Math.max(f.home, f.draw, f.away);
  const [closest] = cards
    .flatMap((card) => {
      const forecast = forecasts.get(card.id);
      const at = kickoff(card);
      return card.status === 'scheduled' &&
        forecast !== undefined &&
        at >= t &&
        at <= t + CLOSEST_CALL_WITHIN_MS
        ? [{ card, forecast }]
        : [];
    })
    .sort(
      (a, b) =>
        highest(a.forecast) - highest(b.forecast) ||
        importanceOf(a.card) - importanceOf(b.card) ||
        kickoff(a.card) - kickoff(b.card) ||
        a.card.id.localeCompare(b.card.id),
    );

  const earn = (kind: MomentKind, card: ScoreCard, quiet: boolean): Moment | null => {
    const forecast = forecasts.get(card.id) ?? null;
    const minute = card.status === 'live' ? card.minute : null;
    const score = card.scores.current;
    switch (kind) {
      case 'against_forecast': {
        if (minute === null || minute < AGAINST_FORECAST_FROM_MINUTE) return null;
        if (score === null || score.home === score.away || forecast === null) return null;
        const leader: Side = score.home > score.away ? 'home' : 'away';
        return forecast[leader] <= AGAINST_FORECAST_MAX_CHANCE ? moment(kind, card, leader) : null;
      }
      case 'level_late':
        if (minute === null || minute < LEVEL_LATE_FROM_MINUTE) return null;
        if (score === null || score.home !== score.away) return null;
        return moment(kind, card, null, Math.max(0, REGULATION_MINUTES - minute));
      case 'favourite_held': {
        if (minute === null || minute < FAVOURITE_HELD_FROM_MINUTE) return null;
        if (score === null || forecast === null) return null;
        const favourite: Side | null =
          forecast.home >= FAVOURITE_MIN_CHANCE
            ? 'home'
            : forecast.away >= FAVOURITE_MIN_CHANCE
              ? 'away'
              : null;
        if (favourite === null) return null;
        return score[favourite] <= score[other(favourite)] ? moment(kind, card, favourite) : null;
      }
      case 'big_one':
        return card.id === bigOne ? moment(kind, card) : null;
      case 'starting_soon': {
        const placed = statedOrder.get(card.competition.id) ?? null;
        return card.status === 'scheduled' &&
          placed !== null &&
          kickoff(card) >= t &&
          kickoff(card) <= t + STARTING_SOON_MS
          ? moment(kind, card)
          : null;
      }
      case 'closest_call':
        return card.id === closest?.card.id ? moment(kind, card) : null;
      case 'upset': {
        const final = card.scores.full_time;
        if (card.status !== 'finished' || final === null || final.home === final.away) return null;
        if (forecast === null || kickoff(card) > t) return null;
        const within = quiet ? QUIET_UPSET_WITHIN_MS : UPSET_WITHIN_MS;
        if (kickoff(card) + MATCH_LENGTH_MS < t - within) return null;
        const winner: Side = final.home > final.away ? 'home' : 'away';
        return forecast[winner] <= UPSET_MAX_CHANCE ? moment(kind, card, winner) : null;
      }
      case 'coming_up': {
        if (!quiet || card.status !== 'scheduled') return null;
        if (kickoff(card) < t || kickoff(card) > t + COMING_UP_WITHIN_MS) return null;
        return bigCompetitions.has(card.competition.id) ? moment(kind, card) : null;
      }
      case 'followed':
        return null;
    }
  };

  const withinKind = (a: Moment, b: Moment): number => {
    const live = Number(b.fixture.status === 'live') - Number(a.fixture.status === 'live');
    const when =
      a.fixture.status === 'live' && b.fixture.status === 'live'
        ? (b.fixture.minute ?? 0) - (a.fixture.minute ?? 0)
        : a.kind === 'upset'
          ? kickoff(b.fixture) - kickoff(a.fixture)
          : kickoff(a.fixture) - kickoff(b.fixture);
    return (
      Number(b.followed) - Number(a.followed) ||
      importanceOf(a.fixture) - importanceOf(b.fixture) ||
      live ||
      when ||
      a.fixture.id.localeCompare(b.fixture.id)
    );
  };

  const pick = (quiet: boolean): Moment[] => {
    const taken = new Map<string, Moment>();
    for (const kind of EARNED_KINDS) {
      const earned = cards
        .filter((card) => !taken.has(card.id))
        .flatMap((card) => {
          const found = earn(kind, card, quiet);
          return found === null ? [] : [found];
        })
        .sort(withinKind);
      for (const found of earned.slice(0, KIND_CAPS[kind] ?? MOMENTS_LIMIT)) {
        taken.set(found.fixture.id, found);
      }
    }
    // Today's followed matches, live or to come, that earned nothing else.
    for (const card of cards) {
      if (taken.has(card.id) || !isFollowed(card)) continue;
      if (card.status === 'live' || (card.status === 'scheduled' && days.get(card.id) === today)) {
        taken.set(card.id, moment('followed', card));
      }
    }
    return [...taken.values()].sort(
      (a, b) =>
        Number(b.followed) - Number(a.followed) ||
        (RANK_OF.get(a.kind) ?? 0) - (RANK_OF.get(b.kind) ?? 0) ||
        withinKind(a, b),
    );
  };

  let moments = pick(false);
  if (moments.length < QUIET_DAY_BELOW) moments = pick(true);

  return {
    live_count: cards.filter((card) => card.status === 'live').length,
    today_count: cards.filter((card) => days.get(card.id) === today).length,
    moments: moments.slice(0, MOMENTS_LIMIT),
  };
}
