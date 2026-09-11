import type { PlayerMatch, PlayerPage, PlayerSeasonRecord, PlayerSpell } from '@fmip/contracts';

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

export const FOOT_LABEL: Record<NonNullable<PlayerPage['person']['preferred_foot']>, string> = {
  left: 'Left foot',
  right: 'Right foot',
  both: 'Either foot',
};

export const POSITION_LABEL: Record<NonNullable<PlayerSpell['position']>, string> = {
  goalkeeper: 'Goalkeeper',
  defender: 'Defender',
  midfielder: 'Midfielder',
  forward: 'Forward',
};

/** "Jul 2025 – present" or "Jul 2022 – Jun 2025". */
export function spellPeriod(spell: Pick<PlayerSpell, 'start_date' | 'end_date'>): string {
  const month = (iso: string): string =>
    new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  return `${month(spell.start_date)} – ${spell.end_date === null ? 'present' : month(spell.end_date)}`;
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

/** "Started" / "Came on" / "Unused sub". */
export function roleLabel(match: Pick<PlayerMatch, 'role' | 'came_on'>): string {
  if (match.role === 'starter') return 'Started';
  return match.came_on ? 'Came on' : 'Unused sub';
}
