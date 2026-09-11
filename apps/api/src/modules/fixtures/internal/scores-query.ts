import type { ScoresFilters } from '@fmip/contracts';

/**
 * Parsing and validation of `GET /scores` query parameters. Pure, so the
 * timezone and range rules are unit-tested without a server.
 *
 * Dates are calendar dates in the user's timezone: "today" in Tehran is not
 * "today" in UTC, and blueprint 4.1 wants yesterday, today and the next five
 * days to be right for the user, not for the server.
 */

/** Yesterday, today, the next five days, and room for a two-week calendar view. */
export const MAX_RANGE_DAYS = 14;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedScoresQuery =
  { ok: true; filters: ScoresFilters } | { ok: false; fields: Record<string, string> };

/** Whether `Intl` knows the zone. Postgres would reject an unknown one anyway. */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date of `now` in `timeZone`, as YYYY-MM-DD. */
export function dateIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Whole days from `from` to `to`, inclusive. */
export function spanDays(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/** Fastify hands a repeated parameter over as an array; the first one counts. */
function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

const TRUE = new Set(['1', 'true', 'yes']);
const FALSE = new Set(['0', 'false', 'no']);

export function parseScoresQuery(
  raw: Record<string, unknown>,
  now = new Date(),
): ParsedScoresQuery {
  const fields: Record<string, string> = {};

  const timezone = first(raw.tz) ?? 'UTC';
  if (!isTimeZone(timezone)) fields.tz = 'must be an IANA time zone, e.g. Europe/London';
  const zone = fields.tz === undefined ? timezone : 'UTC';

  const today = dateIn(zone, now);
  const from = first(raw.from) ?? today;
  const toRaw = first(raw.to);
  const to = toRaw ?? from;
  if (!isDate(from)) fields.from = 'must be a date, YYYY-MM-DD';
  // A missing `to` inherits `from`, and with it any complaint about `from`.
  if (toRaw !== undefined && !isDate(to)) fields.to = 'must be a date, YYYY-MM-DD';
  if (isDate(from) && isDate(to)) {
    const span = spanDays(from, to);
    if (span < 1) fields.to = 'must not be before from';
    else if (span > MAX_RANGE_DAYS) fields.to = `range must be at most ${MAX_RANGE_DAYS} days`;
  }

  const flag = (name: string): boolean => {
    const v = first(raw[name]);
    if (v === undefined || FALSE.has(v.toLowerCase())) return false;
    if (TRUE.has(v.toLowerCase())) return true;
    fields[name] = 'must be 1 or 0';
    return false;
  };
  const live = flag('live');
  const favourites = flag('favourites');

  const id = (name: string): string | null => {
    const v = first(raw[name]);
    if (v === undefined) return null;
    if (!UUID.test(v)) {
      fields[name] = 'must be an id';
      return null;
    }
    return v.toLowerCase();
  };
  const country_id = id('country');
  const competition_id = id('competition');
  const stage_id = id('stage');

  const genderRaw = first(raw.gender);
  const gender =
    genderRaw === undefined
      ? null
      : genderRaw === 'men' || genderRaw === 'women'
        ? genderRaw
        : null;
  if (genderRaw !== undefined && gender === null) fields.gender = 'must be men or women';

  const ageRaw = first(raw.age);
  const age =
    ageRaw === undefined ? null : ageRaw === 'senior' || ageRaw === 'youth' ? ageRaw : null;
  if (ageRaw !== undefined && age === null) fields.age = 'must be senior or youth';

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    filters: {
      from,
      to,
      timezone,
      live,
      favourites,
      country_id,
      competition_id,
      stage_id,
      gender,
      age,
    },
  };
}
