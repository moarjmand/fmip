import type { CoverageState, Covered } from '@fmip/contracts';
import type { Message } from '@/i18n/messages';
import type { MatchWords } from '@/lib/words-server';
import { MessageText } from '@/components/message-text';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { Icon } from '@/components/ui/icons';

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
  '@container flex min-w-0 flex-col gap-3.5 rounded-card border border-default bg-surface p-4 md:px-6 md:py-5';

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
    <section className="flex min-w-0 flex-col gap-3" data-testid="verdict">
      <h2 className="sr-only">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-4">
        {children}
      </div>
      {note}
    </section>
  );
}

/** A module's title and its coverage badge, a gap between them in either direction. */
export const MODULE_HEADING = 'flex flex-wrap items-center justify-between gap-x-2 gap-y-1';

/** A section's name (the Design System's section heading): wide, heavy, sentence case. */
export const TITLE = 'text-base font-extrabold text-fg font-stretch-semi-expanded md:text-lg';

/**
 * A module: its card, its title and its coverage badge (the Hybrid badge,
 * T-1388: an icon and an edge as well as a colour), then its data or the
 * sentence that says why there is none. Every such sentence carries
 * `dir="auto"` (T-605): a fallback English sentence in a right-to-left
 * paragraph had its full stop resolved by the paragraph.
 */
/** The badge of a module that waits for the match (T-1550, T-1627). */
const PENDING_KEY = {
  kickoff: 'matchCentre.fromKickoff',
  lineup: 'matchCentre.beforeKickoff',
  unplayed: 'matchCentre.notPlayed',
} as const satisfies Record<'kickoff' | 'lineup' | 'unplayed', Key>;

export function Module<T>({
  title,
  module,
  testId,
  words,
  empty,
  notInYet = false,
  before = null,
  children,
}: {
  title: Message;
  module: Covered<T>;
  testId: string;
  words: MatchWords;
  /** Says why a `not_supplied` module is empty, where more is known (T-1364). */
  empty?: Key | null;
  /**
   * The match is on (T-1497): a module with nothing yet says "Not in yet"
   * and that nothing is estimated meanwhile, rather than "not supplied",
   * which would read as a verdict on a feed that may still send it.
   */
  notInYet?: boolean;
  /**
   * The match has not been played (T-1550): `'kickoff'` before kick-off, for
   * a module the season covers, says it starts then; `'unplayed'` for a
   * postponed or cancelled match says there was no play to record. Either
   * replaces "Not supplied for this match", which would read as a verdict
   * on the feed when the match simply has not happened. `'lineup'` is the
   * line-ups' own (T-1627): they come before kick-off, not from it.
   */
  before?: 'kickoff' | 'lineup' | 'unplayed' | null;
  children: (data: T) => React.ReactNode;
}) {
  const m = words.m;
  const pending = module.data === null ? before : null;
  const why: Key =
    pending === 'unplayed'
      ? 'matchCentre.notPlayedWhy'
      : pending === 'kickoff' || pending === 'lineup'
        ? (empty ?? 'matchCentre.fromKickoffWhy')
        : module.coverage === 'delayed'
          ? 'matchCentre.moduleDelayed'
          : (empty ?? 'matchCentre.moduleNotSupplied');
  const waiting = notInYet && module.data === null;
  const pill =
    'inline-flex min-h-6 items-center gap-1 rounded-pill border border-dashed border-caption px-2 text-xs font-semibold text-muted';
  return (
    <section className={CARD} data-testid={testId} data-coverage={module.coverage}>
      <h2 className={MODULE_HEADING}>
        <span className={TITLE}>
          <MessageText message={title} />
        </span>
        {pending !== null ? (
          <span dir="auto" className={pill} data-testid="not-yet" data-not-yet={pending}>
            {pending !== 'unplayed' && <Icon name="clock" size={12} />}
            <MessageText message={m[PENDING_KEY[pending]]} />
          </span>
        ) : waiting ? (
          <span dir="auto" className={pill} data-testid="not-in-yet">
            <Icon name="clock" size={12} />
            <MessageText message={m['matchCentre.notInYet']} />
          </span>
        ) : (
          <CoverageBadge
            state={module.coverage}
            label={<MessageText message={m[COVERAGE_KEY[module.coverage]]} />}
          />
        )}
      </h2>
      {module.data === null ? (
        <p dir="auto" className="text-sm text-muted">
          <MessageText message={m[waiting ? 'matchCentre.notInYetWhy' : why]} />
        </p>
      ) : (
        children(module.data)
      )}
    </section>
  );
}
