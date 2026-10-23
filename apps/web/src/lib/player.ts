import type {
  PlayerMatch,
  PlayerPage,
  PlayerSeasonMinutes,
  PlayerSeasonRecord,
  PlayerSpell,
} from '@fmip/contracts';
import type { CoverageState } from '@fmip/contracts';
import { AVAILABILITY_STALE_AFTER_MS } from '@fmip/contracts';
import { formatDate, formatNumber } from '@/i18n/format';
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
 * spell), in the reader's own calendar and digits (T-1304) -- Persian in the
 * Solar Hijri calendar, as `Intl` writes it (D-175). English reads "30
 * December 1990", no longer the stored "1990-12-30" (T-1478).
 */
export function dayText(locale: string, iso: string): string {
  return formatDate(locale, `${iso}T00:00:00Z`, 'UTC', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The team a player with no open spell was last named in a line-up for
 * (T-1394, D-209), and that match's day (`YYYY-MM-DD`, UTC): the newest of
 * `recent_matches`, which are his line-ups newest first. Null while a spell
 * is open (the spell is the answer) or when no line-up names him. The page
 * says it is a line-up, not a contract: "no current team" beside a line-up
 * for a club last week was a contradiction, and a guess either way would be
 * another.
 */
export function lineupTeam(
  page: Pick<PlayerPage, 'current_spell' | 'recent_matches'>,
): { team: { id: string; name: string }; day: string } | null {
  if (page.current_spell !== null) return null;
  const latest = page.recent_matches.data?.[0];
  if (latest === undefined) return null;
  return { team: latest.team, day: latest.fixture.kickoff_at.slice(0, 10) };
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

// ---------------------------------------------------------------------------
// The Hybrid player page (T-1386, D-204): its tabs and the Overview's slices.
// ---------------------------------------------------------------------------

/** The player page's sections, in the order the tab bar shows them. */
export const PLAYER_TABS = ['overview', 'matches', 'career', 'stats'] as const;
export type PlayerTab = (typeof PLAYER_TABS)[number];

/** `?tab=`: one of the page's sections; anything else (or nothing) is the Overview. */
export function readPlayerTab(params: SearchParams): PlayerTab {
  const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  return (PLAYER_TABS as readonly string[]).includes(raw ?? '') ? (raw as PlayerTab) : 'overview';
}

/** One tab's address, keeping the season filter where the tab has one (Matches, Stats). */
export function playerTabHref(
  locale: string,
  personId: string,
  tab: PlayerTab,
  seasonId: string | null = null,
): string {
  const query = new URLSearchParams();
  if (tab !== 'overview') query.set('tab', tab);
  if (seasonId !== null && (tab === 'matches' || tab === 'stats')) query.set('season', seasonId);
  const text = query.toString();
  const base = `/${locale}/player/${encodeURIComponent(personId)}`;
  return text === '' ? base : `${base}?${text}`;
}

/** Matches on the Overview's short list; the Matches tab has every one the API sent. */
export const OVERVIEW_PLAYER_MATCHES = 5;

/**
 * The spells' coverage, by the rule the API gives the squad (`TeamPage.squad`):
 * spells come from our own records, so a player with none is `not_supplied`,
 * never an empty list drawn as a career (rule 3).
 */
export function spellsCoverage(spells: readonly PlayerSpell[]): CoverageState {
  return spells.length === 0 ? 'not_supplied' : 'available';
}

/**
 * The season the Overview's tiles show: the record's first row (the newest
 * season, as the API orders it), and the other competitions of that season,
 * which the tiles do not add in.
 */
export function latestSeason(record: readonly PlayerSeasonRecord[]): {
  row: PlayerSeasonRecord;
  others: PlayerSeasonRecord[];
} | null {
  const row = record[0];
  if (row === undefined) return null;
  return { row, others: record.slice(1).filter((r) => r.season.id === row.season.id) };
}
