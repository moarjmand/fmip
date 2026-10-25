import { formatAgo } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { cx } from '@/components/ui/cx';

/** The stamp's words, resolved on the server for the reader's locale (T-1303). */
export type FreshnessWords = Record<'freshness.checked' | 'freshness.behind', Message>;

/**
 * "Last checked 8 sec ago" on a live surface (rule 4; the Design System's
 * `Freshness`, T-1493, D-263): when the page last heard from the feed, as an
 * age the reader does not have to work out, in the machine-fact mono face and
 * the caption colour, after a dot. Past the surface's own freshness threshold
 * -- the one the code already keys on, never a new one: `STALE_AFTER_MS` for
 * the live stream (D-045's heartbeat), or a stored row's own -- the whole
 * stamp turns to the warning saffron, the dot to a triangle, and it says "may
 * be behind", so a stale picture is never shown as current and the change
 * does not rest on colour alone. `behind` forces that state when the surface
 * already knows (the stream broke).
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
  return (
    <span
      className={cx(
        'inline-flex items-baseline gap-1.5 font-mono text-xs [:root:is(:lang(fa),:lang(ar))_&]:font-sans',
        stale ? 'font-semibold text-warning' : 'text-caption',
        className,
      )}
      data-testid={testId}
      data-freshness={stale ? 'behind' : 'current'}
    >
      <span aria-hidden="true">{stale ? '▲' : '●'}</span>
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
