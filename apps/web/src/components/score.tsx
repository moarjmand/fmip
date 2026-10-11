import { formatNumber } from '@/i18n/format';
import { directionOf } from '@/i18n/locales';

/**
 * A score, rendered so it cannot be read backwards (T-153, T-1375, rule 7).
 *
 * **The rule.** A score is a pair, home first, read in the page's own
 * direction: on an English page the home goals sit on the left, on a Persian
 * or Arabic page on the right -- the side the home team is on, since a score
 * row mirrors (home, score, away laid out from the inline start). A Persian
 * reader reading right to left reads "home – away", and the home goals sit
 * beside the home team.
 *
 * **The bug this exists to prevent.** Left to the paragraph, the two numbers
 * and the dash between them are resolved by the bidirectional algorithm
 * against whatever is next to them: an English team name pulls the pair left
 * to right in the middle of a Persian line, and `2 – 1` can come apart. T-153
 * isolated every score left to right, which kept the pair in one piece but put
 * the home goals on the left of a right-to-left row, beside the away team
 * (T-1375: Sepahan's six beside Fajr Sepasi on `/fa`). So the pair is one
 * isolated run in the *page's* direction, its first number at the inline start.
 *
 * Without a `locale` the pair is isolated in the direction it inherits, which
 * is the page's unless an ancestor says otherwise.
 *
 * The geometry is asserted in `tests/e2e/journeys/rtl-content.spec.ts` (on
 * `/ar` the home goals' digit sits on the home team's side), the markup in
 * `score.spec.tsx` and `score-card-bidi.spec.tsx`.
 */
export function Score({
  home,
  away,
  separator = '–',
  className,
  testId,
  locale,
}: {
  home: number;
  away: number;
  /** `–` on its own, or ` – ` where the extra room reads better. */
  separator?: string;
  className?: string;
  testId?: string;
  /** The page's locale, for its own digits (T-1303) and direction: `۲–۱` on `/fa`. */
  locale?: string;
}) {
  const n = (value: number): string | number =>
    locale === undefined ? value : formatNumber(locale, value);
  return (
    <ScorePair locale={locale} className={className} testId={testId}>
      {n(home)}
      {separator}
      {n(away)}
    </ScorePair>
  );
}

/**
 * A home–away pair that is already text (`"2 – 1"`), isolated in the page's
 * direction like `Score`. Use `Score` when you have the two numbers.
 */
export function ScorePair({
  children,
  className,
  testId,
  locale,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
  locale?: string;
}) {
  return (
    <span
      dir={locale === undefined ? undefined : directionOf(locale)}
      className={`[unicode-bidi:isolate]${className === undefined ? '' : ` ${className}`}`}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

/**
 * A number or a figure that is not a home–away pair -- a percentage, a signed
 * gap, a minute -- isolated left to right so its sign and digits stay put.
 * A score goes through `Score` or `ScorePair` instead.
 */
export function LtrNumeric({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span dir="ltr" className={className} data-testid={testId}>
      {children}
    </span>
  );
}

/**
 * Left-to-right isolation inside a string, where an element cannot go:
 * `U+2066` opens a left-to-right isolate and `U+2069` closes it. For a figure
 * that is not a home–away pair; a pair goes through `pairIsolate`.
 */
export function ltrIsolate(text: string): string {
  return `⁦${text}⁩`;
}

/**
 * A home–away pair built as a string, isolated in the page's direction
 * (T-1375): `U+2067` (right-to-left isolate) on a right-to-left page, `U+2066`
 * otherwise, closed by `U+2069`. The string counterpart of `ScorePair`.
 */
export function pairIsolate(locale: string, text: string): string {
  return `${directionOf(locale) === 'rtl' ? '⁧' : '⁦'}${text}⁩`;
}

/**
 * A name inside a built string as its own first-strong isolate (`U+2068` …
 * `U+2069`, the string form of `<bdi>`), so an English name in a Persian line
 * neither turns the line around nor drags a score along with it.
 */
export function nameIsolate(name: string): string {
  return `⁨${name}⁩`;
}
