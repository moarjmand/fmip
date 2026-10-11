import {
  type ScoreCard,
  type ScoreLine,
  type ScoresGroup,
  type ScoresResponse,
  STALE_LIVE_AFTER_MS,
} from '@fmip/contracts';
import type { Message } from '@/i18n/messages';
import { isBehind } from '@/lib/live';
import { type StatusKey, statusLabel } from '@/lib/scores';

/**
 * The live strip's rules (T-1381, D-199), pure so they are unit-tested
 * (`live-strip.spec.ts`); `components/live-strip.tsx` fetches and draws.
 *
 * The strip is today's matches of one competition: the first in the scores
 * answer's own order that has a match today. A guest's answer (the strip
 * asks without the session) is ordered by `display_order` (D-154), so it
 * opens on the Persian Gulf Pro League, then the continental cups and the
 * big leagues, as the operator placed them.
 */

/** The competition the strip shows: the first group with a match, or none. */
export function stripGroup(scores: ScoresResponse): ScoresGroup | null {
  return scores.groups.find((group) => group.fixtures.length > 0) ?? null;
}

/**
 * A chip's state. `before` a kick-off (its time), `live` (the minute, red),
 * `behind` (live, but the data stopped: the "Behind" word in place of a
 * minute that is no longer the current one, D-045), `final` (FT, AET, Pens or
 * Awarded, with the score) and `off` (postponed, suspended, cancelled,
 * abandoned: the word, and the score only where one was played).
 */
export type ChipKind = 'before' | 'live' | 'behind' | 'final' | 'off';

export interface ChipState {
  kind: ChipKind;
  /** The status cell's words: "17:00", "78′", "FT", "Postponed"… in the reader's digits. */
  status: string;
  /** The pair to draw, home first; `null` draws the names with "v" between them. */
  score: ScoreLine | null;
}

export function chipState(
  card: ScoreCard,
  locale: string,
  timeZone: string,
  now: number,
  words: Record<StatusKey, Message>,
): ChipState {
  const status = statusLabel(card, locale, timeZone, now, words);
  switch (card.status) {
    case 'scheduled':
      return { kind: 'before', status, score: null };
    case 'live':
      return {
        kind: isBehind(card, now) ? 'behind' : 'live',
        status,
        score: card.scores.current,
      };
    case 'finished':
      return { kind: 'final', status, score: card.scores.full_time ?? card.scores.current };
    case 'awarded':
      return { kind: 'final', status, score: card.scores.current };
    case 'postponed':
    case 'cancelled':
      return { kind: 'off', status, score: null };
    case 'suspended':
    case 'abandoned':
      return { kind: 'off', status, score: card.scores.current };
  }
}

/**
 * When the strip stops being able to vouch for itself (rule 4): the time
 * after which some chip may have changed without the strip knowing, or
 * `null` when nothing on it can change today (every match over or off).
 * A live match can change at any moment, so the answer's own time counts; a
 * match yet to start can change from its kick-off. Past either by
 * `STALE_LIVE_AFTER_MS` (D-045), the strip says it may be behind. The strip
 * lives in the locale layout, which a client-side navigation does not render
 * again, so the page keeps it long after the answer was given.
 */
export function stripBehindAt(cards: readonly ScoreCard[], generatedAt: string): number | null {
  const answered = Date.parse(generatedAt);
  let from: number | null = null;
  for (const card of cards) {
    const changes =
      card.status === 'live' || card.status === 'suspended'
        ? answered
        : card.status === 'scheduled'
          ? Math.max(answered, Date.parse(card.kickoff_at))
          : null;
    if (changes !== null && !Number.isNaN(changes)) {
      from = from === null ? changes : Math.min(from, changes);
    }
  }
  return from === null ? null : from + STALE_LIVE_AFTER_MS;
}

/** Whether the strip is to say "may be behind" now: a chip is behind, or the answer has aged out. */
export function stripIsBehind(
  cards: readonly ScoreCard[],
  generatedAt: string,
  now: number,
): boolean {
  if (cards.some((card) => isBehind(card, now))) return true;
  const at = stripBehindAt(cards, generatedAt);
  return at !== null && now >= at;
}

/**
 * The strip's one request, shared (T-1381). Every page draws the strip, so
 * the answer for one day, zone and language is kept for `STRIP_ANSWER_MS`
 * and handed to every page asked in that time: a page view costs the API
 * nothing more most of the time. What a chip says is the answer's, with the
 * answer's own times (`last_updated_at`, `generated_at`), so a kept answer
 * is judged by `stripIsBehind` like a fresh one. A failed answer is kept for
 * less, so an API that is back is asked again soon.
 */
export const STRIP_ANSWER_MS = 15_000;
export const STRIP_FAILURE_MS = 5_000;
const KEPT_ANSWERS = 32;

export interface KeptAnswer<T> {
  at: number;
  answer: Promise<T>;
  ok: boolean | null;
}

export function sharedAnswer<T extends { ok: boolean }>(
  kept: Map<string, KeptAnswer<T>>,
  key: string,
  now: number,
  ask: () => Promise<T>,
): Promise<T> {
  const held = kept.get(key);
  if (held !== undefined) {
    const life = held.ok === false ? STRIP_FAILURE_MS : STRIP_ANSWER_MS;
    if (now - held.at < life) return held.answer;
    kept.delete(key);
  }
  const entry: KeptAnswer<T> = { at: now, answer: ask(), ok: null };
  entry.answer.then(
    (result) => {
      entry.ok = result.ok;
    },
    () => {
      entry.ok = false;
    },
  );
  kept.set(key, entry);
  // Oldest first in a Map: the zones and languages nobody asked for lately go.
  while (kept.size > KEPT_ANSWERS) {
    const oldest = kept.keys().next().value;
    if (oldest === undefined) break;
    kept.delete(oldest);
  }
  return entry.answer;
}
