/**
 * A score, rendered so it cannot be read backwards (T-153, rule 7).
 *
 * **The bug this exists to prevent.** `2 – 1` is two numbers with a neutral
 * character between them. Inside a right-to-left paragraph the bidirectional
 * algorithm resolves that neutral to the paragraph's direction, which splits
 * the run in two and lays them out right to left — so `2 – 1` renders as
 * `1 – 2`. It is invisible in review, it passes every unit test, and it tells
 * every Arabic reader the wrong result.
 *
 * `dir="ltr"` isolates the whole thing as one left-to-right run. That is not a
 * workaround: a score is a number pair and reads left to right in every script,
 * for the same reason a date or a phone number does.
 *
 * The audit in `tests/e2e/journeys/rtl-content.spec.ts` found this on the match
 * centre and now measures the digits' real positions, so it cannot come back
 * silently — which is why this is one component rather than an attribute
 * somebody has to remember on the thirteenth call site.
 */
export function Score({
  home,
  away,
  separator = '–',
  className,
  testId,
}: {
  home: number;
  away: number;
  /** `–` on its own, or ` – ` where the extra room reads better. */
  separator?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <span dir="ltr" className={className} data-testid={testId}>
      {home}
      {separator}
      {away}
    </span>
  );
}

/**
 * The same isolation for a score that is already a string, or for a line that
 * contains one. Use `Score` when you have the two numbers.
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
 * The same isolation for a score that is built as a string and dropped inside
 * a larger label, where an element cannot go.
 *
 * `U+2066` opens a left-to-right isolate and `U+2069` closes it — the Unicode
 * equivalent of `dir="ltr"`, and the only tool available inside a string.
 */
export function ltrIsolate(text: string): string {
  return `⁦${text}⁩`;
}
