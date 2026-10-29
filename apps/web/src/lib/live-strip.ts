import { type ScoreCard, STALE_LIVE_AFTER_MS } from '@fmip/contracts';
import { isBehind } from '@/lib/live';

/**
 * The live strip's rules (T-1381, D-199), pure so they are unit-tested
 * (`live-strip.spec.ts`). The strip became the matchday rail's drawer
 * (T-1624, D-292), and both gave way to the moments rail (T-1642, D-300,
 * `components/moments-rail.tsx`), which keeps the two rules that were never
 * the strip's alone: when a bar of matches stops being able to vouch for
 * itself (rule 4), and the one request shared between pages.
 */

/**
 * When the strip stops being able to vouch for itself (rule 4): the time
 * after which some chip may have changed without the strip knowing, or
 * `null` when nothing on it can change today (every match over or off).
 * A live match can change at any moment, so the answer's own time counts; a
 * match yet to start can change from its kick-off. Past either by
 * `STALE_LIVE_AFTER_MS` (D-045), the strip says it may be behind. The strip
 * lives in the locale layout, which a client-side navigation does not render
 * again; since T-1635 the rail asks again while a match is being played
 * (`momentsAskIn` since T-1642), and each answer moves this time on, so it is
 * reached only when the asking stops getting answers.
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
/**
 * The life of a kept answer when the rail is told a match has just moved
 * (T-1635): a page whose own stream saw a goal asks for an answer this
 * fresh, so the rail does not keep the score from before it. The readers of
 * that match ask within a moment of each other; the first asks the API, the
 * rest share its answer.
 */
export const FRESH_ANSWER_MS = 2_000;
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
  /** At most this old, when it is less than an answer's life (`FRESH_ANSWER_MS`). */
  maxAge: number = STRIP_ANSWER_MS,
): Promise<T> {
  const held = kept.get(key);
  if (held !== undefined) {
    const life = held.ok === false ? STRIP_FAILURE_MS : Math.min(STRIP_ANSWER_MS, maxAge);
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
