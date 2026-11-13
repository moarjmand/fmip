/**
 * A photo credit glued into a publisher's summary, taken out (T-1797).
 *
 * Some feeds carry the lead photo's caption inside the description, and once
 * the markup is gone it runs into the words around it: "...a move to
 * Arsenal.Photo by Maja Hitij/Getty ImagesPhilipp Hinze of Sky Sport Germany
 * reports...". The credit is not the summary; the photo, where one is shown,
 * carries its own credit (D-177).
 *
 * It runs before a summary is stored, so a wrong cut would be lost for good.
 * Only one closed shape is removed, and only where it cannot be the
 * publisher's prose:
 *
 * - "Photo by", "Photograph by", "Picture by" or "Image by" (or a plural), a
 *   name starting with a capital, then "/" and a picture agency from the
 *   closed list `PICTURE_AGENCIES`, more agencies after "/" ("PA Wire/PA
 *   Images") or "via" ("AFP via Getty Images") allowed, in brackets or not;
 * - at the very start of the summary, right after a sentence's end ("." "!"
 *   "?" "…", glued or not), or at the very end of the summary;
 * - followed by the end, by a space and a capital, or by a capitalised word
 *   glued on ("Getty ImagesPhilipp"). A credit followed by anything else
 *   ("Getty Images for Premier League") is left whole.
 *
 * Everything else -- a credit the feed cut off, "Pictures by fans show...",
 * a summary that is a credit and nothing more -- stays exactly as written
 * (rule 3: a summary is never rewritten), whitespace included. Pure; the
 * news job applies it when an item is taken in, and the API applies it again
 * when a stored summary is read, so a story stored before this rule reads the
 * same without rewriting its row.
 */

/** Picture agencies a credit ends with; matched longest first, so "Getty Images" wins over "Getty". */
export const PICTURE_AGENCIES = [
  'Getty Images',
  'Getty',
  'AFP via Getty Images',
  'AFP',
  'Reuters',
  'AP Photo',
  'AP',
  'PA Images',
  'PA Wire',
  'PA',
  'EPA-EFE',
  'EPA',
  'Shutterstock',
  'Alamy',
  'IMAGO',
  'Imago',
  'Offside',
  'Sportsfile',
  'Icon Sportswire',
  'USA TODAY Sports',
  'Action Images',
  'NurPhoto',
  'Sportsphoto',
  'Visionhaus',
] as const;

const LONGEST_FIRST = [...PICTURE_AGENCIES].sort((a, b) => b.length - a.length);

/** Where a credit may start: "Photo by ", "(Pictures by ", ... */
const OPENER = /\(?(?:Photo(?:graph)?|Picture|Image)s? by /gu;
/** The photographer: a capital, then up to 59 more of anything but a slash, a bracket or a line break. */
const NAME = /^\p{Lu}[^/()\n]{0,59}?\s*\/\s*/u;
/** What a summary looks like just before a credit glued after a sentence. */
const SENTENCE_END = /[.!?…]["'’”)\]]?\s*$/u;
/** What may follow a credit: the end, a space and a capital or an opening quote, or a capitalised word glued on. */
const AFTER = /^(?:\s*$|\s+[\p{Lu}"'‘“(]|\p{Lu}\p{Ll})/u;

/** The agency at the start of `text`, longest first and never shortened (no "Getty" out of "Getty Images"). */
function agencyAt(text: string): string | null {
  return LONGEST_FIRST.find((agency) => text.startsWith(agency)) ?? null;
}

/** The length of the credit's tail from its first agency, or `null` when no agency closes it. */
function agenciesLength(text: string): number | null {
  const first = agencyAt(text);
  if (first === null) return null;
  let at = first.length;
  for (;;) {
    const joint = /^(?:\s*\/\s*| via )/u.exec(text.slice(at));
    const next = joint === null ? null : agencyAt(text.slice(at + joint[0].length));
    if (joint === null || next === null) return at;
    at += joint[0].length + next.length;
  }
}

/** The end of a credit starting at `from` in `text`, or `null` when what is there is not one. */
function creditEnd(text: string, from: number, opener: string): number | null {
  const afterOpener = from + opener.length;
  const name = NAME.exec(text.slice(afterOpener));
  if (name === null) return null;
  const agencyFrom = afterOpener + name[0].length;
  const tail = agenciesLength(text.slice(agencyFrom));
  if (tail === null) return null;
  let end = agencyFrom + tail;
  if (opener.startsWith('(')) {
    const close = /^\s*\)/u.exec(text.slice(end));
    if (close === null) return null;
    end += close[0].length;
  }
  // "...Getty Images. Ten Hag said": the caption's own full stop goes with it.
  if (text[end] === '.' && AFTER.test(text.slice(end + 1))) end += 1;
  return AFTER.test(text.slice(end)) ? end : null;
}

export function stripPhotoCredit(summary: string | null): string | null {
  if (summary === null) return null;
  let kept = '';
  let from = 0;
  for (const match of summary.matchAll(OPENER)) {
    const start = match.index;
    if (start < from) continue;
    const end = creditEnd(summary, start, match[0]);
    if (end === null) continue;
    const before = kept + summary.slice(from, start);
    const rest = summary.slice(end);
    const atStart = before.trim() === '';
    const atEnd = rest.trim() === '';
    const afterSentence = SENTENCE_END.test(before);
    if (!atStart && !afterSentence && !(atEnd && /\s$/u.test(before))) continue;
    // One space where the credit was, none at the summary's either end.
    kept = atStart ? '' : atEnd ? before.trimEnd() : `${before.trimEnd()} `;
    from = end;
    // The next words start after the space just written.
    while (from < summary.length && /\s/u.test(summary[from]!)) from += 1;
  }
  if (from === 0) return summary;
  const cleaned = kept + summary.slice(from);
  // A summary that was a credit and nothing more is left as it was, never emptied.
  return cleaned.trim() === '' ? summary : cleaned;
}
