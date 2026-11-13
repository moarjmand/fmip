/**
 * Headlines the news lists do not show (T-1818, D-413).
 *
 * A named list, each entry a decision: a headline that starts with one of
 * these words, as whole words, is left out of every card list as it is
 * read. Nothing is deleted -- the news job stores such an item as it stores
 * any other, and taking an entry off this list shows its stories again on
 * the next read.
 *
 * The comparison folds what Persian text varies in without changing the
 * words: Arabic yeh and kaf to the Persian letters, runs of white space to
 * one space, and the case of Latin letters. The words must end where the
 * entry does: a suffix joined by the zero-width non-joiner ("بازی‌های",
 * "matches") is another word, so "پخش زنده بازی‌های جام جهانی" is shown.
 */
export interface HiddenHeadline {
  /** What the entry is, for the docs and a test's message. */
  key: string;
  /** The decision that listed it. */
  decision: string;
  /** The words a headline starts with, as written. */
  startsWith: string;
}

export const HIDDEN_HEADLINES: readonly HiddenHeadline[] = [
  // An invitation to watch a match on the publisher's own site ("live broadcast
  // of the match ... watch free"), not a report (finding cnt-2026-11-04-02).
  { key: 'live-stream-invitation', decision: 'D-413', startsWith: 'پخش زنده بازی' },
];

function fold(text: string): string {
  return text
    .replace(/\u064A/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const FOLDED = HIDDEN_HEADLINES.map((h) => ({ key: h.key, start: fold(h.startsWith) }));

/** After the entry's words: the end, a space or a punctuation mark. */
const WORD_END = /^(?:$|[\s\p{P}])/u;

/** The entry that hides this headline, or `null` when it is shown. */
export function hiddenHeadline(headline: string): string | null {
  const text = fold(headline);
  const hit = FOLDED.find(
    (h) => text.startsWith(h.start) && WORD_END.test(text.slice(h.start.length)),
  );
  return hit?.key ?? null;
}
