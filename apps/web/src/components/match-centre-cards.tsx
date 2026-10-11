import type { CoverageState, Covered } from '@fmip/contracts';
import type { Message } from '@/i18n/messages';
import type { MatchWords } from '@/lib/words-server';
import { MessageText } from '@/components/message-text';
import { CoverageBadge } from '@/components/ui/coverage-badge';

/**
 * A coverage state's words, as catalogue keys. The scores card has the same
 * record (`score-card.tsx`); it is repeated here so the live match centre's
 * client bundle does not carry the whole scores card for four strings.
 */
export const COVERAGE_KEY = {
  available: 'status.coverage.available',
  limited: 'status.coverage.limited',
  not_supplied: 'status.coverage.notSupplied',
  delayed: 'status.coverage.delayed',
} as const satisfies Record<CoverageState, keyof MatchWords['m']>;

/**
 * The match centre's cards (T-1384, D-202): one shape for every section on
 * the stage -- a `rounded-card` surface, its name in small capitals behind
 * the brand green's slanted bar, the coverage badge opposite -- shared by the
 * live view (a client bundle) and the panels the page renders on the server.
 * No directive and no catalogue import: the words arrive resolved.
 */

type Key = keyof MatchWords['m'];

/** A section's card: its name in the band's small capitals. */
export function Card({
  title,
  testId,
  children,
}: {
  title: Message;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD} data-testid={testId}>
      <h2 className={MODULE_HEADING}>
        <span className={TITLE}>
          <MessageText message={title} />
        </span>
      </h2>
      {children}
    </section>
  );
}

/** A data card on the stage (D-198: `rounded-card`), a container for its own grid. */
export const CARD =
  '@container flex min-w-0 flex-col gap-3 rounded-card border border-default bg-surface p-4 md:p-5';

/**
 * The same card around a panel the page renders on the server (the summary,
 * the discussion, Watch, news), so every section on the stage is one shape.
 */
export function DataCard({ children }: { children: React.ReactNode }) {
  return <div className={CARD}>{children}</div>;
}

/**
 * "What was forecast, and what happened" (board h5, T-1384): after full time,
 * three lanes -- the model's, the founder's and the community's, each its own
 * component from its own file (rule 6) -- passed in as three children and
 * laid side by side where the card is wide, one under another where not.
 */
export function VerdictCard({
  title,
  note,
  children,
}: {
  title: React.ReactNode;
  note: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD} data-testid="verdict">
      <h2 className={MODULE_HEADING}>
        <span className={TITLE}>{title}</span>
      </h2>
      <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-3">{children}</div>
      {note}
    </section>
  );
}

/** A module's title and its coverage badge, a gap between them in either direction. */
export const MODULE_HEADING = 'flex flex-wrap items-center justify-between gap-x-2 gap-y-1';

/** The title's mark: the brand green's slanted bar before it (board h4), the green only. */
export const TITLE =
  "text-sm font-extrabold uppercase text-fg before:me-2 before:inline-block before:h-3.5 before:w-1 before:-skew-x-12 before:bg-accent before:align-[-1px] before:content-['']";

/**
 * A module: its card, its title and its coverage badge (the Hybrid badge,
 * T-1388: an icon and an edge as well as a colour), then its data or the
 * sentence that says why there is none. Every such sentence carries
 * `dir="auto"` (T-605): a fallback English sentence in a right-to-left
 * paragraph had its full stop resolved by the paragraph.
 */
export function Module<T>({
  title,
  module,
  testId,
  words,
  empty,
  children,
}: {
  title: Message;
  module: Covered<T>;
  testId: string;
  words: MatchWords;
  /** Says why a `not_supplied` module is empty, where more is known (T-1364). */
  empty?: Key | null;
  children: (data: T) => React.ReactNode;
}) {
  const m = words.m;
  const why: Key =
    module.coverage === 'delayed'
      ? 'matchCentre.moduleDelayed'
      : (empty ?? 'matchCentre.moduleNotSupplied');
  return (
    <section className={CARD} data-testid={testId} data-coverage={module.coverage}>
      <h2 className={MODULE_HEADING}>
        <span className={TITLE}>
          <MessageText message={title} />
        </span>
        <CoverageBadge
          state={module.coverage}
          label={<MessageText message={m[COVERAGE_KEY[module.coverage]]} />}
        />
      </h2>
      {module.data === null ? (
        <p dir="auto" className="text-sm text-muted">
          <MessageText message={m[why]} />
        </p>
      ) : (
        children(module.data)
      )}
    </section>
  );
}
