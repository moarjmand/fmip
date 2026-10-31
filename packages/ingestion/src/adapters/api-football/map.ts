/**
 * API-Football (api-sports.io, v3) → the normalised model. Pure functions over
 * `unknown`: the provider's payload is data we were sent, not a type we trust,
 * so every field is read through a narrowing helper and anything the provider
 * did not supply becomes `null` (rule 3), never a default.
 *
 * Field names below are API-Football's. None of them leave this directory.
 */

import type {
  AbsenceKind,
  AbsenceStatus,
  FixtureStatus,
  IncidentKind,
  NormalisedAbsence,
  NormalisedFixture,
  NormalisedIncident,
  LineupGrid,
  NormalisedLineup,
  NormalisedLineupPlayer,
  NormalisedNationality,
  NormalisedPeriod,
  NormalisedPersonBio,
  NormalisedPersonProfile,
  NormalisedPlayerStat,
  NormalisedSeasonCoverage,
  NormalisedSideLineup,
  NormalisedSquadPlayer,
  NormalisedStanding,
  NormalisedStandingRow,
  NormalisedStat,
  PlayerStatMetric,
  Position,
  Side,
  StageKind,
  StatMetric,
} from '../../normalised';
import { decodeEntities } from '../../news/feed';
import { conferenceOfLabel, groupOfLabel, stageOfLabel } from '../_group';
import { incidentDetail } from '../_incident-detail';
import { nationalityCode } from './nationality';

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const rec = (value: unknown): Json => (isRecord(value) ? value : {});
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;
const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
/** API-Football ids are numbers; the contract wants them as strings. */
const id = (value: unknown): string | null => {
  const n = int(value);
  // Positive only (T-1600): the provider writes 0 for "not known", and as an
  // id it made one person, coach or venue of every unknown one (rule 1).
  return n === null || n <= 0 ? null : String(n);
};
/**
 * An image address (`logo`, `photo`) as the provider gave it, when it is an
 * https URL (T-1320). It stays inside ingestion: the media store copies the
 * file, and only our own address ever reaches a reader (rule 2).
 */
export const imageUrl = (value: unknown): string | null => {
  const s = str(value);
  return s !== null && /^https:\/\/\S+$/.test(s) ? s : null;
};
/**
 * A competition's ref with its country's flag (T-1611, D-282): `league.flag`,
 * which the provider sets for a league of one country and leaves `null` for a
 * continental or international one. Absent when not carried.
 */
function withCountryFlag<T extends { externalId: string; name: string }>(
  ref: T,
  flag: string | null,
): T & { countryFlagUrl?: string } {
  return flag === null ? ref : { ...ref, countryFlagUrl: flag };
}
/** `ref` with its image, when the provider carried one; absent otherwise. */
function withImage<T extends { externalId: string; name: string }>(
  ref: T,
  image: string | null,
): T & { imageUrl?: string } {
  return image === null ? ref : { ...ref, imageUrl: image };
}

// ---------------------------------------------------------------------------
// Seasons, statuses, rounds
// ---------------------------------------------------------------------------

/** "2023/24" → 2023. Returns null for anything else. */
export function seasonYear(label: string): number | null {
  const match = /^(\d{4})(?:\/\d{2,4})?$/.exec(label.trim());
  if (match?.[1] === undefined) return null;
  return Number(match[1]);
}

/** 2023 → "2023/24": the label the catalog uses for European seasons. */
export function seasonLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * API-Football `fixture.status.short`. Anything unknown becomes `null` and the
 * fixture is dropped rather than shown with a guessed status.
 */
const STATUS: Record<string, FixtureStatus> = {
  TBD: 'scheduled',
  NS: 'scheduled',
  '1H': 'live',
  HT: 'live',
  '2H': 'live',
  ET: 'live',
  BT: 'live',
  P: 'live',
  LIVE: 'live',
  INT: 'live',
  SUSP: 'suspended',
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  PST: 'postponed',
  CANC: 'cancelled',
  ABD: 'abandoned',
  AWD: 'awarded',
  WO: 'awarded',
};

export function mapStatus(short: unknown): FixtureStatus | null {
  return typeof short === 'string' ? (STATUS[short] ?? null) : null;
}

/** "Regular Season - 3", "League Stage - 1" → stage kind from the words, round as given. */
export function stageKindOf(round: string): StageKind | null {
  const r = round.toLowerCase();
  // "League Stage - 1": the one table UEFA's competitions have played since
  // 2024/25. Asked before the knockout words, which it does not contain.
  if (r.includes('regular season') || /^league (stage|phase)/.test(r)) return 'league';
  if (r.includes('group')) return 'group';
  if (r.includes('play-off') || r.includes('playoff') || r.includes('relegation round')) {
    return 'playoff';
  }
  if (r.includes('qualifying') || r.includes('preliminary')) return 'qualifying';
  if (/round of|1\/8|1\/4|quarter|semi|final|knockout/.test(r)) return 'knockout';
  return null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function score(value: unknown): { home: number; away: number } | null {
  const s = rec(value);
  const home = int(s.home);
  const away = int(s.away);
  return home === null || away === null || home < 0 || away < 0 ? null : { home, away };
}

/**
 * The referee as plain name text (T-1438, D-229): the provider writes
 * "Anthony Taylor, England" or "M. Oliver", so the country after a comma is
 * dropped and entities decoded. Never an entity: no id comes with it.
 */
export function refereeName(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  const name = decodeEntities(s.split(',')[0] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return /\p{L}/u.test(name) && name.length <= 120 ? name : null;
}

const DAY_MS = 86_400_000;

/** True when a kick-off is at least a day after the moment the answer arrived. */
function playedTooEarly(kickoffAt: string, receivedAt: string): boolean {
  const kickoff = Date.parse(kickoffAt);
  const received = Date.parse(receivedAt);
  return Number.isFinite(kickoff) && Number.isFinite(received) && kickoff - received >= DAY_MS;
}

/**
 * One element of `response` from `/fixtures`. Returns null when the element
 * lacks what a fixture needs (id, teams, kick-off, a known status).
 */
export function mapFixture(item: unknown, receivedAt: string): NormalisedFixture | null {
  const it = rec(item);
  const fixture = rec(it.fixture);
  const league = rec(it.league);
  const teams = rec(it.teams);
  const home = rec(teams.home);
  const away = rec(teams.away);
  const scores = rec(it.score);
  const statusRec = rec(fixture.status);

  const externalId = id(fixture.id);
  const kickoffAt = str(fixture.date);
  const status = mapStatus(statusRec.short);
  const leagueId = id(league.id);
  const leagueName = str(league.name);
  const startYear = int(league.season);
  const homeId = id(home.id);
  const homeName = str(home.name);
  const awayId = id(away.id);
  const awayName = str(away.name);

  if (
    externalId === null ||
    kickoffAt === null ||
    status === null ||
    leagueId === null ||
    leagueName === null ||
    startYear === null ||
    homeId === null ||
    homeName === null ||
    awayId === null ||
    awayName === null
  ) {
    return null;
  }
  // A match a day or more ahead cannot be under way or over: the provider
  // has listed AFCON qualifiers for March 2027 as "FT" with a score (T-1350).
  // Dropped like an unknown status, never shown as played.
  if ((status === 'live' || status === 'finished') && playedTooEarly(kickoffAt, receivedAt)) {
    return null;
  }

  const round = str(league.round);
  const stageKind = round === null ? null : stageKindOf(round);
  const venue = rec(fixture.venue);
  const venueName = str(venue.name);
  const referee = refereeName(fixture.referee);
  const elapsed = int(statusRec.elapsed);
  const goals = score(it.goals);

  return {
    externalId,
    competition: withCountryFlag(
      withImage({ externalId: leagueId, name: leagueName }, imageUrl(league.logo)),
      imageUrl(league.flag),
    ),
    season: { label: seasonLabel(startYear), startYear },
    stage:
      round !== null && stageKind !== null
        ? { name: round.split(' - ')[0]?.trim() || round, kind: stageKind }
        : null,
    round,
    kickoffAt,
    status,
    minute: status === 'live' && elapsed !== null && elapsed >= 0 ? elapsed : null,
    home: withImage({ externalId: homeId, name: homeName }, imageUrl(home.logo)),
    away: withImage({ externalId: awayId, name: awayName }, imageUrl(away.logo)),
    venue:
      venueName === null
        ? null
        : { externalId: id(venue.id), name: venueName, city: str(venue.city) },
    referee: referee === null ? null : { externalId: null, name: referee },
    scores: {
      current: goals,
      halfTime: score(scores.halftime),
      // API-Football's `fulltime` is the 90-minute score, our full_time too;
      // `goals` carries the final including extra time and penalties are separate.
      fullTime: score(scores.fulltime) ?? (status === 'finished' ? goals : null),
      extraTime: score(scores.extratime),
      penalties: score(scores.penalty),
      aggregate: null,
    },
    // The provider does not say when it last touched a fixture, so the fetch
    // time is the honest freshness (rule 4).
    lastUpdatedAt: receivedAt,
  };
}

// ---------------------------------------------------------------------------
// Events → incidents
// ---------------------------------------------------------------------------

function incidentKind(type: unknown, detail: unknown): IncidentKind | null {
  const t = String(type ?? '').toLowerCase();
  const d = String(detail ?? '').toLowerCase();
  if (t === 'goal') {
    if (d.includes('own')) return 'own_goal';
    if (d.includes('missed')) return 'penalty_missed';
    if (d.includes('penalty')) return 'penalty_goal';
    return 'goal';
  }
  if (t === 'card') {
    if (d.includes('second yellow')) return 'second_yellow_card';
    if (d.includes('yellow')) return 'yellow_card';
    if (d.includes('red')) return 'red_card';
    return null;
  }
  if (t === 'subst') return 'substitution';
  if (t === 'var') return 'var';
  return null;
}

function ref(value: unknown): { externalId: string; name: string } | null {
  const r = rec(value);
  const externalId = id(r.id);
  const name = str(r.name);
  return externalId === null || name === null ? null : { externalId, name };
}

/** `ref` plus the image the same object carries under `field` (T-1320). */
function imagedRef(
  value: unknown,
  field: 'logo' | 'photo',
): { externalId: string; name: string; imageUrl?: string } | null {
  const r = ref(value);
  return r === null ? null : withImage(r, imageUrl(rec(value)[field]));
}

/**
 * What a coach's provider number is written after (T-1439, D-230): the
 * provider numbers coaches apart from players (coach 4 is Guardiola, player 4
 * a goalkeeper), and both are people to us, so a coach's number is
 * `coach:4` and one number never names two people (rule 1).
 */
export const COACH_ID_PREFIX = 'coach:';

/** A coach block's ref moved into the coach id space. */
function inCoachSpace<T extends { externalId: string }>(ref: T | null): T | null {
  return ref === null ? null : { ...ref, externalId: `${COACH_ID_PREFIX}${ref.externalId}` };
}

/** The contract's ceiling on stoppage time (`validate.ts`, the incident table). */
const MAX_ADDED_TIME = 30;

/**
 * `events` of one fixture. An event whose player the provider did not
 * identify cannot become an incident (the contract needs a player for every
 * kind but VAR), so it is left out rather than attributed to nobody.
 */
export function mapIncidents(
  events: unknown,
  fixtureExternalId: string,
  homeTeamId: string,
): NormalisedIncident[] {
  if (!Array.isArray(events)) return [];
  const out: NormalisedIncident[] = [];
  for (const raw of events) {
    const e = rec(raw);
    const time = rec(e.time);
    const minute = int(time.elapsed);
    const kind = incidentKind(e.type, e.detail);
    if (minute === null || minute < 0 || kind === null) continue;
    const teamId = id(rec(e.team).id);
    const side: Side | null = teamId === null ? null : teamId === homeTeamId ? 'home' : 'away';
    const player = ref(e.player);
    const related = ref(e.assist);
    if (kind !== 'var' && player === null) continue;
    if (kind === 'substitution' && related === null) continue;
    // `extra` is stoppage time, except in a shoot-out, where the provider
    // numbers the kicks as 120+1, 120+2, ... A long shoot-out passes the
    // contract's thirty minutes (a 34-kick one aborted a whole post-match run,
    // T-538); a number past it is not stoppage time, so it is not supplied.
    const extra = int(time.extra);
    out.push({
      fixtureExternalId,
      sequence: out.length + 1,
      minute,
      addedTime: extra !== null && extra > 0 && extra <= MAX_ADDED_TIME ? extra : null,
      kind,
      side,
      player,
      // For a substitution API-Football's `assist` is the player coming on.
      relatedPlayer: related,
      // In our words: what a VAR review decided, else none. Neither `detail`
      // ("Normal Goal", "Substitution 1") nor `comments` ("Foul") reaches a
      // page as the provider wrote it (rule 2, T-1378).
      detail: incidentDetail(kind, e.detail),
    });
  }
  return out;
}

/**
 * What one element of the live list (`/fixtures?live=all`) carries beyond the
 * fixture (T-830): its `events`, when the element has the array, and whether
 * the match is at the half-time interval (`HT`). An element with no `events`
 * array leaves `incidents` absent -- "not said", never "none" -- so a match
 * whose events the provider left out does not read as a match without goals.
 */
export function liveExtras(
  item: unknown,
  fixture: NormalisedFixture,
): { incidents?: NormalisedIncident[]; halfTimeBreak: boolean } {
  const it = rec(item);
  const short = rec(rec(it.fixture).status).short;
  return {
    halfTimeBreak: short === 'HT',
    ...(Array.isArray(it.events)
      ? { incidents: mapIncidents(it.events, fixture.externalId, fixture.home.externalId) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Lineups
// ---------------------------------------------------------------------------

const POSITION: Record<string, Position> = {
  G: 'goalkeeper',
  D: 'defender',
  M: 'midfielder',
  F: 'forward',
};

/** "row:column", each a whole number from 1 to 11: "1:1", "4:3". */
const GRID = /^([1-9]|1[01]):([1-9]|1[01])$/;

/**
 * A starter's `grid` (T-1397, D-212): "row:column", row 1 the goalkeeper's
 * line, columns counted across the line. Anything else -- a number, "0:1",
 * "2:", "12:1", " 2:1" -- is no place, so it is null rather than a guess; the
 * provider's string never leaves this file (rule 2).
 */
export function gridOf(value: unknown): LineupGrid | null {
  if (typeof value !== 'string') return null;
  const match = GRID.exec(value);
  if (match === null) return null;
  return { row: Number(match[1]), col: Number(match[2]) };
}

/**
 * Two starters of one side given the same place: neither place can be true,
 * so both are dropped (rule 3) and the page falls back for that side.
 */
function withoutSharedPlaces(players: NormalisedLineupPlayer[]): NormalisedLineupPlayer[] {
  const count = new Map<string, number>();
  for (const p of players) {
    if (p.grid === null) continue;
    const key = `${p.grid.row}:${p.grid.col}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return players.map((p) =>
    p.grid !== null && (count.get(`${p.grid.row}:${p.grid.col}`) ?? 0) > 1
      ? { ...p, grid: null }
      : p,
  );
}

function lineupPlayers(
  list: unknown,
  role: 'starter' | 'bench',
  captains: ReadonlySet<string>,
  seen: Set<string>,
  photos: ReadonlyMap<string, string>,
): NormalisedLineupPlayer[] {
  if (!Array.isArray(list)) return [];
  const out: NormalisedLineupPlayer[] = [];
  for (const raw of list) {
    const p = rec(rec(raw).player);
    const externalId = id(p.id);
    const name = str(p.name);
    if (externalId === null || name === null || seen.has(externalId)) continue;
    seen.add(externalId);
    const number = int(p.number);
    const pos = typeof p.pos === 'string' ? (POSITION[p.pos] ?? null) : null;
    out.push({
      ...withImage({ externalId, name }, imageUrl(p.photo) ?? photos.get(externalId) ?? null),
      role,
      shirtNumber: number !== null && number >= 1 && number <= 99 ? number : null,
      position: pos,
      isCaptain: captains.has(externalId),
      // Only a starter has a place in the shape; the bench's `grid` is null.
      grid: role === 'starter' ? gridOf(p.grid) : null,
    });
  }
  return out;
}

/**
 * Captains come from the per-player statistics block of `/fixtures?id=`
 * (`games.captain`), keyed by team id; the lineups block does not carry them.
 */
export function captainsByTeam(players: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(players)) return out;
  for (const teamBlock of players) {
    const tb = rec(teamBlock);
    const teamId = id(rec(tb.team).id);
    if (teamId === null || !Array.isArray(tb.players)) continue;
    for (const entry of tb.players) {
      const en = rec(entry);
      const playerId = id(rec(en.player).id);
      const stats = Array.isArray(en.statistics) ? rec(en.statistics[0]) : {};
      if (playerId !== null && rec(stats.games).captain === true && !out.has(teamId)) {
        out.set(teamId, playerId);
      }
    }
  }
  return out;
}

/**
 * Player photos from the per-player block of `/fixtures?id=` (T-1320), by
 * player id: the lineups block names the players without their photos.
 */
export function photosByPlayer(players: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(players)) return out;
  for (const teamBlock of players) {
    const tb = rec(teamBlock);
    if (!Array.isArray(tb.players)) continue;
    for (const entry of tb.players) {
      const p = rec(rec(entry).player);
      const playerId = id(p.id);
      const photo = imageUrl(p.photo);
      if (playerId !== null && photo !== null && !out.has(playerId)) out.set(playerId, photo);
    }
  }
  return out;
}

/**
 * A side's outfield shirt colour (T-1415, D-218): `team.colors.player.primary`,
 * six hex digits without the `#` in the feed, as `#rrggbb`. Anything else --
 * absent, three digits, a name, a stray character -- is null, never guessed.
 */
export function kitColourOf(block: unknown): string | null {
  const primary = rec(rec(rec(rec(block).team).colors).player).primary;
  if (typeof primary !== 'string' || !/^[0-9a-fA-F]{6}$/.test(primary)) return null;
  return `#${primary.toLowerCase()}`;
}

function sideLineup(
  block: unknown,
  captain: string | null,
  photos: ReadonlyMap<string, string>,
): NormalisedSideLineup {
  const b = rec(block);
  const formation = str(b.formation);
  const captains = new Set(captain === null ? [] : [captain]);
  const seen = new Set<string>();
  return {
    formation: formation !== null && /^[0-9](-[0-9]){2,4}$/.test(formation) ? formation : null,
    coach: inCoachSpace(imagedRef(b.coach, 'photo')),
    players: [
      ...withoutSharedPlaces(lineupPlayers(b.startXI, 'starter', captains, seen, photos)),
      ...lineupPlayers(b.substitutes, 'bench', captains, seen, photos),
    ],
    kitColour: kitColourOf(block),
  };
}

/**
 * `lineups` (two team blocks, matched to home/away by team id, never by
 * position in the array) plus `players` for the captains. Null when either
 * side is missing: half a lineup is not a lineup.
 */
export function mapLineup(
  lineups: unknown,
  players: unknown,
  fixtureExternalId: string,
  homeTeamId: string,
  awayTeamId: string,
): NormalisedLineup | null {
  if (!Array.isArray(lineups)) return null;
  const byTeam = new Map<string, unknown>();
  for (const block of lineups) {
    const teamId = id(rec(rec(block).team).id);
    if (teamId !== null) byTeam.set(teamId, block);
  }
  const home = byTeam.get(homeTeamId);
  const away = byTeam.get(awayTeamId);
  if (home === undefined || away === undefined) return null;
  const captains = captainsByTeam(players);
  const photos = photosByPlayer(players);
  const result: NormalisedLineup = {
    fixtureExternalId,
    home: sideLineup(home, captains.get(homeTeamId) ?? null, photos),
    away: sideLineup(away, captains.get(awayTeamId) ?? null, photos),
  };
  if (result.home.players.length === 0 || result.away.players.length === 0) return null;
  return result;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

const STAT: Record<string, StatMetric> = {
  'Ball Possession': 'possession_pct',
  'Total Shots': 'shots',
  'Shots on Goal': 'shots_on_target',
  'Shots off Goal': 'shots_off_target',
  'Blocked Shots': 'blocked_shots',
  'Corner Kicks': 'corners',
  Offsides: 'offsides',
  Fouls: 'fouls',
  'Yellow Cards': 'yellow_cards',
  'Red Cards': 'red_cards',
  'Total passes': 'passes',
  'Passes accurate': 'passes_accurate',
  'Passes %': 'pass_accuracy_pct',
  'Goalkeeper Saves': 'saves',
  expected_goals: 'expected_goals',
};

/** "55%" → 55, "1.23" → 1.23, 7 → 7, null → null. */
export function statValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number(value.replace('%', '').trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** `statistics` (one block per team). A metric the provider left null is absent. */
export function mapStatistics(statistics: unknown, homeTeamId: string): NormalisedStat[] {
  if (!Array.isArray(statistics)) return [];
  const out: NormalisedStat[] = [];
  const seen = new Set<string>();
  for (const block of statistics) {
    const b = rec(block);
    const teamId = id(rec(b.team).id);
    if (teamId === null || !Array.isArray(b.statistics)) continue;
    const side: Side = teamId === homeTeamId ? 'home' : 'away';
    for (const raw of b.statistics) {
      const s = rec(raw);
      const metric = typeof s.type === 'string' ? STAT[s.type] : undefined;
      const value = statValue(s.value);
      if (metric === undefined || value === null) continue;
      if (metric.endsWith('_pct') && value > 100) continue;
      const key = `${side}:${metric}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ side, metric, value });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Player statistics (T-101)
// ---------------------------------------------------------------------------

/**
 * Where each metric sits in a player's `statistics[0]`. Pass accuracy is left
 * out on purpose: the value reads as a count against some totals and as a
 * percentage against others, and a number whose meaning we would have to guess
 * is not supplied. Nor are penalties, which the incidents already carry.
 */
const PLAYER_STAT: [PlayerStatMetric, string, string | null][] = [
  ['minutes', 'games', 'minutes'],
  ['rating', 'games', 'rating'],
  ['shots', 'shots', 'total'],
  ['shots_on_target', 'shots', 'on'],
  ['goals', 'goals', 'total'],
  ['assists', 'goals', 'assists'],
  ['saves', 'goals', 'saves'],
  ['goals_conceded', 'goals', 'conceded'],
  ['passes', 'passes', 'total'],
  ['key_passes', 'passes', 'key'],
  ['tackles', 'tackles', 'total'],
  ['blocks', 'tackles', 'blocks'],
  ['interceptions', 'tackles', 'interceptions'],
  ['duels', 'duels', 'total'],
  ['duels_won', 'duels', 'won'],
  ['dribbles', 'dribbles', 'attempts'],
  ['dribbles_won', 'dribbles', 'success'],
  ['fouls_drawn', 'fouls', 'drawn'],
  ['fouls_committed', 'fouls', 'committed'],
  ['offsides', 'offsides', null],
  ['yellow_cards', 'cards', 'yellow'],
  ['red_cards', 'cards', 'red'],
];

/**
 * `players` (one block per team, matched to a side by team id). A player who
 * never came on has no minutes and no rating, so no rows at all: an unused
 * substitute did not play a match with zeroes in it. A value the provider left
 * null is absent -- API-Football writes null for a player with no shots, and
 * turning that into 0 would be a guess about what null means. Saves and goals
 * conceded are a goalkeeper's: the provider writes `conceded: 0` for every
 * outfield player, whatever the score was.
 */
export function mapPlayerStatistics(
  players: unknown,
  homeTeamId: string,
  awayTeamId: string,
): NormalisedPlayerStat[] {
  if (!Array.isArray(players)) return [];
  const out: NormalisedPlayerStat[] = [];
  const seen = new Set<string>();
  for (const teamBlock of players) {
    const tb = rec(teamBlock);
    const teamId = id(rec(tb.team).id);
    if (teamId === null || !Array.isArray(tb.players)) continue;
    const side: Side | null =
      teamId === homeTeamId ? 'home' : teamId === awayTeamId ? 'away' : null;
    if (side === null) continue;
    for (const entry of tb.players) {
      const en = rec(entry);
      const player = imagedRef(en.player, 'photo');
      const stats = Array.isArray(en.statistics) ? rec(en.statistics[0]) : {};
      if (player === null) continue;
      if (statValue(rec(stats.games).minutes) === null) continue;
      const keeper = rec(stats.games).position === 'G';
      for (const [metric, group, field] of PLAYER_STAT) {
        if (!keeper && (metric === 'saves' || metric === 'goals_conceded')) continue;
        const value = statValue(field === null ? stats[group] : rec(stats[group])[field]);
        if (value === null) continue;
        // A rating is 1 to 10; the provider writes 0 for a player it did not
        // rate (T-1618, D-289), which read as a rating would be the worst one.
        if (metric === 'rating' && (value > 10 || value <= 0)) continue;
        const key = `${player.externalId}:${metric}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ side, player, metric, value });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Availability (T-103)
// ---------------------------------------------------------------------------

/** `player.type` of `/injuries`: the only two the provider uses. */
const ABSENCE_STATUS: Record<string, AbsenceStatus> = {
  'Missing Fixture': 'out',
  Questionable: 'doubtful',
};

/**
 * What a reason amounts to. Read from the provider's words and kept beside
 * them, so a reason this does not recognise is `other` with its text intact
 * rather than a guess.
 */
export function absenceKind(reason: string | null): AbsenceKind | null {
  if (reason === null) return null;
  if (/suspen|red card|yellow card/i.test(reason)) return 'suspension';
  if (/illness|virus|sick/i.test(reason)) return 'illness';
  if (/injur|knock|strain|fracture|surgery|concussion|tear|sprain/i.test(reason)) return 'injury';
  return 'other';
}

/**
 * `/injuries?fixture=` -- one entry per player listed for the match. An entry
 * whose status is neither of the two above is dropped: we cannot say whether
 * that player will play, so we do not say they will not.
 */
export function mapAvailability(response: unknown, fixtureExternalId: string): NormalisedAbsence[] {
  if (!Array.isArray(response)) return [];
  const out: NormalisedAbsence[] = [];
  const seen = new Set<string>();
  for (const item of response) {
    const fixtureId = id(rec(rec(item).fixture).id);
    if (fixtureId !== null && fixtureId !== fixtureExternalId) continue;
    const absence = absenceEntry(item, fixtureExternalId);
    if (absence === null || seen.has(absence.player.externalId)) continue;
    seen.add(absence.player.externalId);
    out.push(absence);
  }
  return out;
}

/**
 * `/injuries?league=&season=` (T-1650, D-306): the same entries as the
 * per-match answer, for every match of a season in one answer. Each keeps
 * the match it names; an entry that names none cannot be placed and is
 * dropped. A player listed twice for one match counts once.
 */
export function mapSeasonAvailability(response: unknown): NormalisedAbsence[] {
  if (!Array.isArray(response)) return [];
  const out: NormalisedAbsence[] = [];
  const seen = new Set<string>();
  for (const item of response) {
    const fixtureId = id(rec(rec(item).fixture).id);
    if (fixtureId === null) continue;
    const absence = absenceEntry(item, fixtureId);
    if (absence === null) continue;
    const key = `${fixtureId}:${absence.player.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(absence);
  }
  return out;
}

/** One `/injuries` entry for a match: status and kind decided once, for both answers. */
function absenceEntry(item: unknown, fixtureExternalId: string): NormalisedAbsence | null {
  const it = rec(item);
  const player = imagedRef(it.player, 'photo');
  const team = imagedRef(it.team, 'logo');
  if (player === null || team === null) return null;
  const type = str(rec(it.player).type);
  const status = type === null ? undefined : ABSENCE_STATUS[type];
  if (status === undefined) return null;
  const reason = str(rec(it.player).reason);
  return { fixtureExternalId, team, player, status, kind: absenceKind(reason), reason };
}

/** A squad listing's `position` (T-1428): API-Football's four words, and nothing else. */
const SQUAD_POSITION: Record<string, Position> = {
  Goalkeeper: 'goalkeeper',
  Defender: 'defender',
  Midfielder: 'midfielder',
  Attacker: 'forward',
};

/**
 * `/players/squads?team=` (T-1324): one entry for the club, whose `players`
 * list each player's id, name, photo, shirt `number` and `position`. The
 * squads job uses the photo of players we already hold (T-1324) and records
 * their number and position as the club's listed squad (T-1428); the age
 * stays with the provider. A number outside 1 to 99, or a position other than
 * the four, is `null`. An entry for another club than the one asked about is
 * ignored; a player listed twice counts once.
 */
export function mapSquad(response: unknown, teamExternalId: string): NormalisedSquadPlayer[] {
  if (!Array.isArray(response)) return [];
  const out: NormalisedSquadPlayer[] = [];
  const seen = new Set<string>();
  for (const item of response) {
    const it = rec(item);
    const teamId = id(rec(it.team).id);
    if (teamId !== null && teamId !== teamExternalId) continue;
    if (!Array.isArray(it.players)) continue;
    for (const entry of it.players) {
      const player = imagedRef(entry, 'photo');
      if (player === null || seen.has(player.externalId)) continue;
      seen.add(player.externalId);
      const number = int(rec(entry).number);
      const position = str(rec(entry).position);
      out.push({
        ...player,
        shirtNumber: number !== null && number >= 1 && number <= 99 ? number : null,
        position: position === null ? null : (SQUAD_POSITION[position] ?? null),
      });
    }
  }
  return out;
}

/**
 * A name as the provider wrote it, made plain: HTML entities decoded (the
 * provider sends some, "O&apos;Neill"), whitespace collapsed. `null` when
 * nothing with a letter in it is left.
 */
export function plainName(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  const plain = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return /\p{L}/u.test(plain) ? plain : null;
}

/** "1992-06-15": a real calendar date from 1900 on, else `null`. */
export function calendarDate(value: unknown): string | null {
  const s = str(value);
  if (s === null || !/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return null;
  const day = s.trim();
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  return Number(day.slice(0, 4)) >= 1900 ? day : null;
}

/** "175 cm" (or a bare 175): whole centimetres from 100 to 250, else `null`. */
function heightCm(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\s*\d{3}\s*(cm)?\s*$/i.test(value)
        ? Number.parseInt(value, 10)
        : null;
  return n !== null && Number.isInteger(n) && n >= 100 && n <= 250 ? n : null;
}

export function nationality(value: unknown): NormalisedNationality | null {
  const name = plainName(value);
  return name === null ? null : { name, code: nationalityCode(name) };
}

/**
 * `/players/profiles?player=` (T-1398, T-1428): one entry whose `player`
 * carries `id`, `name` (the short form, "M. Salah"), `firstname` ("Mohamed"),
 * `lastname` ("Salah Hamed Mahrous Ghaly"), `birth.date` ("1992-06-15"),
 * `nationality` ("Egypt") and `height` ("175 cm"). Only the entry for the
 * player asked about counts; `null` without one. The full name needs both a
 * given and a family name -- half a name is not a full one -- and each bio
 * field is `null` when it is missing or unreadable. API-Football's profile
 * has no preferred foot, so that is always `null`; the birth place and
 * weight are not kept (no column holds them).
 */
export function mapPersonProfile(
  response: unknown,
  personExternalId: string,
): NormalisedPersonProfile | null {
  if (!Array.isArray(response)) return null;
  for (const item of response) {
    const player = rec(rec(item).player);
    if (id(player.id) !== personExternalId) continue;
    const givenName = plainName(player.firstname);
    const familyName = plainName(player.lastname);
    const bio: NormalisedPersonBio = {
      dateOfBirth: calendarDate(rec(player.birth).date),
      nationality: nationality(player.nationality),
      heightCm: heightCm(player.height),
      preferredFoot: null,
    };
    return {
      externalId: personExternalId,
      shortName: plainName(player.name),
      name:
        givenName === null || familyName === null
          ? null
          : { fullName: `${givenName} ${familyName}`, givenName, familyName },
      bio,
    };
  }
  return null;
}

/**
 * `/leagues?id=&season=` (T-1364): each league carries `seasons[]`, each with
 * its `year` and a `coverage` object of booleans; `coverage.injuries` is
 * whether `/injuries` is supplied for that league's season. Only the entry for
 * the league and year asked about counts. Anything else -- no such league or
 * season, or no boolean -- is `null`: the provider did not say, which is not
 * the same as no.
 */
export function mapSeasonCoverage(
  response: unknown,
  leagueExternalId: string,
  year: number,
): NormalisedSeasonCoverage {
  if (!Array.isArray(response)) return { absences: null };
  for (const item of response) {
    const it = rec(item);
    const leagueId = id(rec(it.league).id);
    if (leagueId !== null && leagueId !== leagueExternalId) continue;
    if (!Array.isArray(it.seasons)) continue;
    for (const entry of it.seasons) {
      const season = rec(entry);
      if (int(season.year) !== year) continue;
      const injuries = rec(season.coverage).injuries;
      return { absences: typeof injuries === 'boolean' ? injuries : null };
    }
  }
  return { absences: null };
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** `fixture.periods.{first,second}` are unix starts; ends are not supplied. */
export function mapPeriods(periods: unknown): NormalisedPeriod[] {
  const p = rec(periods);
  const out: NormalisedPeriod[] = [];
  const first = int(p.first);
  const second = int(p.second);
  if (first !== null && first > 0) {
    out.push({
      kind: 'first_half',
      startedAt: new Date(first * 1000).toISOString(),
      endedAt: null,
      addedMinutes: null,
    });
  }
  if (second !== null && second > 0) {
    out.push({
      kind: 'second_half',
      startedAt: new Date(second * 1000).toISOString(),
      endedAt: null,
      addedMinutes: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

function standingRow(raw: unknown): NormalisedStandingRow | null {
  const r = rec(raw);
  const team = imagedRef(r.team, 'logo');
  const position = int(r.rank);
  const all = rec(r.all);
  const goals = rec(all.goals);
  const played = int(all.played);
  const won = int(all.win);
  const drawn = int(all.draw);
  const lost = int(all.lose);
  const goalsFor = int(goals.for);
  const goalsAgainst = int(goals.against);
  const points = int(r.points);
  if (
    team === null ||
    position === null ||
    played === null ||
    won === null ||
    drawn === null ||
    lost === null ||
    goalsFor === null ||
    goalsAgainst === null ||
    points === null ||
    won + drawn + lost !== played
  ) {
    return null;
  }
  const form = str(r.form);
  return {
    position,
    team,
    played,
    won,
    drawn,
    lost,
    goalsFor,
    goalsAgainst,
    points,
    // API-Football writes form oldest → newest, the order the contract wants.
    form: form !== null && /^[WDL]+$/.test(form) ? form : null,
  };
}

/**
 * `response[0].league.standings`: an array of groups, each an array of rows.
 * One `NormalisedStanding` per group. Each row carries its table's label
 * (`group`: "Group A", "League A - Group 1", or the league's own name for a
 * plain league table); `group` here is the group's own name read from it
 * (`groupOfLabel`), null for a table that is not a group, and `stage` the
 * stage the label names before it ("Apertura - Group A" → "Apertura";
 * `stageOfLabel`, T-1399), null when it names none. `conference` is the
 * conference a label names ("Eastern Conference"; `conferenceOfLabel`,
 * T-1667), null for any other table.
 */
export function mapStandings(response: unknown, receivedAt: string): NormalisedStanding[] {
  if (!Array.isArray(response)) return [];
  const out: NormalisedStanding[] = [];
  for (const entry of response) {
    const league = rec(rec(entry).league);
    const competition = imagedRef(league, 'logo');
    const startYear = int(league.season);
    if (competition === null || startYear === null || !Array.isArray(league.standings)) continue;
    for (const groupRows of league.standings) {
      if (!Array.isArray(groupRows)) continue;
      const rows = groupRows.map(standingRow).filter((row) => row !== null);
      if (rows.length === 0) continue;
      const label = str(rec(groupRows[0]).group);
      const updates = groupRows
        .map((row) => str(rec(row).update))
        .filter((u) => u !== null)
        .sort();
      out.push({
        competition,
        seasonLabel: seasonLabel(startYear),
        stage: stageOfLabel(label),
        group: groupOfLabel(label),
        conference: conferenceOfLabel(label),
        rows,
        lastUpdatedAt: updates.at(-1) ?? receivedAt,
      });
    }
  }
  return out;
}
