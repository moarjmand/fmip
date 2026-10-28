import { FilledMessage } from '@/components/filled-message';
import { message } from '@/i18n/messages';
import { pageLocale } from '@/lib/competition';
import { formatStamp } from '@/lib/scores';

/**
 * The club and competition pages' footer about their matches (T-1633,
 * D-296), said as D-189 says it on the match header: when the provider last
 * answered the whole list, and when any match on it last changed. Until then
 * both pages said "Last data update" and the newest change alone, so a club
 * whose matches had not changed since Saturday read as three days stale on
 * its own page while its league's page, with a later change to someone
 * else's match, said today; neither said what had been updated.
 *
 * The check is shown only when it is newer than the change; otherwise the
 * change alone, named as the matches' change. Each time says its day unless
 * it is today (D-189), and "UTC" when that is the zone used.
 */
export function MatchesFreshness({
  changedAt,
  checkedAt,
  locale,
  timeZone,
  now,
}: {
  /** The newest change to any match listed (`last_updated_at`). */
  changedAt: string;
  /** When the whole list was last answered (`last_checked_at`), if known. */
  checkedAt: string | null | undefined;
  locale: string;
  timeZone: string;
  /** The moment of the render, read once by the page. */
  now: number;
}) {
  const l = pageLocale(locale);
  const zone = timeZone === 'UTC' ? ' UTC' : '';
  const at = (iso: string) => (
    <time dateTime={iso}>
      {formatStamp(locale, iso, timeZone, now)}
      {zone}
    </time>
  );
  const checked =
    checkedAt != null && Date.parse(checkedAt) > Date.parse(changedAt) ? checkedAt : null;
  return checked === null ? (
    <FilledMessage
      message={message(l, 'freshness.matchesChanged')}
      params={{ time: at(changedAt) }}
    />
  ) : (
    <FilledMessage
      message={message(l, 'freshness.matchesChecked')}
      params={{ time: at(checked), changed: at(changedAt) }}
    />
  );
}
