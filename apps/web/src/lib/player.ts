import type {
  PlayerMatch,
  PlayerPage,
  PlayerSeasonMinutes,
  PlayerSeasonRecord,
  PlayerSpell,
} from '@fmip/contracts';
import { AVAILABILITY_STALE_AFTER_MS } from '@fmip/contracts';
import { formatDate, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { type MessageKey, plural } from '@/i18n/messages';
import { pageLocale, say } from '@/lib/competition';

/**
 * The player page's pure helpers (T-037): age, labels, the season selector
 * over the record and the match log.
 */

type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whole years between the birth date and `now`, or null without a birth date. */
export function ageOn(dateOfBirth: string | null, now: Date): number | null {
  if (dateOfBirth === null) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export const FOOT_KEY: Record<NonNullable<PlayerPage['person']['preferred_foot']>, MessageKey> = {
  left: 'playerPage.foot.left',
  right: 'playerPage.foot.right',
  both: 'playerPage.foot.both',
};

export const POSITION_KEY: Record<NonNullable<PlayerSpell['position']>, MessageKey> = {
  goalkeeper: 'playerPage.position.goalkeeper',
  defender: 'playerPage.position.defender',
  midfielder: 'playerPage.position.midfielder',
  forward: 'playerPage.position.forward',
};

/**
 * A calendar date the API holds as `YYYY-MM-DD` (a birth date, the start of a
 * spell). English shows it as stored, as it always has; any other locale gets
 * it in its own calendar and digits (T-1304) -- Persian in the Solar Hijri
 * calendar, as `Intl` writes it (D-175).
 */
export function dayText(locale: string, iso: string): string {
  if (pageLocale(locale) === DEFAULT_LOCALE) return iso;
  return formatDate(locale, `${iso}T00:00:00Z`, 'UTC', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "Jul 2025 – present" or "Jul 2022 – Jun 2025". */
export function spellPeriod(
  locale: string,
  spell: Pick<PlayerSpell, 'start_date' | 'end_date'>,
): string {
  const month = (iso: string): string =>
    formatDate(locale, `${iso}T00:00:00Z`, 'UTC', { month: 'short', year: 'numeric' });
  return `${month(spell.start_date)} – ${
    spell.end_date === null ? say(locale, 'playerPage.present') : month(spell.end_date)
  }`;
}

/** `?season=<id>`; anything else means every season. */
export function readSeasonFilter(params: SearchParams): string | null {
  const raw = Array.isArray(params.season) ? params.season[0] : params.season;
  return raw !== undefined && UUID.test(raw) ? raw.toLowerCase() : null;
}

/** The seasons the record covers, newest first as the record is, each once. */
export function seasonsOf(record: readonly PlayerSeasonRecord[]): { id: string; label: string }[] {
  const seen = new Set<string>();
  const seasons: { id: string; label: string }[] = [];
  for (const row of record) {
    if (seen.has(row.season.id)) continue;
    seen.add(row.season.id);
    seasons.push(row.season);
  }
  return seasons;
}

export function filterRecord(
  record: readonly PlayerSeasonRecord[],
  seasonId: string | null,
): PlayerSeasonRecord[] {
  return seasonId === null ? [...record] : record.filter((r) => r.season.id === seasonId);
}

export function filterMatches(
  matches: readonly PlayerMatch[],
  seasonId: string | null,
): PlayerMatch[] {
  return seasonId === null ? [...matches] : matches.filter((m) => m.fixture.season.id === seasonId);
}

/** Appearances as the sum of starts and substitute appearances. */
export function appearances(row: Pick<PlayerSeasonRecord, 'starts' | 'sub_appearances'>): number {
  return row.starts + row.sub_appearances;
}

/**
 * A season's minutes as the record table shows them (T-823): the total when
 * every match played has minutes; "at least" the supplied sum, with how many
 * matches it covers, when only some do -- never the partial sum on its own;
 * "not supplied" when none do.
 */
export function minutesText(
  locale: string,
  minutes: PlayerSeasonMinutes,
): { text: string; note: string | null } {
  if (minutes.coverage === 'available' && minutes.total !== null) {
    return { text: formatNumber(locale, minutes.total), note: null };
  }
  if (minutes.coverage === 'limited') {
    return {
      text: say(locale, 'playerPage.minutesAtLeast', {
        minutes: formatNumber(locale, minutes.supplied_minutes),
      }),
      note: plural(pageLocale(locale), 'playerPage.minutesCovers', minutes.matches, {
        with: formatNumber(locale, minutes.matches_with_minutes),
      }).text,
    };
  }
  return { text: say(locale, 'playerPage.minutesNotSupplied'), note: null };
}

/** "Started" / "Came on" / "Unused sub". */
export function roleLabel(locale: string, match: Pick<PlayerMatch, 'role' | 'came_on'>): string {
  if (match.role === 'starter') return say(locale, 'playerPage.role.started');
  return say(locale, match.came_on ? 'playerPage.role.cameOn' : 'playerPage.role.unused');
}

/**
 * The feed is asked who misses a match every three hours in the three days
 * before kick-off (T-103). An answer older than twice that has missed a
 * re-ask, so the page says it may have changed (rule 4, T-1007, D-127).
 */
export const AVAILABILITY_STALE_AFTER_HOURS = AVAILABILITY_STALE_AFTER_MS / 3_600_000;

/** Whether the feed's last answer about a match is old enough to say so. */
export function availabilityStale(askedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(askedAt) > AVAILABILITY_STALE_AFTER_HOURS * 60 * 60 * 1000;
}
