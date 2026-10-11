/**
 * One name style per match page (T-1395, D-210).
 *
 * A player's stored name is the one the feed first gave him, and the feed
 * writes most players as an initial and a surname ("M. Salah") but some in
 * full ("Mohamed Salah"), the same field in line-ups, events and player
 * statistics alike. Squads are not read for names (they only bring photos,
 * T-1324), so no stored full form exists for the short ones: writing every
 * name in full would need a backfill of the provider's player records. What
 * the data does allow is the other way round: on the dense lists of a match
 * page (line-ups, incidents, player statistics, absences, key players) a
 * full Latin-script name is shortened to the same style as the rest,
 * "M. Salah" beside "V. van Dijk".
 *
 * Conservative on purpose, so no name is mangled:
 *  - only a name whose first word is Latin letters (a capital, then
 *    lower-case), so a name in another script, an initial already given, or a
 *    lower-case particle ("van", "de") is never touched;
 *  - only when every other word is a word ("Player 7" stays) and they are
 *    more than a generational word ("Vinícius Júnior" stays);
 *  - never on a Persian page: its names are its own (D-175).
 *
 * The player's own page and the `title` / image `alt` keep the stored name.
 */

const FIRST = /^\p{Lu}\p{Ll}+(?:[-'’]\p{Lu}?\p{Ll}+)*$/u;
const LATIN = /^[\p{Script=Latin}'’-]+$/u;
const WORD = /^\p{L}[\p{L}'’.-]*$/u;
const GENERATIONAL = new Set([
  'junior',
  'júnior',
  'jr',
  'jr.',
  'filho',
  'neto',
  'sobrinho',
  'ii',
  'iii',
]);

export function listName(locale: string, name: string): string {
  if (locale === 'fa') return name;
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name;
  const [first, ...rest] = words;
  if (first === undefined || !FIRST.test(first) || !LATIN.test(first)) return name;
  if (!rest.every((word) => WORD.test(word))) return name;
  if (rest.every((word) => GENERATIONAL.has(word.toLowerCase()))) return name;
  return `${first.charAt(0)}. ${rest.join(' ')}`;
}
