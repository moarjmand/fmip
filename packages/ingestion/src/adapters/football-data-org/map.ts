/**
 * football-data.org (v4) → the normalised model. Pure functions over
 * `unknown`; anything the provider did not supply becomes `null` (rule 3).
 * Field names below are football-data.org's and stay in this directory.
 *
 * Learned against the live free tier on 2026-09-10 and kept as rules here:
 *   - `form` is newest first ("W,D,W,D,L" for a team whose last five, in
 *     order, were L D W D W); the contract wants oldest first, so it is
 *     reversed.
 *   - The free tier's match resource carries no goals, bookings,
 *     substitutions or lineups at all (they are paid), so a detail is the
 *     fixture with empty incident and statistic lists and a null lineup.
 */

import type {
  FixtureStatus,
  NormalisedFixture,
  NormalisedIncident,
  NormalisedLineup,
  NormalisedLineupPlayer,
  NormalisedSideLineup,
  NormalisedStanding,
  NormalisedStandingRow,
  Position,
  Side,
  StageKind,
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

// ---------------------------------------------------------------------------
// Seasons, statuses, stages
// ---------------------------------------------------------------------------

export function seasonYear(label: string): number | null {
  const match = /^(\d{4})(?:\/\d{2,4})?$/.exec(label.trim());
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function seasonLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const STATUS: Record<string, FixtureStatus> = {
  SCHEDULED: 'scheduled',
  TIMED: 'scheduled',
  IN_PLAY: 'live',
  PAUSED: 'live',
  FINISHED: 'finished',
  SUSPENDED: 'suspended',
  POSTPONED: 'postponed',
  CANCELLED: 'cancelled',
  AWARDED: 'awarded',
};

export function mapStatus(status: unknown): FixtureStatus | null {
  return typeof status === 'string' ? (STATUS[status] ?? null) : null;
}

/** "REGULAR_SEASON" → league, "GROUP_STAGE" → group, "LAST_16" → knockout … */
export function stageKindOf(stage: string): StageKind | null {
  const s = stage.toUpperCase();
  if (s === 'REGULAR_SEASON') return 'league';
  if (s.includes('GROUP')) return 'group';
  if (s.includes('PLAYOFF') || s.includes('PLAY_OFF') || s.includes('RELEGATION')) return 'playoff';
  if (s.includes('QUALIFICATION') || s.includes('PRELIMINARY')) return 'qualifying';
  if (/LAST_|ROUND_OF|QUARTER|SEMI|FINAL|KNOCKOUT|ROUND_\d/.test(s)) return 'knockout';
  return null;
}

/** "REGULAR_SEASON" → "Regular Season", "GROUP_A" → "Group A". */
export function humanise(constant: string): string {
  return constant
    .toLowerCase()
    .split('_')
    .map((word) => (word.length <= 1 ? word.toUpperCase() : word[0]?.toUpperCase() + word.slice(1)))
    .join(' ');
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

/** One element of `matches` (or the body of `/matches/{id}`). */
export function mapFixture(item: unknown, receivedAt: string): NormalisedFixture | null {
  const m = rec(item);
  const competition = ref(m.competition);
  const season = rec(m.season);
  const startDate = str(season.startDate);
  const startYear = startDate === null ? null : Number(startDate.slice(0, 4));
  const externalId = id(m.id);
  const kickoffAt = str(m.utcDate);
  const status = mapStatus(m.status);
  const home = ref(m.homeTeam);
  const away = ref(m.awayTeam);

  if (
    competition === null ||
    startYear === null ||
    !Number.isInteger(startYear) ||
    externalId === null ||
    kickoffAt === null ||
    status === null ||
    home === null ||
    away === null
  ) {
    return null;
  }

  const stage = str(m.stage);
  const stageKind = stage === null ? null : stageKindOf(stage);
  const matchday = int(m.matchday);
  const referees = Array.isArray(m.referees) ? m.referees : [];
  const referee = referees.map(rec).find((r) => r.type === 'REFEREE' || r.type === undefined);
  const refereeName = referee === undefined ? null : str(referee.name);
  const venue = str(m.venue);
  const minute = int(m.minute);
  const sc = rec(m.score);
  const fullTime = score(sc.fullTime);
  const regularTime = score(sc.regularTime);
  const duration = str(sc.duration);

  return {
    externalId,
    competition,
    season: { label: seasonLabel(startYear), startYear },
    stage: stage !== null && stageKind !== null ? { name: humanise(stage), kind: stageKind } : null,
    round: matchday === null ? null : `Matchday ${matchday}`,
    kickoffAt,
    status,
    minute: status === 'live' && minute !== null && minute >= 0 ? minute : null,
    home,
    away,
    venue: venue === null ? null : { externalId: null, name: venue, city: null },
    referee:
      refereeName === null
        ? null
        : { externalId: referee === undefined ? null : id(referee.id), name: refereeName },
    scores: {
      // `fullTime` is filled progressively during play and holds the final
      // (including extra time and penalties) afterwards.
      current: fullTime,
      halfTime: score(sc.halfTime),
      // Ninety-minute score: `regularTime` when the match went further,
      // otherwise `fullTime`; unknown when the match went further and the
      // provider did not split it.
      fullTime:
        status === 'finished' || status === 'awarded'
          ? (regularTime ?? (duration === null || duration === 'REGULAR' ? fullTime : null))
          : null,
      extraTime: score(sc.extraTime),
      penalties: score(sc.penalties),
      aggregate: null,
    },
    lastUpdatedAt: str(m.lastUpdated) ?? receivedAt,
  };
}

// ---------------------------------------------------------------------------
// Incidents (paid tier; mapped for when the plan carries them)
// ---------------------------------------------------------------------------

export function mapIncidents(match: unknown, homeTeamId: string): NormalisedIncident[] {
  const m = rec(match);
  const fixtureExternalId = id(m.id);
  if (fixtureExternalId === null) return [];
  type Raw = Omit<NormalisedIncident, 'sequence' | 'fixtureExternalId'>;
  const raws: Raw[] = [];
  const sideOf = (team: unknown): Side | null => {
    const teamId = id(rec(team).id);
    return teamId === null ? null : teamId === homeTeamId ? 'home' : 'away';
  };
  const added = (value: unknown): number | null => {
    const n = int(value);
    return n !== null && n > 0 ? n : null;
  };

  for (const raw of Array.isArray(m.goals) ? m.goals : []) {
    const g = rec(raw);
    const minute = int(g.minute);
    const player = ref(g.scorer);
    if (minute === null || player === null) continue;
    const type = str(g.type) ?? 'REGULAR';
    raws.push({
      minute,
      addedTime: added(g.injuryTime),
      kind: type === 'OWN' ? 'own_goal' : type === 'PENALTY' ? 'penalty_goal' : 'goal',
      side: sideOf(g.team),
      player,
      relatedPlayer: ref(g.assist),
      detail: null,
    });
  }
  for (const raw of Array.isArray(m.bookings) ? m.bookings : []) {
    const b = rec(raw);
    const minute = int(b.minute);
    const player = ref(b.player);
    const card = str(b.card);
    if (minute === null || player === null || card === null) continue;
    raws.push({
      minute,
      addedTime: added(b.injuryTime),
      kind:
        card === 'RED' ? 'red_card' : card === 'YELLOW_RED' ? 'second_yellow_card' : 'yellow_card',
      side: sideOf(b.team),
      player,
      relatedPlayer: null,
      detail: null,
    });
  }
  for (const raw of Array.isArray(m.substitutions) ? m.substitutions : []) {
    const s = rec(raw);
    const minute = int(s.minute);
    const out = ref(s.playerOut);
    const on = ref(s.playerIn);
    if (minute === null || out === null || on === null) continue;
    raws.push({
      minute,
      addedTime: added(s.injuryTime),
      kind: 'substitution',
      side: sideOf(s.team),
      player: out,
      relatedPlayer: on,
      detail: null,
    });
  }

  raws.sort((a, b) => a.minute - b.minute || (a.addedTime ?? 0) - (b.addedTime ?? 0));
  return raws.map((raw, index) => ({ fixtureExternalId, sequence: index + 1, ...raw }));
}

// ---------------------------------------------------------------------------
// Lineups (paid tier)
// ---------------------------------------------------------------------------

export function positionOf(text: unknown): Position | null {
  const p = String(text ?? '').toLowerCase();
  if (p === '') return null;
  if (p.includes('keeper')) return 'goalkeeper';
  if (p.includes('back') || p.includes('defen')) return 'defender';
  if (p.includes('midfield')) return 'midfielder';
  if (
    p.includes('offence') ||
    p.includes('forward') ||
    p.includes('wing') ||
    p.includes('striker')
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
    const number = int(p.shirtNumber);
    out.push({
      ...player,
      role,
      shirtNumber: number !== null && number >= 1 && number <= 99 ? number : null,
      position: positionOf(p.position),
      // The provider does not say who captains; nobody is marked rather than guessed.
      isCaptain: false,
    });
  }
  return out;
}

function sideLineup(team: unknown): NormalisedSideLineup | null {
  const t = rec(team);
  const seen = new Set<string>();
  const starters = players(t.lineup, 'starter', seen);
  if (starters.length === 0) return null;
  const formation = str(t.formation);
  return {
    formation: formation !== null && /^[0-9](-[0-9]){2,4}$/.test(formation) ? formation : null,
    coach: ref(t.coach),
    players: [...starters, ...players(t.bench, 'bench', seen)],
  };
}

export function mapLineup(match: unknown): NormalisedLineup | null {
  const m = rec(match);
  const fixtureExternalId = id(m.id);
  const home = sideLineup(m.homeTeam);
  const away = sideLineup(m.awayTeam);
  if (fixtureExternalId === null || home === null || away === null) return null;
  return { fixtureExternalId, home, away };
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

function standingRow(raw: unknown): NormalisedStandingRow | null {
  const r = rec(raw);
  const team = ref(r.team);
  const position = int(r.position);
  const played = int(r.playedGames);
  const won = int(r.won);
  const drawn = int(r.draw);
  const lost = int(r.lost);
  const goalsFor = int(r.goalsFor);
  const goalsAgainst = int(r.goalsAgainst);
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
  const letters =
    form === null
      ? null
      : form
          .split(',')
          .map((s) => s.trim())
          .reverse()
          .join('');
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
    form: letters !== null && /^[WDL]+$/.test(letters) ? letters : null,
  };
}

/** The `TOTAL` tables of a `/competitions/{id}/standings` body, one per group. */
export function mapStandings(body: unknown, receivedAt: string): NormalisedStanding[] {
  const b = rec(body);
  const competition = ref(b.competition);
  const startDate = str(rec(b.season).startDate);
  const startYear = startDate === null ? null : Number(startDate.slice(0, 4));
  if (competition === null || startYear === null || !Array.isArray(b.standings)) return [];
  const out: NormalisedStanding[] = [];
  for (const raw of b.standings) {
    const s = rec(raw);
    if (s.type !== 'TOTAL' || !Array.isArray(s.table)) continue;
    const rows = s.table.map(standingRow).filter((row) => row !== null);
    if (rows.length === 0) continue;
    const stage = str(s.stage);
    const group = str(s.group);
    out.push({
      competition,
      seasonLabel: seasonLabel(startYear),
      stage: stage === null ? null : humanise(stage),
      group: group === null ? null : humanise(group),
      rows,
      // The standings body carries no update time; the fetch time is the truth.
      lastUpdatedAt: receivedAt,
    });
  }
  return out;
}
