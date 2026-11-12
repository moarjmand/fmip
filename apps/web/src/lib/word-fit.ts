/**
 * A name or a status word is whole, never broken inside a word (T-1796,
 * D-395: D-368's "a name whole or absent", extended to every name and status
 * word). Pure, so the rule is tested once and every surface shares it.
 *
 * - `NAME_WRAP`: a line may break between words, never inside one while the
 *   word fits its line (`overflow-wrap: break-word`, not `anywhere`, which
 *   also shrinks the cell's minimum to a letter), and the browser never
 *   hyphenates by itself (`hyphens: manual`).
 * - `nameFit(text, fits, scope)`: a single long word steps the font's width
 *   axis down instead, 87.5% then 75% (Archivo's width axis runs 62 to 125;
 *   Vazirmatn has none, so a Persian name is untouched). `fits` is how many
 *   letters the surface's cell holds at normal width; the server picks the
 *   class from the longest word's length, no script. Measured on the live
 *   matches page: "Mönchengladbach" at 14px semi-bold is 123px wide at 100%,
 *   108px at 87.5% and 96px at 75%, in a 107px cell.
 * - `statusFit(label)`: a status word in a match row's time cell
 *   ("Postponed", "Awaiting update", "Cancelled") at 11px and 75% width.
 */

export const NAME_WRAP = 'break-words hyphens-manual';

/** The letters of the longest word in `text` (split at spaces and hyphens). */
export function longestWord(text: string): number {
  let longest = 0;
  for (const word of text.split(/[\s\-‐‑–—/]+/u)) {
    const letters = Array.from(word).length;
    if (letters > longest) longest = letters;
  }
  return longest;
}

/** 0: as drawn; 1: 87.5% width; 2: 75% width. */
export type WidthStep = 0 | 1 | 2;

/** The step a word of `letters` needs in a cell holding `fits` letters at 100%. */
export function widthStep(text: string, fits: number): WidthStep {
  const letters = longestWord(text);
  if (letters <= fits) return 0;
  if (letters <= fits / 0.875) return 1;
  return 2;
}

/**
 * Where a step applies: everywhere, below a breakpoint, or in a match row
 * below its list's 36rem container width (`match-row`), where the cell is
 * narrow. Every class is written out whole so Tailwind finds it; each scope
 * is its own export, so a page's bundle carries only the scopes it uses.
 */
export type WidthSteps = readonly [string, string, string];
export const ALL_STEPS: WidthSteps = ['', 'font-stretch-semi-condensed', 'font-stretch-condensed'];
export const PHONE_STEPS: WidthSteps = [
  '',
  'max-sm:font-stretch-semi-condensed',
  'max-sm:font-stretch-condensed',
];
export const NARROW_STEPS: WidthSteps = [
  '',
  'max-md:font-stretch-semi-condensed',
  'max-md:font-stretch-condensed',
];
export const ROW_STEPS: WidthSteps = [
  '',
  '@max-xl:font-stretch-semi-condensed',
  '@max-xl:font-stretch-condensed',
];

/** The width class for `text` in a cell of `fits` letters (`''` when it fits). */
export function nameFit(text: string, fits: number, steps: WidthSteps): string {
  return steps[widthStep(text, fits)];
}

/**
 * A match row's time cell (52px on a desktop, 56px on a phone): the kick-off
 * time, a minute or "FT" as they were, a status word of seven letters or
 * more at 11px and 75% width so it stays a word ("Postponed" needed 71px at
 * 14px and 87.5%). A two-word status still wraps between its words.
 */
export const STATUS_WORD_LETTERS = 7;

export function statusFit(label: string): string {
  return longestWord(label) >= STATUS_WORD_LETTERS
    ? `${NAME_WRAP} text-[11px] leading-tight font-stretch-condensed`
    : `${NAME_WRAP} text-xs leading-tight font-stretch-semi-condensed @xl:text-sm`;
}
