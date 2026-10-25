import type { CoverageState } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * A module's coverage, said beside its name or in place of what is missing
 * (rule 3; the Design System's `CoverageBadge`, T-1493, D-263). A pill in
 * the quiet text colour whose state is told by its glyph and its word, never
 * by hue: a ring with a tick (available), half filled (limited), struck
 * through (not supplied) or with clock hands (delayed), and delayed -- the
 * one still expected -- on a dashed edge.
 *
 * The Design System draws no badge for `available`; a page that states every
 * module's coverage (D-206) still may, and gets the quietest of the four. The
 * pages rebuilt from T-1495 on choose whether to pass it.
 *
 * The words are the caller's (`label`), already in the reader's language: a
 * server page passes `<Translated>` with `COVERAGE_KEY`, a client view its
 * resolved message. No directive and no catalogue import, so the badge is
 * safe on the server and in a client bundle alike. `dir="auto"` because a
 * fallback English word in a right-to-left heading must keep its own order
 * (T-605). Sentence case (T-1391, D-207): the words stay lower case in the
 * catalogue, where they are also used mid-sentence, so only the badge's
 * first letter is raised (`::first-letter` needs a block box).
 */
const GLYPH: Record<CoverageState, ReactNode> = {
  available: (
    <path
      d="M3.6 6.2 5.3 7.9 8.5 4.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  limited: <path d="M6 1a5 5 0 0 1 0 10z" fill="currentColor" />,
  not_supplied: (
    <line x1="2.5" y1="9.5" x2="9.5" y2="2.5" stroke="currentColor" strokeWidth="1.5" />
  ),
  delayed: (
    <path
      d="M6 3.2V6l2 1.3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
};

export function CoverageBadge({
  state,
  label,
  className,
}: {
  state: CoverageState;
  label: ReactNode;
  className?: string;
}) {
  return (
    <span
      dir="auto"
      data-coverage-badge={state}
      className={cx(
        'inline-flex min-h-6 items-center gap-1.5 rounded-pill border px-2.5 text-xs font-semibold whitespace-nowrap text-muted',
        state === 'delayed' ? 'border-dashed border-caption' : 'border-default',
        className,
      )}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
        data-icon={state}
        className="shrink-0"
      >
        <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {GLYPH[state]}
      </svg>
      <span className="inline-block first-letter:uppercase">{label}</span>
    </span>
  );
}
