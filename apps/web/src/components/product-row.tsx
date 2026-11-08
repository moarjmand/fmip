import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';

/**
 * One compact row for something that has nothing to show (T-1744, D-365;
 * board P2-2): its name, the honest sentence that says why there is
 * nothing, and a status that is an icon and a word. Where a card stood, so
 * an empty analysis or an empty set of picks costs the page one line, never
 * a card that looks populated (rule 3).
 *
 * `folded` (T-1773..T-1775, D-383; board P6-2): the row is one 48px line --
 * the name, the status word, always visible, and a chevron -- and the
 * sentence sits behind it in a native `<details>`, the whole line its
 * target. Only the reason moves behind the tap, never the state: the word
 * stays on the line (rule 3). No client JavaScript: the browser opens it.
 * Unfolded, on a phone the name and the status share the first line and
 * the sentence runs under them; from 768px the three sit on one line.
 *
 * **A shell, and deliberately nothing more** (rule 6). It draws what it is
 * handed: the name arrives already set by its owner -- the founder's voice
 * in its serif, the community's in its capitals, the contributors' and the
 * reader's pick in plain ink -- so no prop here names or chooses a
 * prediction, and it has no colour of its own to lend one. It is never the
 * model's: the model's forecast is the Summary's card and has no row.
 * `three-products.spec.ts` reads this file for exactly that. Server-component
 * safe: no hook, no directive, no catalogue import. Logical properties only
 * (rule 7): the chevron points down and turns over when open, in either
 * direction.
 */
export function ProductRow({
  name,
  status,
  children,
  labelledBy,
  testId,
  state,
  voice,
  folded = false,
  className,
}: {
  /** The owner's own name line, already styled by the owner. */
  name: ReactNode;
  /** An icon and a word ("None yet", "Locked at kick-off"). */
  status?: ReactNode;
  /** The sentence that says why there is nothing more to show. */
  children: ReactNode;
  /** The id of the element inside `name` that names the row. */
  labelledBy?: string;
  testId?: string;
  state?: string;
  /** The owner's `data-voice`, set by a voice and by nothing else. */
  voice?: string;
  /** One 48px line, the sentence behind a native disclosure (D-383). */
  folded?: boolean;
  /** Where the row is shown (a breakpoint's visibility), never a colour. */
  className?: string;
}) {
  const hasStatus = status !== undefined && status !== null;
  if (folded) {
    return (
      <section
        aria-labelledby={labelledBy}
        className={cx('min-w-0 rounded-card border border-default bg-surface', className)}
        data-product-row=""
        data-folded=""
        data-testid={testId}
        data-state={state}
        data-voice={voice}
      >
        <details className="group">
          {/* 46px inside the card's two 1px edges: a 48px line, all of it the target. */}
          <summary className="flex min-h-[2.875rem] cursor-pointer list-none items-center gap-x-3 px-4 md:px-6 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0 flex-1">{name}</div>
            {hasStatus && (
              <div className="shrink-0" data-row-status="">
                {status}
              </div>
            )}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
              focusable="false"
              className="shrink-0 text-muted group-open:rotate-180 motion-safe:transition-transform"
              data-row-chevron=""
            >
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </summary>
          <div
            className="flex min-w-0 flex-col items-start gap-1 px-4 pb-3 text-sm leading-normal text-muted md:px-6"
            data-row-sentence=""
          >
            {children}
          </div>
        </details>
      </section>
    );
  }
  return (
    <section
      aria-labelledby={labelledBy}
      className={cx(
        'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-card border border-default bg-surface px-4 py-3 md:grid-cols-[12rem_minmax(0,1fr)_auto] md:px-6',
        className,
      )}
      data-product-row=""
      data-testid={testId}
      data-state={state}
      data-voice={voice}
    >
      <div className="min-w-0">{name}</div>
      {hasStatus && (
        <div className="col-start-2 row-start-1 md:col-start-3" data-row-status="">
          {status}
        </div>
      )}
      <div
        className="col-span-2 min-w-0 text-sm leading-normal text-muted md:col-span-1 md:col-start-2 md:row-start-1"
        data-row-sentence=""
      >
        {children}
      </div>
    </section>
  );
}
