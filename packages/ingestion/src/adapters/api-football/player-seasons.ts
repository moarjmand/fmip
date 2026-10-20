/**
 * API-Football `/players?id=&season=` and `/players/teams?player=` → the
 * normalised model (T-1431, D-223). Kept apart from `map.ts` so the player
 * profile and squad mappings there change without touching these.
 *
 * Field names below are API-Football's (including its spelling,
 * `appearences`). None of them leave this directory.
 */

import type {
  EntityRef,
  NormalisedCareerEntry,
  NormalisedPlayerSeasonLine,
} from '../../normalised';
import { decodeEntities } from '../../news/feed';
import { isRecord, type Json } from './map';

const rec = (value: unknown): Json => (isRecord(value) ? value : {});

/** A count: a whole number, zero or more. Anything else was not supplied. */
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** API-Football ids are numbers; the contract wants them as strings. */
const id = (value: unknown): string | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? String(value) : null;

/** The earliest and latest season start years believed, so a stray number is not a season. */
const FIRST_YEAR = 1870;
const LAST_YEAR = 2100;
const year = (value: unknown): number | null => {
  const n = count(value);
  return n !== null && n >= FIRST_YEAR && n <= LAST_YEAR ? n : null;
};

/** An id and a plain name (entities decoded, whitespace collapsed), or `null`. */
function entity(value: unknown): EntityRef | null {
  const v = rec(value);
  const externalId = id(v.id);
  if (externalId === null || typeof v.name !== 'string') return null;
  const name = decodeEntities(v.name).replace(/\s+/g, ' ').trim();
  return /\p{L}/u.test(name) ? { externalId, name } : null;
}

/**
 * The provider's average rating, a string ("7.123333") or a number. Kept to two
 * places, and only between 0 and 10: anything else is not a rating we can read.
 */
export function seasonRating(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null;
  return Math.round(n * 100) / 100;
}

/**
 * `/players?id=&season=`: one entry for the player, whose `statistics` hold a
 * block per competition and team for that season. A block is kept when it
 * names both, is for the season asked about, and the player appeared at least
 * once: the provider also lists competitions where he was only named on the
 * bench, and a line of nothing is not a season's record. Saves and goals
 * conceded are kept for a goalkeeper only (the provider writes 0 conceded for
 * outfield players whatever the score). A block repeated for the same
 * competition and team counts once.
 */
export function mapPlayerSeason(
  response: unknown,
  personExternalId: string,
  seasonYear: number,
): NormalisedPlayerSeasonLine[] {
  if (!Array.isArray(response)) return [];
  const out: NormalisedPlayerSeasonLine[] = [];
  const seen = new Set<string>();
  for (const item of response) {
    const it = rec(item);
    if (id(rec(it.player).id) !== personExternalId) continue;
    if (!Array.isArray(it.statistics)) continue;
    for (const block of it.statistics) {
      const b = rec(block);
      const league = rec(b.league);
      const competition = entity(league);
      const team = entity(b.team);
      if (competition === null || team === null) continue;
      const blockYear = league.season === undefined ? seasonYear : year(league.season);
      if (blockYear !== seasonYear) continue;
      const games = rec(b.games);
      const appearances = count(games.appearences ?? games.appearances);
      if (appearances === null || appearances === 0) continue;
      const key = `${competition.externalId}:${team.externalId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const goals = rec(b.goals);
      const cards = rec(b.cards);
      const keeper = games.position === 'Goalkeeper';
      out.push({
        competition,
        team,
        seasonYear,
        appearances,
        starts: count(games.lineups),
        minutes: count(games.minutes),
        goals: count(goals.total),
        assists: count(goals.assists),
        yellowCards: count(cards.yellow),
        secondYellowCards: count(cards.yellowred),
        redCards: count(cards.red),
        saves: keeper ? count(goals.saves) : null,
        goalsConceded: keeper ? count(goals.conceded) : null,
        rating: seasonRating(games.rating),
      });
    }
  }
  return out;
}

/**
 * `/players/teams?player=`: one entry per club or national team, each with
 * the `seasons` (start years) the player was there. A team without an id or a
 * name, or without a season we can read, is left out; a team listed twice has
 * its seasons merged. Newest season first, within and across teams.
 */
export function mapPlayerCareer(response: unknown): NormalisedCareerEntry[] {
  if (!Array.isArray(response)) return [];
  const byTeam = new Map<string, { team: EntityRef; years: Set<number> }>();
  for (const item of response) {
    const it = rec(item);
    const team = entity(it.team);
    if (team === null || !Array.isArray(it.seasons)) continue;
    const years = it.seasons.map(year).filter((y): y is number => y !== null);
    if (years.length === 0) continue;
    const entry = byTeam.get(team.externalId) ?? { team, years: new Set<number>() };
    for (const y of years) entry.years.add(y);
    byTeam.set(team.externalId, entry);
  }
  return [...byTeam.values()]
    .map((e) => ({ team: e.team, seasonYears: [...e.years].sort((a, b) => b - a) }))
    .sort((a, b) => (b.seasonYears[0] ?? 0) - (a.seasonYears[0] ?? 0));
}
