/**
 * Highlightly (sports.highlightly.net/football) → the normalised model. Pure
 * functions over `unknown`; anything not supplied becomes `null` (rule 3).
 * Field names below are Highlightly's and stay in this directory.
 *
 * Learned against the live BASIC plan on 2026-09-10:
 *   - a match's state is a free-text `state.description` ("Not started",
 *     "First half", "Half time", "Second half", "Finished", "Postponed",
 *     "Abandoned", …) with a `clock`; the score is a string "0 - 3";
 *   - `/matches/{id}` answers an array with one element that already carries
 *     `events` and `statistics`; an unknown id answers an empty array, 200;
 *   - events name players by `playerId`/`player`, and for a substitution
 *     `player` is the one going off and `substituted`/`assistingPlayerId` the
 *     one coming on; `time` is "90+4" for added time;
 *   - `/lineups/{id}` for a 2023 match had empty `initialLineup` arrays and
 *     formation "Unknown": no lineup is `unsupported`, not an empty one;
 *   - standings carry no form and no half-time scores exist anywhere.
 */

import type {
  FixtureStatus,
  IncidentKind,
  NormalisedFixture,
  NormalisedIncident,
  NormalisedLineup,
  NormalisedLineupPlayer,
  NormalisedSideLineup,
  NormalisedStanding,
  NormalisedStandingRow,
  NormalisedStat,
  Position,
  Side,
  StageKind,
  StatMetric,
} from '../../normalised';

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const rec = (value: unknown): Json => (isRecord(value) ? value : {});
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;
const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
const id = (value: unknown): string | null => {
  const n = int(value);
  return n === null ? null : String(n);
};

function ref(value: unknown): { externalId: string; name: string } | null {
  const r = rec(value);
  const externalId = id(r.id);
  const name = str(r.name);
  return externalId === null || name === null ? null : { externalId, name };
}

export function seasonYear(label: string): number | null {
  const match = /^(\d{4})(?:\/\d{2,4})?$/.exec(label.trim());
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function seasonLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// State, score, round
// ---------------------------------------------------------------------------

/** `state.description`, matched by keyword; anything unrecognised is dropped. */
export function mapStatus(description: unknown): FixtureStatus | null {
  const d = String(description ?? '').toLowerCase();
  if (d === '') return null;
  if (d.includes('not started') || d.includes('scheduled') || d === 'tbd') return 'scheduled';
  if (d.includes('postpon')) return 'postponed';
  if (d.includes('abandon')) return 'abandoned';
  if (d.includes('cancel')) return 'cancelled';
  if (d.includes('suspend') || d.includes('interrupt')) return 'suspended';
  if (d.includes('award') || d.includes('walkover')) return 'awarded';
  if (d.startsWith('after') || d.includes('finished') || d.includes('full time') || d === 'ended') {
    return 'finished';
  }
  if (
    d.includes('half') ||
    d.includes('extra time') ||
    d.includes('penalt') ||
    d.includes('break') ||
    d.includes('live') ||
    d.includes('in play')
  ) {
    return 'live';
  }
  return null;
}

/** "0 - 3" → { home: 0, away: 3 }. */
export function parseScore(value: unknown): { home: number; away: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

/** "90+4" → { minute: 90, added: 4 }; "61" → { minute: 61, added: null }. */
export function parseTime(value: unknown): { minute: number; added: number | null } | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  const match = /^\s*(\d+)(?:\s*\+\s*(\d+))?\s*'?\s*$/.exec(text);
  if (match?.[1] === undefined) return null;
  const added = match[2] === undefined ? null : Number(match[2]);
  return { minute: Number(match[1]), added: added !== null && added > 0 ? added : null };
}

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

/** One element of `data` from `/matches`, or the element of `/matches/{id}`. */
export function mapFixture(item: unknown, receivedAt: string): NormalisedFixture | null {
  const m = rec(item);
  const league = rec(m.league);
  const state = rec(m.state);
  const externalId = id(m.id);
  const competition = ref(league);
  const startYear = int(league.season);
  const kickoffAt = str(m.date);
  const status = mapStatus(state.description);
  const home = ref(m.homeTeam);
  const away = ref(m.awayTeam);
  if (
    externalId === null ||
    competition === null ||
    startYear === null ||
    kickoffAt === null ||
    status === null ||
    home === null ||
    away === null
  ) {
    return null;
  }

  const round = str(m.round);
  const stageKind = round === null ? null : stageKindOf(round);
  const scoreRec = rec(state.score);
  const current = parseScore(scoreRec.current);
  const penalties = parseScore(scoreRec.penalties);
  const clock = int(state.clock);
  const venue = rec(m.venue);
  const venueName = str(venue.name) ?? str(m.venue);
  const referee = str(rec(m.referee).name) ?? str(m.referee);

  return {
    externalId,
    competition,
    season: { label: seasonLabel(startYear), startYear },
    stage:
      round !== null && stageKind !== null
        ? { name: round.split(' - ')[0]?.trim() || round, kind: stageKind }
        : null,
    round,
    kickoffAt,
    status,
    minute: status === 'live' && clock !== null && clock >= 0 ? clock : null,
    home,
    away,
    venue:
      venueName === null
        ? null
        : { externalId: id(venue.id), name: venueName, city: str(venue.city) },
    referee: referee === null ? null : { externalId: null, name: referee },
    scores: {
      current,
      // Highlightly gives no half-time score and does not split extra time out.
      halfTime: null,
      fullTime: status === 'finished' || status === 'awarded' ? current : null,
      extraTime: null,
      penalties,
      aggregate: null,
    },
    // No update timestamp on the resource: the fetch time is the freshness.
    lastUpdatedAt: receivedAt,
  };
}

// ---------------------------------------------------------------------------
// Events → incidents
// ---------------------------------------------------------------------------

function incidentKind(type: unknown): IncidentKind | null {
  const t = String(type ?? '').toLowerCase();
  if (t === '') return null;
  if (t.includes('own goal')) return 'own_goal';
  if (t.includes('missed pen')) return 'penalty_missed';
  if (t.includes('penalty') && t.includes('goal')) return 'penalty_goal';
  if (t === 'penalty') return 'penalty_goal';
  if (t.includes('goal')) return 'goal';
  if (t.includes('second yellow') || t.includes('yellow red')) return 'second_yellow_card';
  if (t.includes('yellow')) return 'yellow_card';
  if (t.includes('red')) return 'red_card';
  if (t.includes('subst')) return 'substitution';
  if (t.includes('var')) return 'var';
  return null;
}

export function mapIncidents(
  events: unknown,
  fixtureExternalId: string,
  homeTeamId: string,
): NormalisedIncident[] {
  if (!Array.isArray(events)) return [];
  const out: NormalisedIncident[] = [];
  for (const raw of events) {
    const e = rec(raw);
    const time = parseTime(e.time);
    const kind = incidentKind(e.type);
    if (time === null || kind === null) continue;
    const teamId = id(rec(e.team).id);
    const side: Side | null = teamId === null ? null : teamId === homeTeamId ? 'home' : 'away';
    const playerId = id(e.playerId);
    const playerName = str(e.player);
    const player =
      playerId === null || playerName === null ? null : { externalId: playerId, name: playerName };
    const relatedId = id(e.assistingPlayerId);
    const relatedName = kind === 'substitution' ? str(e.substituted) : str(e.assist);
    const relatedPlayer =
      relatedId === null || relatedName === null
        ? null
        : { externalId: relatedId, name: relatedName };
    if (kind !== 'var' && player === null) continue;
    if (kind === 'substitution' && relatedPlayer === null) continue;
    out.push({
      fixtureExternalId,
      sequence: out.length + 1,
      minute: time.minute,
      addedTime: time.added,
      kind,
      side,
      player,
      relatedPlayer,
      detail: str(e.type),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lineups
// ---------------------------------------------------------------------------

export function positionOf(text: unknown): Position | null {
  const p = String(text ?? '').toLowerCase();
  if (p === '') return null;
  if (p === 'g' || p.includes('keeper')) return 'goalkeeper';
  if (p === 'd' || p.includes('defen') || p.includes('back')) return 'defender';
  if (p === 'm' || p.includes('midfield')) return 'midfielder';
  if (
    p === 'f' ||
    p.includes('forward') ||
    p.includes('attack') ||
    p.includes('striker') ||
    p.includes('wing')
  ) {
    return 'forward';
  }
  return null;
}

function players(
  list: unknown,
  role: 'starter' | 'bench',
  seen: Set<string>,
): NormalisedLineupPlayer[] {
  if (!Array.isArray(list)) return [];
  const out: NormalisedLineupPlayer[] = [];
  for (const raw of list) {
    const p = rec(raw);
    const player = ref(p);
    if (player === null || seen.has(player.externalId)) continue;
    seen.add(player.externalId);
    const number = int(p.number) ?? int(p.shirtNumber);
    out.push({
      ...player,
      role,
      shirtNumber: number !== null && number >= 1 && number <= 99 ? number : null,
      position: positionOf(p.position),
      isCaptain: p.captain === true,
    });
  }
  return out;
}

function sideLineup(block: unknown): NormalisedSideLineup | null {
  const b = rec(block);
  const seen = new Set<string>();
  const starters = players(b.initialLineup, 'starter', seen);
  if (starters.length === 0) return null;
  const formation = str(b.formation);
  return {
    formation: formation !== null && /^[0-9](-[0-9]){2,4}$/.test(formation) ? formation : null,
    coach: ref(b.coach),
    players: [...starters, ...players(b.substitutes, 'bench', seen)],
  };
}

/** `/lineups/{id}`: home and away blocks. Null when either side has no starters. */
export function mapLineup(body: unknown, fixtureExternalId: string): NormalisedLineup | null {
  const b = rec(body);
  const home = sideLineup(b.homeTeam);
  const away = sideLineup(b.awayTeam);
  if (home === null || away === null) return null;
  return { fixtureExternalId, home, away };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

const STAT: Record<string, StatMetric> = {
  possession: 'possession_pct',
  'total shots': 'shots',
  shots: 'shots',
  'shots on target': 'shots_on_target',
  'shots off target': 'shots_off_target',
  'blocked shots': 'blocked_shots',
  corners: 'corners',
  offsides: 'offsides',
  fouls: 'fouls',
  'yellow cards': 'yellow_cards',
  'red cards': 'red_cards',
  'total passes': 'passes',
  'successful passes': 'passes_accurate',
  'pass accuracy': 'pass_accuracy_pct',
  'goalkeeper saves': 'saves',
  saves: 'saves',
  'expected goals': 'expected_goals',
  xg: 'expected_goals',
};

/** `statistics` blocks (one per team, `displayName`/`value`). Fractions become percentages. */
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
      const metric = STAT[String(s.displayName ?? '').toLowerCase()];
      let value = typeof s.value === 'number' && Number.isFinite(s.value) ? s.value : null;
      if (metric === undefined || value === null || value < 0) continue;
      if (metric.endsWith('_pct')) {
        if (value <= 1) value = Math.round(value * 100);
        if (value > 100) continue;
      }
      const key = `${side}:${metric}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ side, metric, value });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

function standingRow(raw: unknown): NormalisedStandingRow | null {
  const r = rec(raw);
  const total = rec(r.total);
  const team = ref(r.team);
  const position = int(r.position);
  const played = int(total.games);
  const won = int(total.wins);
  const drawn = int(total.draws);
  const lost = int(total.loses);
  const goalsFor = int(total.scoredGoals);
  const goalsAgainst = int(total.receivedGoals);
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
  return { position, team, played, won, drawn, lost, goalsFor, goalsAgainst, points, form: null };
}

/** `/standings?leagueId=&season=`: `groups[].standings[]`, one standing per group. */
export function mapStandings(
  body: unknown,
  competition: { externalId: string; name: string },
  startYear: number,
  receivedAt: string,
): NormalisedStanding[] {
  const groups = rec(body).groups;
  if (!Array.isArray(groups)) return [];
  const out: NormalisedStanding[] = [];
  for (const raw of groups) {
    const g = rec(raw);
    if (!Array.isArray(g.standings)) continue;
    const rows = g.standings.map(standingRow).filter((row) => row !== null);
    if (rows.length === 0) continue;
    const name = str(g.name);
    out.push({
      competition,
      seasonLabel: seasonLabel(startYear),
      stage: null,
      group: name !== null && name !== competition.name ? name : null,
      rows,
      lastUpdatedAt: receivedAt,
    });
  }
  return out;
}
