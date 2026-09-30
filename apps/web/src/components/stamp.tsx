import { formatDateTime } from '@/i18n/format';

/**
 * A stored moment as a reader reads it (T-1201): "30 Sept 2026, 21:32" in the
 * viewer's zone, with "UTC" said when that is the zone used, and the exact
 * instant kept in `dateTime` for a machine. Pages printed the raw ISO string
 * ("2026-09-26T16:15:19.876Z") in their "Last data update" lines until the
 * design pass.
 */
export function Stamp({
  iso,
  locale,
  timeZone = 'UTC',
}: {
  iso: string;
  locale: string;
  timeZone?: string;
}) {
  return (
    <time dateTime={iso}>
      {formatDateTime(locale, iso, timeZone)}
      {timeZone === 'UTC' ? ' UTC' : ''}
    </time>
  );
}
