import type { ReactNode } from 'react';

/**
 * One compact row for something that has nothing to show on this match
 * (T-1744, D-365; board P2-2): its name, the honest sentence that says why
 * there is nothing, and a status that is an icon and a word. About 72px where
 * a card stood, so an empty analysis or an empty set of picks costs the page
 * one line, never a card that looks populated (rule 3).
 *
 * **A shell, and deliberately nothing more** (rule 6). It draws what it is
 * handed: the name arrives already set by its owner -- the founder's voice
 * in its serif, the community's in its capitals, the contributors' and the
 * reader's pick in plain ink -- so no prop here names or chooses a
 * prediction, and it has no colour of its own to lend one. It is never the
 * model's: the model's forecast is the Summary's card and has no row.
 * `three-products.spec.ts` reads this file for exactly that.
 *
 * On a phone the name and the status share the first line and the sentence
 * runs under them; from 768px the three sit on one line. Server-component
 * safe: no hook, no directive, no catalogue import.
 */
export function ProductRow({
  name,
  status,
  children,
  labelledBy,
  testId,
  state,
  voice,
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
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-card border border-default bg-surface px-4 py-3 md:grid-cols-[12rem_minmax(0,1fr)_auto] md:px-6"
      data-product-row=""
      data-testid={testId}
      data-state={state}
      data-voice={voice}
    >
      <div className="min-w-0">{name}</div>
      {status !== undefined && status !== null && (
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
