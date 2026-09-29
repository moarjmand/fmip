/**
 * The automatic translation checks (T-1012, D-131): a pure function over the
 * publisher's version and a person's translation of it. Each check reads the
 * two texts and says `pass`, `fail` or `not_checked` for one field, with what
 * it expected and what it found. **A check never rewrites the text**: it has
 * no output but its verdict, and the translator's words are theirs (D-066).
 *
 * The review endpoint refuses a version with a failing check unless the
 * reviewer records a reason for passing it (`translation_check_override`);
 * the desk (T-1013) shows each result beside the field it concerns.
 */
import type { ApiError } from './identity';

export const TRANSLATION_CHECKS = [
  'empty',
  'numbers',
  'scorelines',
  'dates',
  'names',
  'links',
  'markup',
] as const;
export type TranslationCheck = (typeof TRANSLATION_CHECKS)[number];

export const TRANSLATION_FIELDS = ['headline', 'summary', 'byline'] as const;
export type TranslationField = (typeof TRANSLATION_FIELDS)[number];

export type TranslationTexts = Record<TranslationField, string | null>;

/**
 * A name the translation must carry: an entity the article links, or a locked
 * glossary term. Wherever one of `sources` appears in the source field, one of
 * `targets` must appear in the translated field. `targets` empty means nobody
 * has written this name in the target language yet -- neither a localised name
 * (T-303) nor a glossary term (T-1011) -- and the check says it could not
 * check it rather than passing or failing.
 */
export interface TranslationName {
  /** `team.<uuid>`, `person.<uuid>`, `competition.<uuid>` or a glossary key. */
  key: string;
  sources: string[];
  targets: string[];
}

export interface TranslationCheckContext {
  /** BCP 47 tags of the two versions, for month names. */
  sourceLanguage: string;
  targetLanguage: string;
  names: TranslationName[];
}

export type TranslationCheckOutcome = 'pass' | 'fail' | 'not_checked';

export interface TranslationCheckResult {
  check: TranslationCheck;
  field: TranslationField;
  outcome: TranslationCheckOutcome;
  /** What the source carries that the translation must carry too. */
  expected: string[];
  /** What the translation carries. */
  found: string[];
  /** One sentence for the desk and the refusal. */
  detail: string;
}

/** A reviewer's reason for passing one failing check on the version under review. */
export interface TranslationCheckOverride {
  check: TranslationCheck;
  field: TranslationField;
  reason: string;
}

/** `POST /admin/articles/:id/translations/:language/review` (T-304, T-1012). */
export interface TranslationReviewRequest {
  overrides?: TranslationCheckOverride[];
}

/**
 * The review's refusal while checks fail without a reason: every failure, and
 * `fields` keyed `<field>.<check>` with each one's sentence.
 */
export interface TranslationReviewRefusal extends ApiError {
  checks: TranslationCheckResult[];
}

// --- Digits and numbers ---------------------------------------------------

/**
 * Arabic-Indic (U+0660) and Extended Arabic-Indic, Persian (U+06F0) digits to
 * Latin ones, and the Arabic decimal and thousands separators to `.` and `,`,
 * so "٢٫٥" and "۲٫۵" and "2.5" are one number.
 */
export function latinDigits(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else if (code === 0x066b) out += '.';
    else if (code === 0x066c) out += ',';
    else out += char;
  }
  return out;
}

/** "1,000" and "1.000" are a thousand; "2,5" and "2.5" are two and a half; "09" is 9. */
function numberValue(raw: string): string {
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return String(Number(raw.replace(/[.,]/g, '')));
  return String(Number(raw.replace(',', '.')));
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

function numbersIn(text: string): string[] {
  return [...latinDigits(text).matchAll(NUMBER)].map((match) => numberValue(match[0]));
}

// --- Dates ------------------------------------------------------------------

interface DateFound {
  day: number;
  month: number;
  year: number | null;
}

const ENGLISH_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** A tag `Intl` accepts, or English for one it does not. */
function canonical(language: string): string {
  try {
    return Intl.getCanonicalLocales(language)[0] ?? 'en';
  } catch {
    return 'en';
  }
}

/**
 * Every name a language gives each month (long and short, standalone and in a
 * date), with the English names beside them: a translation may keep them.
 */
function monthNames(locale: string): string[][] {
  const names: string[][] = ENGLISH_MONTHS.map((english) => [english, english.slice(0, 3)]);
  for (let month = 0; month < 12; month += 1) {
    const date = new Date(Date.UTC(2026, month, 15));
    for (const style of ['long', 'short'] as const) {
      const standalone = new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' });
      const inDate = new Intl.DateTimeFormat(locale, {
        month: style,
        day: 'numeric',
        timeZone: 'UTC',
      });
      const parts = [
        standalone.format(date),
        ...inDate
          .formatToParts(date)
          .filter((part) => part.type === 'month')
          .map((part) => part.value),
      ];
      for (const part of parts) {
        const name = part.toLocaleLowerCase(locale).replace(/\.$/, '');
        if (name !== '' && !/^\d+$/.test(latinDigits(name)) && !names[month]!.includes(name)) {
          names[month]!.push(name);
        }
      }
    }
  }
  return names;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETTER = '\\p{L}\\p{M}';

/** Dates in a text: numeric with a year, and a day beside a month's name. */
function datesIn(text: string, language: string): { dates: DateFound[]; masked: string } {
  const locale = canonical(language);
  let masked = latinDigits(text);
  const dates: DateFound[] = [];
  const take = (pattern: RegExp, read: (match: RegExpExecArray) => DateFound | null) => {
    masked = masked.replace(pattern, (...args: unknown[]) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const found = read(match);
      if (found === null) return match[0];
      dates.push(found);
      return ' '.repeat(match[0].length);
    });
  };
  const valid = (day: number, month: number) => day >= 1 && day <= 31 && month >= 1 && month <= 12;

  take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) =>
    valid(Number(m[3]), Number(m[2]))
      ? { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) }
      : null,
  );
  take(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g, (m) =>
    valid(Number(m[1]), Number(m[2]))
      ? { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) }
      : null,
  );

  const months = monthNames(locale);
  const alternatives = months
    .flatMap((names, index) => names.map((name) => ({ name, month: index + 1 })))
    .sort((a, b) => b.name.length - a.name.length);
  const monthOf = (word: string) =>
    alternatives.find((entry) => entry.name === word.toLocaleLowerCase(locale))?.month ?? null;
  const pattern = alternatives.map((entry) => escapeRegExp(entry.name)).join('|');
  // "12 May 2026", "May 12, 2026", "29 de septiembre de 2026".
  const year = '(?:,?\\s*(?:de\\s+)?(\\d{4}))?';
  const dayFirst = new RegExp(
    `(?<![\\d${LETTER}])(\\d{1,2})\\.?\\s*(?:de\\s+)?(${pattern})(?![${LETTER}])\\.?${year}`,
    'giu',
  );
  const monthFirst = new RegExp(
    `(?<![${LETTER}])(${pattern})\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?${year}`,
    'giu',
  );
  take(dayFirst, (m) => {
    const month = monthOf(m[2]!);
    return month !== null && valid(Number(m[1]), month)
      ? { day: Number(m[1]), month, year: m[3] ? Number(m[3]) : null }
      : null;
  });
  take(monthFirst, (m) => {
    const month = monthOf(m[1]!);
    return month !== null && valid(Number(m[2]), month)
      ? { day: Number(m[2]), month, year: m[3] ? Number(m[3]) : null }
      : null;
  });
  return { dates, masked };
}

const showDate = (date: DateFound) =>
  `${date.day}/${date.month}${date.year === null ? '' : `/${date.year}`}`;

// --- Scorelines, links, markup ----------------------------------------------

const SCORELINE = /(?<![\d.,])(\d{1,2})\s?[-–—:]\s?(\d{1,2})(?![\d.,])/g;

function scorelinesIn(masked: string): string[] {
  return [...masked.matchAll(SCORELINE)].map((match) => `${Number(match[1])}-${Number(match[2])}`);
}

const LINK = /https?:\/\/[^\s<>"'()]+/g;

function linksIn(text: string): string[] {
  return [...text.matchAll(LINK)].map((match) => match[0].replace(/[.,;:!?]+$/, ''));
}

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
const ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g;

function markupIn(text: string): string[] {
  return [
    ...[...text.matchAll(TAG)].map((match) =>
      match[0].startsWith('</') ? `</${match[1]!.toLowerCase()}>` : `<${match[1]!.toLowerCase()}>`,
    ),
    ...[...text.matchAll(ENTITY)].map((match) => match[0]),
  ];
}

// --- Names --------------------------------------------------------------------

/** Whether `name` appears in `text` as whole words, in any script. */
function contains(text: string, name: string, ignoreCase: boolean): boolean {
  if (name.trim() === '') return false;
  return new RegExp(
    `(?<![${LETTER}\\d])${escapeRegExp(name.trim())}(?![${LETTER}\\d])`,
    ignoreCase ? 'iu' : 'u',
  ).test(text);
}

// --- The comparison -----------------------------------------------------------

const sorted = (items: string[]) => [...items].sort();

/** What the source has that the translation lacks, and the other way, as multisets. */
function difference(expected: string[], found: string[]): { missing: string[]; extra: string[] } {
  const left = [...found];
  const missing: string[] = [];
  for (const item of expected) {
    const at = left.indexOf(item);
    if (at === -1) missing.push(item);
    else left.splice(at, 1);
  }
  return { missing, extra: left };
}

function compared(
  check: TranslationCheck,
  field: TranslationField,
  expected: string[],
  found: string[],
  noun: string,
): TranslationCheckResult {
  const { missing, extra } = difference(expected, found);
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing ${missing.join(', ')}`);
  if (extra.length > 0) parts.push(`not in the source: ${extra.join(', ')}`);
  return {
    check,
    field,
    outcome: parts.length === 0 ? 'pass' : 'fail',
    expected: sorted(expected),
    found: sorted(found),
    detail:
      parts.length === 0
        ? expected.length === 0
          ? `No ${noun} in either.`
          : `The same ${noun}.`
        : `The ${noun} differ: ${parts.join('; ')}.`,
  };
}

/**
 * Every check on every field either version carries. A field neither carries
 * has no results; a field only one carries fails `empty` and is not compared
 * further, because there is nothing on the other side to compare.
 */
export function checkTranslation(
  source: TranslationTexts,
  target: TranslationTexts,
  context: TranslationCheckContext,
): TranslationCheckResult[] {
  const results: TranslationCheckResult[] = [];
  for (const field of TRANSLATION_FIELDS) {
    const from = source[field]?.trim() ?? '';
    const into = target[field]?.trim() ?? '';
    if (from === '' && into === '') continue;
    if (from === '' || into === '') {
      results.push({
        check: 'empty',
        field,
        outcome: 'fail',
        expected: from === '' ? [] : [field],
        found: into === '' ? [] : [field],
        detail:
          from === ''
            ? `The source has no ${field}; the translation must not add one.`
            : `The source has a ${field}; the translation leaves it empty.`,
      });
      continue;
    }
    results.push({
      check: 'empty',
      field,
      outcome: 'pass',
      expected: [field],
      found: [field],
      detail: 'Both carry it.',
    });

    // Dates are compared as dates and taken out of the text before the
    // numbers and scorelines are read, so "2026-09-29" and "29 سبتمبر 2026"
    // are one date rather than three numbers of which one went missing.
    const fromDates = datesIn(from, context.sourceLanguage);
    const intoDates = datesIn(into, context.targetLanguage);
    results.push(
      compared(
        'numbers',
        field,
        numbersIn(fromDates.masked),
        numbersIn(intoDates.masked),
        'numbers',
      ),
    );
    results.push(
      compared(
        'scorelines',
        field,
        scorelinesIn(fromDates.masked),
        scorelinesIn(intoDates.masked),
        'scorelines',
      ),
    );
    results.push(datesResult(field, fromDates.dates, intoDates.dates));
    results.push(namesResult(field, from, into, context.names));
    results.push(compared('links', field, linksIn(from), linksIn(into), 'links'));
    results.push(compared('markup', field, markupIn(from), markupIn(into), 'markup'));
  }
  return results;
}

function datesResult(
  field: TranslationField,
  from: DateFound[],
  into: DateFound[],
): TranslationCheckResult {
  // A date matches on day and month, and on the year when both give one: a
  // translation may drop "2026" from "12 May 2026" no more than the source did.
  const missing = from.filter(
    (date) =>
      !into.some(
        (other) =>
          other.day === date.day &&
          other.month === date.month &&
          (date.year === null || other.year === null || other.year === date.year),
      ),
  );
  const extra = into.filter(
    (date) => !from.some((other) => other.day === date.day && other.month === date.month),
  );
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing ${missing.map(showDate).join(', ')}`);
  if (extra.length > 0) parts.push(`not in the source: ${extra.map(showDate).join(', ')}`);
  return {
    check: 'dates',
    field,
    outcome: parts.length === 0 ? 'pass' : 'fail',
    expected: from.map(showDate),
    found: into.map(showDate),
    detail:
      parts.length === 0
        ? from.length === 0
          ? 'No dates in either.'
          : 'The same dates.'
        : `The dates differ (day/month/year): ${parts.join('; ')}.`,
  };
}

function namesResult(
  field: TranslationField,
  from: string,
  into: string,
  names: TranslationName[],
): TranslationCheckResult {
  const expected: string[] = [];
  const found: string[] = [];
  const missing: string[] = [];
  const unchecked: string[] = [];
  for (const name of names) {
    const inSource = name.sources.find((source) => contains(from, source, true));
    if (inSource === undefined) continue;
    if (name.targets.length === 0) {
      unchecked.push(inSource);
      continue;
    }
    expected.push(name.targets.join(' / '));
    const carried = name.targets.find((target) => contains(into, target, false));
    if (carried === undefined) missing.push(`${inSource} (${name.targets.join(' or ')})`);
    else found.push(carried);
  }
  if (missing.length > 0) {
    return {
      check: 'names',
      field,
      outcome: 'fail',
      expected,
      found,
      detail: `The translation does not carry ${missing.join(', ')} as written in this language.`,
    };
  }
  if (unchecked.length > 0) {
    return {
      check: 'names',
      field,
      outcome: 'not_checked',
      expected,
      found,
      detail: `Nobody has written ${unchecked.join(', ')} in this language yet (no localised name, no glossary term), so it could not be checked.`,
    };
  }
  return {
    check: 'names',
    field,
    outcome: 'pass',
    expected,
    found,
    detail:
      expected.length === 0
        ? 'No linked or locked names in the source.'
        : 'Every name as written in this language.',
  };
}

/** The results a review is refused for: every failing one without a recorded reason. */
export function unresolvedFailures(
  results: TranslationCheckResult[],
  overrides: Pick<TranslationCheckOverride, 'check' | 'field'>[],
): TranslationCheckResult[] {
  return results.filter(
    (result) =>
      result.outcome === 'fail' &&
      !overrides.some(
        (override) => override.check === result.check && override.field === result.field,
      ),
  );
}
