import type {
  PlayerClub,
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

/**
 * The club a page names for the player, and what says so (T-1629, D-295):
 * the API's `club` -- an open spell, else the newest of his latest club
 * line-up, a squad list naming him and a recorded move, never a national
 * team. From an API older than T-1629 (no `club`), the open spell only: its
 * latest line-up may be a national team's, and the header says that one as a
 * line-up (`lineupTeam`). Null when nothing names a club.
 */
export function clubClaim(page: Pick<PlayerPage, 'club' | 'current_spell'>): PlayerClub | null {
  if (page.club !== undefined) return page.club.data;
  const spell = page.current_spell;
  if (spell === null) return null;
  return { team: spell.team, basis: 'spell', since: spell.start_date, on_loan: spell.on_loan };
}

/**
 * The player's position (T-1603, read by the pages since T-1629): the API's
 * `position` -- the open spell's, the squad list's, else the one he held most
 * in his last ten line-ups -- or, from an older API, the open spell's. Null
 * when none names one.
 */
export function positionValue(
  page: Pick<PlayerPage, 'position' | 'current_spell'>,
): NonNullable<PlayerSpell['position']> | null {
  if (page.position !== undefined) return page.position.data?.value ?? null;
  return page.current_spell?.position ?? null;
}

/** What a club claim rests on, after the club's name (T-1629): "since 1 July 2025", "in the club’s squad list, read 22 October 2026"... */
export function clubBasisText(locale: string, club: PlayerClub): string {
  const date = dayText(locale, club.since);
  switch (club.basis) {
    case 'spell':
      return say(locale, 'playerPage.since', { date });
    case 'squad':
      return say(locale, 'playerPage.club.squad', { date });
    case 'transfer':
      return say(locale, 'playerPage.club.transfer', { date });
    case 'lineup':
      return say(locale, 'playerPage.club.lineup', { date });
  }
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

/**
 * The seasons the record covers, newest first as the record is, each label
 * once (T-1565). Every competition has a season of its own, so a player's
 * 2026/27 is one id in the league and another in a cup or in the league he
 * moved to mid-season; the reader's season is the label, and the pill links
 * with the first id that carries it.
 */
export function seasonsOf(record: readonly PlayerSeasonRecord[]): { id: string; label: string }[] {
  const seen = new Set<string>();
  const seasons: { id: string; label: string }[] = [];
  for (const row of record) {
    if (seen.has(row.season.label)) continue;
    seen.add(row.season.label);
    seasons.push(row.season);
  }
  return seasons;
}

/** The label of `?season=<id>`, from any row or match that carries the id; null when none does. */
export function seasonLabelOf(
  record: readonly PlayerSeasonRecord[],
  matches: readonly PlayerMatch[],
  seasonId: string | null,
): string | null {
  if (seasonId === null) return null;
  const season =
    record.find((r) => r.season.id === seasonId)?.season ??
    matches.find((m) => m.fixture.season.id === seasonId)?.fixture.season;
  return season?.label ?? null;
}

/** The rows of one season by its label (every competition's), or every row. */
export function filterRecord(
  record: readonly PlayerSeasonRecord[],
  seasonLabel: string | null,
): PlayerSeasonRecord[] {
  return seasonLabel === null ? [...record] : record.filter((r) => r.season.label === seasonLabel);
}

/** The matches of one season by its label (every competition's), or every match. */
export function filterMatches(
  matches: readonly PlayerMatch[],
  seasonLabel: string | null,
): PlayerMatch[] {
  return seasonLabel === null
    ? [...matches]
    : matches.filter((m) => m.fixture.season.label === seasonLabel);
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

/** Matches on the Overview's "last six" (T-1500); the Matches tab has every one the API sent. */
export const OVERVIEW_PLAYER_MATCHES = 6;

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
 * season, as the API orders it), and the other competitions of that season
 * by its label (T-1565: each competition's season has its own id), which the
 * tiles do not add in.
 */
export function latestSeason(record: readonly PlayerSeasonRecord[]): {
  row: PlayerSeasonRecord;
  others: PlayerSeasonRecord[];
} | null {
  const row = record[0];
  if (row === undefined) return null;
  return { row, others: record.slice(1).filter((r) => r.season.label === row.season.label) };
}

// ---------------------------------------------------------------------------
// The Stadiomind player page (T-1500, D-271): the season's tiles and the
// career table by season.
// ---------------------------------------------------------------------------

/**
 * The record's rows by season, in the record's order (newest season first),
 * each season once with its rows: the career table's row groups. A season is
 * its label (T-1565), so a cup's 2025/26 joins the league's even where the
 * API lists it after an older season.
 */
export function seasonGroups(
  record: readonly PlayerSeasonRecord[],
): { season: PlayerSeasonRecord['season']; rows: PlayerSeasonRecord[] }[] {
  const groups: { season: PlayerSeasonRecord['season']; rows: PlayerSeasonRecord[] }[] = [];
  for (const row of record) {
    const group = groups.find((g) => g.season.label === row.season.label);
    if (group === undefined) groups.push({ season: row.season, rows: [row] });
    else group.rows.push(row);
  }
  return groups;
}

/** A season's goals and appearances over every competition and team it has. */
export function seasonTotals(rows: readonly PlayerSeasonRecord[]): {
  goals: number;
  appearances: number;
} {
  return rows.reduce(
    (sum, row) => ({
      goals: sum.goals + row.goals,
      appearances: sum.appearances + appearances(row),
    }),
    { goals: 0, appearances: 0 },
  );
}

/**
 * Goals per 90 minutes, only from minutes the feed sent for every match the
 * player played (`available`) and at least a whole match of them: "at least"
 * minutes would make the rate look higher than it is, and a few minutes off
 * the bench would make it meaningless. Null otherwise, and the tile leaves
 * the rate out rather than estimate it (rule 3).
 */
export function goalsPer90(goals: number, minutes: PlayerSeasonMinutes): number | null {
  if (minutes.coverage !== 'available' || minutes.total === null || minutes.total < 90) return null;
  return (goals * 90) / minutes.total;
}
