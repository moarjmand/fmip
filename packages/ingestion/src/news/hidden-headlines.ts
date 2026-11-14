/**
 * Headlines the news lists do not show (T-1818, D-413).
 *
 * A named list, each entry a decision: a headline that starts with the
 * entry's words, as whole words, and also carries one of its markers as a
 * whole word is left out of every list of stories a reader is shown -- the
 * news sections and
 * related news, the Following feed and briefings, story search. It is applied
 * on read only: the news job stores such an item as it stores any other,
 * nothing is deleted, and taking an entry off this list shows its stories
 * again on the next read. (Unlike `nonArticleKind`, which the job also
 * applies before it writes.)
 *
 * The marker keeps a real report out of the rule: «پخش زنده بازی ایران و
 * آمریکا لغو شد» (the broadcast was cancelled) starts with the same words but
 * invites nobody to watch.
 *
 * The comparison folds what Persian text varies in without changing the
 * words: Arabic yeh, alef maksura and kaf to the Persian letters, bidi marks
 * and white space at the start, runs of white space to one space, and the case
 * of Latin letters. The words must end where the entry does: a suffix joined
 * by the zero-width non-joiner («بازی‌های», "matches") is another word.
 */
export interface HiddenHeadline {
  /** What the entry is, for the docs and a test's message. */
  key: string;
  /** The decision that listed it. */
  decision: string;
  /** The words a headline starts with, as written. */
  startsWith: string;
  /** Words at least one of which the headline must also carry. */
  markers: readonly string[];
}

export const HIDDEN_HEADLINES: readonly HiddenHeadline[] = [
  // An invitation to watch a match on the publisher's own site («پخش زنده بازی
  // آرسنال و اورتون/ تماشای زنده و رایگان لیگ برتر در سایت خبرورزشی»), not a
  // report (finding cnt-2026-11-04-02). The markers are the words those
  // headlines carry, each a whole word: watch («تماشا», «تماشای رایگان»),
  // online, a link -- never «تماشاگران», the spectators of a report.
  {
    key: 'live-stream-invitation',
    decision: 'D-413',
    startsWith: 'پخش زنده بازی',
    markers: ['تماشا', 'تماشای', 'آنلاین', 'لینک'],
  },
];

function fold(text: string): string {
  return text
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/^[\s\u200E\u200F\u202A-\u202E\u2066-\u2069]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const FOLDED = HIDDEN_HEADLINES.map((h) => ({
  key: h.key,
  start: fold(h.startsWith),
  markers: h.markers.map(fold),
}));

/** After the entry's words: the end, a space or a punctuation mark. */
const WORD_END = /^(?:$|[\s\p{P}])/u;

/** Before a marker: the start, a space or a punctuation mark. */
const WORD_START = /(?:^|[\s\p{P}])$/u;

/** Whether `word` stands in `text` as a whole word somewhere. */
function hasWord(text: string, word: string): boolean {
  for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + 1)) {
    if (WORD_START.test(text.slice(0, i)) && WORD_END.test(text.slice(i + word.length))) {
      return true;
    }
  }
  return false;
}

/** The entry that hides this headline, or `null` when it is shown. */
export function hiddenHeadline(headline: string): string | null {
  const text = fold(headline);
  const hit = FOLDED.find(
    (h) =>
      text.startsWith(h.start) &&
      WORD_END.test(text.slice(h.start.length)) &&
      h.markers.some((m) => hasWord(text, m)),
  );
  return hit?.key ?? null;
}
