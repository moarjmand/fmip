import type { CoverageState } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

/**
 * A module's coverage, said beside its name (rule 3, T-1388, D-206): every
 * module states it, and each of the four states has its own icon *and* its
 * own edge as well as a colour, so the four never rest on hue alone -- a
 * reader who cannot tell the green from the amber still reads a tick from a
 * clock, and "not supplied" is the one with a dashed edge and a dash.
 *
 *   available     the green, a tick
 *   limited       the warning colour, a half-filled circle
 *   not supplied  the caption colour, a dash, a dashed edge
 *   delayed       the warning colour, a clock
 *
 * The words are the caller's (`label`), already in the reader's language: a
 * server page passes `<Translated>` with `COVERAGE_KEY`, a client view its
 * resolved message. No directive and no catalogue import, so the badge is
 * safe on the server and in a client bundle alike. `dir="auto"` because a
 * fallback English word in a right-to-left heading must keep its own order
 * (T-605).
 *
 * Sentence case (T-1391, D-207): "Available", not "AVAILABLE" beside
 * sentence-case text. The words stay lower case in the catalogue, where they
 * are also used mid-sentence, so only the badge's first letter is raised
 * (`::first-letter` needs a block box, hence the inline-block).
 */
const LOOK: Record<CoverageState, { icon: IconName; className: string }> = {
  available: { icon: 'check', className: 'border border-success text-success' },
  limited: { icon: 'limited', className: 'border border-warning text-warning' },
  not_supplied: { icon: 'dash', className: 'border border-dashed border-caption text-caption' },
  delayed: { icon: 'clock', className: 'border border-warning text-warning' },
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
  const look = LOOK[state];
  return (
    <span
      dir="auto"
      data-coverage-badge={state}
      className={cx(
        'inline-flex min-h-6 items-center gap-1 rounded-md px-2 text-xs font-bold whitespace-nowrap',
        look.className,
        className,
      )}
    >
      <Icon name={look.icon} size={12} />
      <span className="inline-block first-letter:uppercase">{label}</span>
    </span>
  );
}
