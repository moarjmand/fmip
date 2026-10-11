import { formatAgo } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { cx } from '@/components/ui/cx';

/** The stamp's words, resolved on the server for the reader's locale (T-1303). */
export type FreshnessWords = Record<'freshness.checked' | 'freshness.behind', Message>;

/** The ring's length: a circle of radius 5.5. */
const RING = 2 * Math.PI * 5.5;

/**
 * "Last checked 8 sec ago" on a live surface (rule 4, T-1388, D-206): when
 * the page last heard from the feed, as an age the reader does not have to
 * work out, and a ring that empties as the check gets older. Past the
 * surface's own freshness threshold -- the one the code already keys on, never
 * a new one: `STALE_AFTER_MS` for the live stream (D-045's heartbeat), or a
 * stored row's own -- the whole stamp turns to the warning colour and says
 * "may be behind", so a stale picture is never shown as current. `behind`
 * forces that state when the surface already knows (the stream broke).
 *
 * Pure: the clock is the caller's (`now`), so a server render without one
 * shows nothing rather than an age that would be wrong by the time it is
 * read. No directive and no catalogue import: safe in a client bundle.
 */
export function FreshnessStamp({
  checkedAt,
  now,
  staleAfterMs,
  behind = false,
  locale,
  words,
  className,
  testId = 'freshness',
}: {
  /** When the surface last heard from its source: ms since the epoch, or an ISO time. */
  checkedAt: number | string;
  now: number | undefined;
  staleAfterMs: number;
  /** The surface already knows its feed is behind (a broken stream). */
  behind?: boolean;
  locale: string;
  words: FreshnessWords;
  className?: string;
  testId?: string;
}) {
  if (now === undefined) return null;
  const at = typeof checkedAt === 'number' ? checkedAt : Date.parse(checkedAt);
  if (Number.isNaN(at)) return null;
  const age = Math.max(0, now - at);
  const stale = behind || age > staleAfterMs;
  // What is left of the threshold, drawn as the ring; a quarter once stale,
  // so the ring still reads as a ring and the colour carries the warning.
  const left = stale ? 0.25 : 1 - Math.min(1, age / staleAfterMs);
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 text-xs font-medium',
        stale ? 'text-warning' : 'text-muted',
        className,
      )}
      data-testid={testId}
      data-freshness={stale ? 'behind' : 'current'}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
      >
        <circle
          cx="7"
          cy="7"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeWidth="2"
        />
        <circle
          cx="7"
          cy="7"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - left)}
          transform="rotate(-90 7 7)"
          className={stale ? undefined : 'text-accent'}
        />
      </svg>
      <span>
        <FilledMessage
          message={words['freshness.checked']}
          params={{
            ago: <time dateTime={new Date(at).toISOString()}>{formatAgo(locale, age)}</time>,
          }}
        />
        {stale && (
          <>
            {' · '}
            <MessageText message={words['freshness.behind']} />
          </>
        )}
      </span>
    </span>
  );
}
