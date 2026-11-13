/**
 * The latest list's mix of sources (T-1816, D-411).
 *
 * One busy source must not fill the top of the list: Yahoo Sports wrote about
 * 30% of a day's English stories and the first forty in a row. The list is
 * composed in order, newest first, and each place takes the newest story
 * within reach that keeps both rules:
 *
 * - no more than `maxRun` cards in a row from one source;
 * - no source above `maxShare` of the list so far, rounded up (one of the
 *   first three cards, two of the first six, twelve of the first forty), so
 *   the rule holds for every top of the list: the homepage's six and the news
 *   page's forty alike.
 *
 * Nothing is left out. A story that would break a rule waits for a later
 * place -- while its source holds its share of the list so far -- and one
 * source's stories keep their own order. Only the next `lookahead` stories
 * not yet placed are within reach: when none of them keeps both rules, the
 * run rule alone decides, and when none keeps that either (all from one
 * source), the newest takes the place, so the list never stalls.
 *
 * Deterministic: the list depends on the stories alone, in their order. With
 * `complete` false the rows are only the newest of more; composing then stops
 * where a place's reach would pass the last row, so what is composed is
 * exactly what the whole list begins with, and a longer read continues it.
 */
export const SOURCE_MIX = {
  maxRun: 3,
  maxShare: 0.3,
  lookahead: 50,
} as const;

export interface Mixable {
  source_id: string;
}

/** Composes up to `count` cards from `rows` (newest first); see `SOURCE_MIX`. */
export function mixSources<T extends Mixable>(
  rows: readonly T[],
  count: number,
  complete: boolean,
): T[] {
  const remaining = rows.slice();
  const out: T[] = [];
  const shown = new Map<string, number>();
  while (out.length < count && remaining.length > 0) {
    if (!complete && remaining.length < SOURCE_MIX.lookahead) break;
    const reach = Math.min(SOURCE_MIX.lookahead, remaining.length);
    const cap = Math.ceil(SOURCE_MIX.maxShare * (out.length + 1));
    const run = out.slice(-SOURCE_MIX.maxRun);
    const blocked =
      run.length === SOURCE_MIX.maxRun && run.every((r) => r.source_id === run[0]!.source_id)
        ? run[0]!.source_id
        : null;
    let pick = -1;
    let runOnly = -1;
    for (let i = 0; i < reach; i += 1) {
      const source = remaining[i]!.source_id;
      if (source === blocked) continue;
      if (runOnly === -1) runOnly = i;
      if ((shown.get(source) ?? 0) < cap) {
        pick = i;
        break;
      }
    }
    const index = pick !== -1 ? pick : runOnly !== -1 ? runOnly : 0;
    const [card] = remaining.splice(index, 1);
    out.push(card!);
    shown.set(card!.source_id, (shown.get(card!.source_id) ?? 0) + 1);
  }
  return out;
}
