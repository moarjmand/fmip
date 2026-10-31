import type { Moment, MomentForecast, MomentsResponse, ScoreCard } from '@fmip/contracts';
import { formatDate } from '@/i18n/format';
import type { Locale } from '@/i18n/locales';
import { type Message, type MessageKey, type PluralKey, message, plural } from '@/i18n/messages';
import { isBehind } from '@/lib/live';
import { type StatusKey, dateIn, resultLine, statusLabel } from '@/lib/scores';
import { sharesToPercentages, wholePercentages } from '@/lib/triple';
import { fill, formatPercent } from '@/lib/words';

/**
 * The moments rail's rules (T-1642, D-300), pure so each is unit-tested
 * (`moments-rail.spec.ts`): the words over each card (its eyebrow and the
 * time at its inline end), the one sentence the model's numbers make, when
 * the rail asks for itself again, and how many cards a desktop row holds
 * beside its "N more" link. The cards themselves are `GET /moments`'s
 * (T-1641, D-299); nothing here picks or ranks a match.
 *
 * Every probability is the stored pre-kick-off forecast's (rules 5 and 6),
 * as whole percentages that total 100 (blueprint 6.2, `wholePercentages`);
 * a moment without one has no sentence at all (rule 3).
 */

type Side = 'home' | 'away';
type Outcome = Side | 'draw';

/** A team as a card names it: its short name when it has one. */
export function teamName(team: Pick<ScoreCard['home'], 'name' | 'short_name'>): string {
  return team.short_name ?? team.name;
}

/** The forecast's three shares as whole percentages totalling 100. */
export function wholeShares(forecast: MomentForecast): Record<Outcome, number> {
  return wholePercentages(sharesToPercentages(forecast));
}

/** The model's pick: the likeliest of the three, home first on a tie, then away. */
export function modelPick(forecast: Pick<MomentForecast, Outcome>): Outcome {
  const { home, draw, away } = forecast;
  if (home >= away && home >= draw) return 'home';
  if (away >= draw) return 'away';
  return 'draw';
}

/** The side ahead on a score line, or `null` when level or there is no line. */
function aheadOn(line: ScoreCard['scores']['current']): Side | null {
  if (line === null || line.home === line.away) return null;
  return line.home > line.away ? 'home' : 'away';
}

/**
 * The goals a card shows: the result once over (after extra time), the current one in
 * play, none before kick-off or for a match that was never played.
 */
export function shownLine(card: ScoreCard): ScoreCard['scores']['current'] {
  switch (card.status) {
    case 'scheduled':
    case 'postponed':
    case 'cancelled':
      return null;
    case 'finished':
      return resultLine(card.scores);
    default:
      return card.scores.current;
  }
}

/**
 * Who won a match that is over (the shoot-out deciding a level line), or
 * `null` for a draw, a match not over, or one with no score.
 */
export function winnerOf(card: ScoreCard): Side | null {
  if (card.status !== 'finished' && card.status !== 'awarded') return null;
  return aheadOn(shownLine(card)) ?? aheadOn(card.scores.penalties);
}

/** A big match from this hour of the evening, in the reader's zone, is tonight's. */
export const EVENING_HOUR = 17;

function hourIn(timeZone: string, iso: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(iso),
    ),
  );
}

function filled(lang: Locale, key: MessageKey, params: Record<string, string>): Message {
  const template = message(lang, key);
  return { ...template, text: fill(template.text, params) };
}

/**
 * The eyebrow over a card: why the match is on the rail, in the reader's
 * words. Counts are the moment's own (`minutes_left`) or the clock's against
 * the kick-off; a weekday is the reader's zone's.
 */
export function momentEyebrow(
  moment: Moment,
  lang: Locale,
  timeZone: string,
  now: number,
): Message {
  const card = moment.fixture;
  const say = (key: MessageKey) => message(lang, key);
  const count = (key: PluralKey, n: number) => plural(lang, key, n);
  switch (moment.kind) {
    case 'against_forecast':
      return say('shell.moments.kind.againstForecast');
    case 'level_late': {
      const left = moment.minutes_left ?? Math.max(0, 90 - (card.minute ?? 90));
      return left > 0
        ? count('shell.moments.kind.levelLate', left)
        : say('shell.moments.kind.levelAdded');
    }
    case 'favourite_held':
      return say('shell.moments.kind.favouriteHeld');
    case 'big_one':
      return say(
        card.status === 'live'
          ? 'shell.moments.kind.bigOneLive'
          : hourIn(timeZone, card.kickoff_at) >= EVENING_HOUR
            ? 'shell.moments.kind.bigOneTonight'
            : 'shell.moments.kind.bigOneToday',
      );
    case 'starting_soon': {
      const minutes = Math.ceil((Date.parse(card.kickoff_at) - now) / 60_000);
      return minutes > 0
        ? count('shell.moments.kind.startingSoon', minutes)
        : say('shell.moments.kind.kickoffDue');
    }
    case 'closest_call':
      return say('shell.moments.kind.closestCall');
    case 'upset':
      return say('shell.moments.kind.upset');
    case 'followed':
      return say('shell.moments.kind.followed');
    case 'coming_up':
      return dateIn(timeZone, new Date(card.kickoff_at)) === dateIn(timeZone, new Date(now))
        ? say('shell.moments.kind.comingUp')
        : filled(lang, 'shell.moments.kind.comingUpOn', {
            day: formatDate(lang, card.kickoff_at, timeZone, { weekday: 'short' }),
          });
  }
}

/** Whether the eyebrow is in saffron: the match is being played. */
export function isLiveMoment(moment: Pick<Moment, 'fixture'>): boolean {
  return moment.fixture.status === 'live';
}

export interface MomentWhen {
  /** "80′", "20:00" in the reader's zone, "FT", "Behind", "Postponed"… */
  text: string;
  /** A match in play: the word that stands in for the minute once the rail's answer ages (rule 4). */
  behind?: string;
}

/** The time at the eyebrow's inline end: the minute, the kick-off or the result's word. */
export function momentWhen(
  card: ScoreCard,
  lang: Locale,
  timeZone: string,
  now: number,
  words: Record<StatusKey, Message>,
): MomentWhen {
  const text = statusLabel(card, lang, timeZone, now, words);
  return card.status === 'live' && !isBehind(card, now)
    ? { text, behind: words['status.behind'].text }
    : { text };
}

/**
 * The model line's one sentence, from the stored pre-kick-off forecast's
 * numbers and nothing else; `null` when the moment has no forecast (rule 3:
 * the line is not drawn).
 */
export function momentSentence(moment: Moment, lang: Locale): Message | null {
  const forecast = moment.forecast;
  if (forecast === null) return null;
  const card = moment.fixture;
  const shares = wholeShares(forecast);
  const pct = (value: number) => formatPercent(lang, value, 0);
  const name: Record<Side, string> = { home: teamName(card.home), away: teamName(card.away) };
  const three = () =>
    filled(lang, 'shell.moments.say.three', {
      home: name.home,
      homePct: pct(shares.home),
      drawPct: pct(shares.draw),
      away: name.away,
      awayPct: pct(shares.away),
    });
  switch (moment.kind) {
    case 'against_forecast': {
      const side = moment.side ?? aheadOn(card.scores.current);
      if (side === null) return three();
      return filled(lang, 'shell.moments.say.againstForecast', {
        team: name[side],
        pct: pct(shares[side]),
      });
    }
    case 'level_late': {
      const pick = modelPick(forecast);
      if (pick === 'draw') {
        return filled(lang, 'shell.moments.say.levelLateDraw', { pct: pct(shares.draw) });
      }
      return filled(lang, 'shell.moments.say.levelLate', {
        team: name[pick],
        pct: pct(shares[pick]),
        draw: pct(shares.draw),
      });
    }
    case 'favourite_held': {
      const side = moment.side ?? (forecast.home >= forecast.away ? 'home' : 'away');
      const behind = aheadOn(card.scores.current) === (side === 'home' ? 'away' : 'home');
      return filled(
        lang,
        behind ? 'shell.moments.say.favouriteBehind' : 'shell.moments.say.favouriteLevel',
        { team: name[side], pct: pct(shares[side]) },
      );
    }
    case 'upset': {
      const side = moment.side ?? winnerOf(card);
      if (side === null) return three();
      return filled(lang, 'shell.moments.say.upset', { team: name[side], pct: pct(shares[side]) });
    }
    case 'closest_call':
      return filled(lang, 'shell.moments.say.closestCall', {
        home: pct(shares.home),
        draw: pct(shares.draw),
        away: pct(shares.away),
      });
    default:
      return three();
  }
}

/** The hover card's sentence: the three numbers, said whole; `null` with no forecast. */
export function panelSentence(moment: Moment, lang: Locale): Message | null {
  if (moment.forecast === null) return null;
  const shares = wholeShares(moment.forecast);
  const pct = (value: number) => formatPercent(lang, value, 0);
  return filled(lang, 'shell.moments.card.before', {
    home: teamName(moment.fixture.home),
    homePct: pct(shares.home),
    drawPct: pct(shares.draw),
    away: teamName(moment.fixture.away),
    awayPct: pct(shares.away),
  });
}

/** An answer that could not be read is asked for again after this long. */
export const MOMENTS_RETRY_MS = 5 * 60_000;
/** With nothing being played, the rail still looks again this often: a match may start, a quiet day may end. */
export const MOMENTS_IDLE_MS = 10 * 60_000;
/** A match still marked scheduled this long after its kick-off may yet start: keep asking. */
export const LATE_START_MS = 3 * 60 * 60_000;

/**
 * How long after this answer the rail asks for itself again, in ms; `0`
 * means "every `RAIL_POLL_MS`" (`lib/live-signal.ts`), as the matchday rail
 * did (T-1635, D-297): while any match is being played anywhere
 * (`live_count`, which the lead counts), while a card's match is in play or
 * suspended, or past its kick-off and not yet started. Otherwise at the next
 * card's kick-off or within `MOMENTS_IDLE_MS`, whichever comes first.
 */
export function momentsAskIn(answer: MomentsResponse | null, now: number): number {
  if (answer === null) return MOMENTS_RETRY_MS;
  if (answer.live_count > 0) return 0;
  let at = now + MOMENTS_IDLE_MS;
  for (const { fixture: card } of answer.moments) {
    if (card.status === 'live' || card.status === 'suspended') return 0;
    if (card.status !== 'scheduled') continue;
    const kickoff = Date.parse(card.kickoff_at);
    if (Number.isNaN(kickoff)) continue;
    if (kickoff > now) at = Math.min(at, kickoff);
    else if (now - kickoff < LATE_START_MS) return 0;
  }
  return Math.max(0, at - now);
}

/*
 * The desktop row's geometry (from 768px), in rem as `globals.css` draws it
 * (`.moments-row`): each card at least `CARD_MIN_REM` wide, `CARD_GAP_REM`
 * apart, and the "N more" slot `MORE_REM` wide at the end with one gap
 * before it. The row shows only the cards that fit -- no sideways scroll, no
 * arrows -- and its container queries are these thresholds, which
 * `moments-rail.spec.ts` holds the stylesheet to.
 */
export const CARD_MIN_REM = 15;
export const CARD_GAP_REM = 0.75;
export const MORE_REM = 3.5;
/** The most cards the rail ever holds (`MOMENTS_LIMIT`). */
export const MOST_CARDS = 8;

/** The row width (rem) from which `k` cards fit beside the "N more" slot. */
export function fitThreshold(k: number): number {
  return k * (CARD_MIN_REM + CARD_GAP_REM) + MORE_REM;
}

/** How many of `count` cards a row `rowRem` wide shows: at least one, at most all. */
export function cardsThatFit(rowRem: number, count: number): number {
  let fit = 1;
  while (fit < Math.min(count, MOST_CARDS) && rowRem >= fitThreshold(fit + 1)) fit += 1;
  return Math.min(fit, count);
}

/**
 * The "N more" links the row carries, one per number of cards it may show
 * (`shown`, the stylesheet showing only the one whose width matches), each
 * counting the cards left out. None when one card is all there is.
 */
export function moreVariants(count: number): { shown: number; more: number }[] {
  const out: { shown: number; more: number }[] = [];
  for (let shown = 1; shown < Math.min(count, MOST_CARDS + 1); shown += 1) {
    out.push({ shown, more: count - shown });
  }
  return out;
}
