/**
 * A photo credit glued into a publisher's summary, taken out (T-1797).
 *
 * Some feeds carry the lead photo's caption inside the description, and once
 * the markup is gone it runs into the words around it: "...a move to
 * Arsenal.Photo by Maja Hitij/Getty ImagesPhilipp Hinze of Sky Sport Germany
 * reports...". The credit is not the summary; the photo, where one is shown,
 * carries its own credit (D-177). Two shapes are removed and nothing else:
 *
 * - "Photo by <name>/<agency>" anywhere, the agency one of a closed list of
 *   picture agencies (`PICTURE_AGENCIES`), so the end of the credit is known
 *   even when the next sentence is glued on;
 * - a credit cut off at the end of the summary ("... Photo by Lewis St..."),
 *   where the feed truncated the description inside it.
 *
 * Everything else is the publisher's words and stays as written (rule 3: a
 * summary is never rewritten). Pure; the news job applies it when an item is
 * taken in, and the API applies it again when a stored summary is read, so a
 * story stored before this rule reads the same without rewriting its row.
 */

/** Picture agencies a credit ends with, longest first so "Getty Images" wins over "Getty". */
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

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const AGENCY = [...PICTURE_AGENCIES]
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join('|');

/** "(Photo by Maja Hitij/Getty Images)", with or without the brackets. */
const GLUED = new RegExp(
  `\\(?\\s*(?:Photo|Picture|Image)s? by [^/()\\n]{2,60}?\\s*/\\s*(?:${AGENCY})(?: via (?:${AGENCY}))?\\s*\\)?`,
  'gu',
);

/** A credit the feed cut off at the end, its ellipsis the sign of the cut: "Photo by Lewis St..." */
const CUT_AT_END = /\s*\(?(?:Photo|Picture|Image)s? by [^.!?]{0,80}(?:\.\.\.|…)\s*$/u;

export function stripPhotoCredit(summary: string | null): string | null {
  if (summary === null) return null;
  const cleaned = summary.replace(GLUED, ' ').replace(CUT_AT_END, '').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}
