import type { ReactNode } from 'react';
import { formatStamp } from '@/lib/scores';
import type { MatchWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { cx } from '@/components/ui/cx';

/**
 * The phone's one freshness line under the score band (T-1743, D-364; board
 * P2-4): "● Data checked 22:07" and, at the line's end, "Details". The line
 * is the `<summary>` of a native `<details>`, so the whole row opens it and
 * no script is involved; behind it are the facts the band used to stack on
 * a phone (the full "last checked … unchanged since …" sentence, the
 * kick-off with its date and zone, the referee, where to watch), handed in
 * as list items by the band.
 *
 * Rule 4: the time is the provider's last answer about the match, or its
 * last change when that is newer or all there is, and it says its day when
 * that is not today (`formatStamp`, T-1371). When the band already knows the
 * data may be old -- a match in play whose data is past the live threshold
 * (D-045), or a kick-off long past with no word (D-343) -- `stale` turns the
 * line itself to the warning colour with a triangle and "Data may be out of
 * date, last checked …". That is the summary, always on show: the warning is
 * never behind the disclosure, and it does not rest on colour alone.
 *
 * Nothing here ticks: a clock reading, not an age. The live stream's own
 * "Last checked 8 sec ago" stays with a match in play (`LiveMatch`).
 * Client-safe: no directive, no catalogue import.
 */
export function FreshnessLine({
  checkedAt,
  changedAt,
  stale,
  locale,
  timeZone,
  now,
  words,
  children,
}: {
  /** When the provider last answered about the match (`last_checked_at`), if known. */
  checkedAt: string | null | undefined;
  /** When the match's data last changed (`last_updated_at`). */
  changedAt: string;
  /** The band knows the data may be old: said in the line itself. */
  stale: boolean;
  locale: string;
  timeZone: string;
  /** The reader's clock; without one the full date and time is said. */
  now: number | undefined;
  words: MatchWords;
  /** The details, as `<li>`s. */
  children: ReactNode;
}) {
  const m = words.m;
  const latest =
    checkedAt != null && Date.parse(checkedAt) > Date.parse(changedAt) ? checkedAt : changedAt;
  return (
    <details className="group" data-testid="freshness-details">
      {/* A 44px target whose upper 12px lie over the line above, which holds
          no control: the row itself reads as 32px (the board's height). */}
      <summary
        className="-mt-3 flex min-h-touch cursor-pointer list-none items-end pb-1.5 [&::-webkit-details-marker]:hidden"
        data-freshness={stale ? 'behind' : 'current'}
        data-testid="freshness-line"
      >
        <span className="flex w-full items-baseline justify-between gap-3">
          <span
            className={cx(
              'inline-flex items-baseline gap-1.5 font-mono text-xs [:root:is(:lang(fa),:lang(ar))_&]:font-sans',
              stale ? 'font-semibold text-warning' : 'text-caption',
            )}
          >
            <span aria-hidden="true">{stale ? '▲' : '●'}</span>
            <span>
              <FilledMessage
                message={m[stale ? 'matchCentre.freshness.stale' : 'matchCentre.freshness.checked']}
                params={{
                  time: <time dateTime={latest}>{formatStamp(locale, latest, timeZone, now)}</time>,
                }}
              />
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-muted">
            <MessageText message={m['matchCentre.freshness.details']} />
            <span
              aria-hidden="true"
              className="text-xs motion-safe:transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </span>
        </span>
      </summary>
      <ul
        className="mb-2 flex flex-col gap-1 rounded-card border border-default bg-surface-raised px-3 py-2 text-sm text-muted"
        data-testid="freshness-facts"
      >
        {children}
      </ul>
    </details>
  );
}
