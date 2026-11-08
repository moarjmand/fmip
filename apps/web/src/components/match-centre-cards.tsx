import type { CoverageState, Covered } from '@fmip/contracts';
import type { Message } from '@/i18n/messages';
import type { MatchWords } from '@/lib/words-server';
import { MessageText } from '@/components/message-text';
import { CoverageBadge, CoverageGlyph } from '@/components/ui/coverage-badge';
import { cx } from '@/components/ui/cx';
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
   * The match was not played (T-1550): a postponed or cancelled match says
   * there was no play to record, in place of "Not supplied for this match",
   * which would read as a verdict on the feed. A match still to come has no
   * module of its own here: before kick-off the in-play modules are one
   * card, `ComingCard` (T-1745).
   */
  before?: 'unplayed' | null;
  children: (data: T) => React.ReactNode;
}) {
  const m = words.m;
  const pending = module.data === null ? before : null;
  const why: Key =
    pending === 'unplayed'
      ? 'matchCentre.notPlayedWhy'
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
            <MessageText message={m['matchCentre.notPlayed']} />
          </span>
        ) : waiting ? (
          <span dir="auto" className={pill} data-testid="not-in-yet">
            <Icon name="clock" size={12} />
            <MessageText message={m['matchCentre.notInYet']} />
          </span>
        ) : (
          <HeaderCoverage
            state={module.coverage}
            content={module.data !== null}
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

/**
 * A module's coverage beside its title (T-1776, D-384; board P6-3): a module
 * that is available and shows its content needs no badge to say so -- the
 * content says it, and the page's coverage line says it once -- so its word
 * is visually hidden and a screen reader still hears it with the title. A
 * module that is limited, delayed or not supplied, or available with nothing
 * to show, keeps its visible badge (rule 3). Used by the module cards, the
 * venue and the competition context.
 */
export function HeaderCoverage({
  state,
  content,
  label,
}: {
  state: CoverageState;
  /** The module draws its content under the title. */
  content: boolean;
  label: React.ReactNode;
}) {
  if (state === 'available' && content) {
    return (
      // The space keeps the word apart from the title in the heading's name.
      <span className="sr-only" data-coverage-hidden={state}>
        {' '}
        {label}
      </span>
    );
  }
  return <CoverageBadge state={state} label={label} />;
}

/**
 * What an in-play module will be before the match has kicked off (T-1745,
 * D-366): `coming` when the season covers it, `limited` when the season's
 * coverage of it is limited, `delayed` when it is declared delayed, and
 * `not_supplied` when the season does not cover it and it will not come.
 */
export type ComingState = 'coming' | 'limited' | 'delayed' | 'not_supplied';

/** One module the card names: its title, where its tab is, and its state. */
export interface ComingItem {
  id: 'timeline' | 'statistics' | 'player_statistics' | 'expected_goals' | 'lineups';
  title: Key;
  tab: 'summary' | 'stats' | 'lineups';
  state: ComingState;
}

/** The groups in reading order: what will come first, what will not last. */
const COMING_GROUPS = [
  ['coming', 'matchCentre.coming.atKickoff', null],
  ['limited', 'matchCentre.coming.limited', 'matchCentre.coming.limitedWhy'],
  ['delayed', 'status.coverage.delayed', 'matchCentre.moduleDelayed'],
  ['not_supplied', 'matchCentre.coming.notSupplied', 'matchCentre.coming.notSuppliedWhy'],
] as const satisfies readonly (readonly [ComingState, Key, Key | null])[];

/** The glyph of a state: the coverage badge's own, a clock for what is still to come. */
const COMING_GLYPH = {
  coming: 'delayed',
  limited: 'limited',
  delayed: 'delayed',
  not_supplied: 'not_supplied',
} as const satisfies Record<ComingState, CoverageState>;

/**
 * One module in the card (T-1745): its name behind its state's glyph, the
 * state's words beside it for a screen reader -- an icon and a word, never
 * colour alone. What is still expected sits on a dashed edge, as the
 * coverage badge draws "delayed"; what will not come is quiet.
 */
export function CoverageChip({
  state,
  word,
  module,
  children,
}: {
  state: ComingState;
  /** The state in words, read after the name. */
  word: Message;
  module: string;
  children: React.ReactNode;
}) {
  return (
    <li
      dir="auto"
      className={cx(
        'inline-flex min-h-7 items-center gap-1.5 rounded-pill border px-2.5 text-xs font-semibold',
        state === 'not_supplied'
          ? 'border-default text-muted'
          : 'border-dashed border-caption text-fg',
      )}
      data-coverage-chip={state}
      data-module={module}
    >
      <CoverageGlyph state={COMING_GLYPH[state]} />
      <span>{children}</span>
      <span className="sr-only">
        {' · '}
        <MessageText message={word} />
      </span>
    </li>
  );
}

/**
 * "After kick-off you'll see" (T-1745, D-366; board P2-3): before kick-off,
 * the one card that stands where each in-play module -- live timeline,
 * statistics, player statistics, xG, line-ups -- showed its own empty card.
 * It lists what will come, grouped by what the season's coverage says: coming
 * at kick-off, coming with limited coverage, and, named apart, what this
 * competition does not supply and will not appear. Nothing is drawn as an
 * empty module and nothing is promised that the season does not cover
 * (rule 3). With nothing expected at all the card is titled by that group.
 *
 * `phone` is the copy a phone's Line-ups or Stats tab shows for its own
 * modules until their data exists; from 768px, where every section is open,
 * only the Summary's card is drawn.
 */
export function ComingCard({
  items,
  words,
  phone = false,
}: {
  items: readonly ComingItem[];
  words: MatchWords;
  phone?: boolean;
}) {
  const m = words.m;
  if (items.length === 0) return null;
  const expected = items.some((item) => item.state !== 'not_supplied');
  const lineups = items.some((item) => item.id === 'lineups' && item.state !== 'not_supplied');
  return (
    <section
      className={cx(CARD, phone && 'md:hidden')}
      data-testid="coming"
      data-coming={phone ? 'tab' : 'all'}
      data-expected={expected}
    >
      <h2 className={MODULE_HEADING}>
        <span className={cx(TITLE, 'inline-flex items-center gap-2')}>
          <span className="inline-flex text-muted">
            <CoverageGlyph state={expected ? 'delayed' : 'not_supplied'} size={16} />
          </span>
          <MessageText
            message={m[expected ? 'matchCentre.coming.title' : 'matchCentre.coming.notSupplied']}
          />
        </span>
      </h2>
      {expected && (
        <p dir="auto" className="text-sm text-muted">
          <MessageText message={m['matchCentre.fromKickoffWhy']} />
        </p>
      )}
      {COMING_GROUPS.map(([state, label, why]) => {
        const group = items.filter((item) => item.state === state);
        if (group.length === 0) return null;
        return (
          <div key={state} className="flex flex-col gap-2" data-coming-group={state}>
            {/* With nothing expected the card's title is this group's name. */}
            {expected && (
              <h3 className="inline-flex items-center gap-1.5 text-xs font-extrabold text-muted">
                <CoverageGlyph state={COMING_GLYPH[state]} />
                <span className="inline-block first-letter:uppercase">
                  <MessageText message={m[label]} />
                </span>
              </h3>
            )}
            <ul className="flex flex-wrap gap-1.5">
              {group.map((item) => (
                <CoverageChip key={item.id} state={state} word={m[label]} module={item.id}>
                  <MessageText message={m[item.title]} />
                </CoverageChip>
              ))}
            </ul>
            {why !== null && (
              <p dir="auto" className="text-xs text-caption">
                <MessageText message={m[why]} />
              </p>
            )}
          </div>
        );
      })}
      {lineups && (
        // Line-ups come about an hour before kick-off, not from it (T-1627).
        <p dir="auto" className="text-xs text-caption" data-testid="coming-lineups">
          <MessageText message={m['matchCentre.lineupsNotYet']} />
        </p>
      )}
    </section>
  );
}
