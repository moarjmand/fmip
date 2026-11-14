/**
 * The latest list's mix of sources (T-1816, D-411).
 *
 * One busy source must not fill the top of the list: Yahoo Sports wrote about
 * 30% of a day's English stories and the first forty in a row. A page is
 * composed in order, newest first, and each place takes the newest story
 * within reach that keeps both rules:
 *
 * - no more than `maxRun` cards in a row from one source, counting the run
 *   the previous page ended with;
 * - no source above `maxShare` of the page so far, rounded up (one of the
 *   first three cards, two of the first six, twelve of forty), so the rule
 *   holds for every top of a page: the homepage's six and the news page's
 *   forty alike.
 *
 * Nothing is left out. A story that would break a rule waits for a later
 * place -- while its source holds its share -- and one source's stories keep
 * their own order; the page's cursor carries the ones still waiting
 * (`NewsCursor.waiting`). Only the next `lookahead` stories not yet placed
 * are within reach: when none of them keeps both rules, the run rule alone
 * decides, and when none keeps that either (all from one source), the newest
 * takes the place, so the list never stalls.
 */
export const SOURCE_MIX = {
  maxRun: 3,
  maxShare: 0.3,
  /**
   * T-1833: 150, not D-411's first 50. On 2026-11-14 one source wrote 64% of
   * a day's English stories and the second first appeared 71 places down, so
   * a reach of 50 held nothing else and Yahoo ran seven in a row.
   */
  lookahead: 150,
} as const;

export interface Mixable {
  source_id: string;
}

/** The last cards' source and how many of them in a row, counted to `maxRun` (as many block alike). */
export interface SourceRun {
  source: string;
  length: number;
}

/**
 * How many stories may wait above a page's boundary (T-1833): `ahead` of the
 * rows already wait above the previous boundary (the cursor's waiting
 * stories, first in `rows`); at most `max` may wait after this page.
 */
export interface WaitingBudget {
  ahead: number;
  max: number;
}

/**
 * Composes up to `count` cards from `rows` (newest first), continuing `run`
 * from the page before; see `SOURCE_MIX`. Deterministic: the cards depend on
 * the rows, their order, `run` and `budget` alone.
 *
 * With a `budget`, a place never passes over more stories than the next
 * cursor can carry: every story above the page's oldest card that is not
 * shown waits, so a pick that would leave more than `budget.max` waiting is
 * out of reach. When the budget is spent the rules give way to the newest
 * stories instead -- a source above its share, never a story lost or shown
 * twice (T-1833).
 */
export function mixSources<T extends Mixable>(
  rows: readonly T[],
  count: number,
  run: SourceRun | null = null,
  budget: WaitingBudget | null = null,
): { cards: T[]; run: SourceRun | null } {
  // Each remaining row with its place in `rows`, to count what waits.
  const remaining = rows.map((row, at) => ({ row, at }));
  const cards: T[] = [];
  const shown = new Map<string, number>();
  let last = run;
  const max = budget?.max ?? Number.POSITIVE_INFINITY;
  // The oldest card so far (a place in `rows`), and how many remaining rows lie above it.
  let oldest = (budget?.ahead ?? 0) - 1;
  let waiting = budget?.ahead ?? 0;
  /** How many would wait after picking the remaining row at `i`. */
  const waitingAfter = (i: number): number => (remaining[i]!.at > oldest ? i : waiting - 1);
  while (cards.length < count && remaining.length > 0) {
    const reach = Math.min(SOURCE_MIX.lookahead, remaining.length);
    const cap = Math.ceil(SOURCE_MIX.maxShare * (cards.length + 1));
    const blocked = last !== null && last.length >= SOURCE_MIX.maxRun ? last.source : null;
    let pick = -1;
    let runOnly = -1;
    for (let i = 0; i < reach; i += 1) {
      // Rows further down only leave more waiting.
      if (waitingAfter(i) > max) break;
      const source = remaining[i]!.row.source_id;
      if (source === blocked) continue;
      if (runOnly === -1) runOnly = i;
      if ((shown.get(source) ?? 0) < cap) {
        pick = i;
        break;
      }
    }
    const index = pick !== -1 ? pick : runOnly !== -1 ? runOnly : 0;
    const taken = remaining.splice(index, 1)[0]!;
    if (taken.at > oldest) {
      oldest = taken.at;
      waiting = index;
    } else {
      waiting -= 1;
    }
    const card = taken.row;
    cards.push(card);
    shown.set(card.source_id, (shown.get(card.source_id) ?? 0) + 1);
    last =
      last !== null && last.source === card.source_id
        ? { source: card.source_id, length: Math.min(last.length + 1, SOURCE_MIX.maxRun) }
        : { source: card.source_id, length: 1 };
  }
  return { cards, run: last };
}
