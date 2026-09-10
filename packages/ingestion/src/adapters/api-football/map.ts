/**
 * API-Football (api-sports.io, v3) → the normalised model. Pure functions over
 * `unknown`: the provider's payload is data we were sent, not a type we trust,
 * so every field is read through a narrowing helper and anything the provider
 * did not supply becomes `null` (rule 3), never a default.
 *
 * Field names below are API-Football's. None of them leave this directory.
 */

import type {
  FixtureStatus,
  IncidentKind,
  NormalisedFixture,
  NormalisedIncident,
  NormalisedLineup,
  NormalisedLineupPlayer,
  NormalisedPeriod,
  NormalisedSideLineup,
  NormalisedStanding,
  NormalisedStandingRow,
  NormalisedStat,
  Position,
  Side,
  StageKind,
  StatMetric,
} from '../../normalised';

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
  return n === null ? null : String(n);
};

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

/** "Regular Season - 3" → stage kind from the words, round as given. */
export function stageKindOf(round: string): StageKind | null {
  const r = round.toLowerCase();
  if (r.includes('regular season')) return 'league';
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

  const round = str(league.round);
  const stageKind = round === null ? null : stageKindOf(round);
  const venue = rec(fixture.venue);
  const venueName = str(venue.name);
  const referee = str(fixture.referee);
  const elapsed = int(statusRec.elapsed);
  const goals = score(it.goals);

  return {
    externalId,
    competition: { externalId: leagueId, name: leagueName },
    season: { label: seasonLabel(startYear), startYear },
    stage:
      round !== null && stageKind !== null
        ? { name: round.split(' - ')[0]?.trim() || round, kind: stageKind }
        : null,
    round,
    kickoffAt,
    status,
    minute: status === 'live' && elapsed !== null && elapsed >= 0 ? elapsed : null,
    home: { externalId: homeId, name: homeName },
    away: { externalId: awayId, name: awayName },
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
    const extra = int(time.extra);
    out.push({
      fixtureExternalId,
      sequence: out.length + 1,
      minute,
      addedTime: extra !== null && extra > 0 ? extra : null,
      kind,
      side,
      player,
      // For a substitution API-Football's `assist` is the player coming on.
      relatedPlayer: related,
      detail: str(e.detail) ?? str(e.comments),
    });
  }
  return out;
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

function lineupPlayers(
  list: unknown,
  role: 'starter' | 'bench',
  captains: ReadonlySet<string>,
  seen: Set<string>,
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
      externalId,
      name,
      role,
      shirtNumber: number !== null && number >= 1 && number <= 99 ? number : null,
      position: pos,
      isCaptain: captains.has(externalId),
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

function sideLineup(block: unknown, captain: string | null): NormalisedSideLineup {
  const b = rec(block);
  const formation = str(b.formation);
  const captains = new Set(captain === null ? [] : [captain]);
  const seen = new Set<string>();
  return {
    formation: formation !== null && /^[0-9](-[0-9]){2,4}$/.test(formation) ? formation : null,
    coach: ref(b.coach),
    players: [
      ...lineupPlayers(b.startXI, 'starter', captains, seen),
      ...lineupPlayers(b.substitutes, 'bench', captains, seen),
    ],
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
  const result: NormalisedLineup = {
    fixtureExternalId,
    home: sideLineup(home, captains.get(homeTeamId) ?? null),
    away: sideLineup(away, captains.get(awayTeamId) ?? null),
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
  const team = ref(r.team);
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
 * One `NormalisedStanding` per group; `group` is null when the provider's
 * group name is just the league name (a plain league table).
 */
export function mapStandings(response: unknown, receivedAt: string): NormalisedStanding[] {
  if (!Array.isArray(response)) return [];
  const out: NormalisedStanding[] = [];
  for (const entry of response) {
    const league = rec(rec(entry).league);
    const competition = ref(league);
    const startYear = int(league.season);
    if (competition === null || startYear === null || !Array.isArray(league.standings)) continue;
    for (const groupRows of league.standings) {
      if (!Array.isArray(groupRows)) continue;
      const rows = groupRows.map(standingRow).filter((row) => row !== null);
      if (rows.length === 0) continue;
      const groupName = str(rec(groupRows[0]).group);
      const updates = groupRows
        .map((row) => str(rec(row).update))
        .filter((u) => u !== null)
        .sort();
      out.push({
        competition,
        seasonLabel: seasonLabel(startYear),
        stage: null,
        group: groupName !== null && groupName !== competition.name ? groupName : null,
        rows,
        lastUpdatedAt: updates.at(-1) ?? receivedAt,
      });
    }
  }
  return out;
}
