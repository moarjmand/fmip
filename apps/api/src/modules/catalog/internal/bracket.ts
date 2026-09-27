import {
  KNOCKOUT_ROUNDS,
  type KnockoutBracket,
  type KnockoutLeg,
  type KnockoutRound,
  type KnockoutRoundKey,
  type KnockoutTeam,
  type KnockoutTie,
} from '@fmip/contracts';

/**
 * The knockout bracket of a continental cup (blueprint 5.1, T-630), built
 * from the season's stored fixtures and nothing else. Pure, so the pairing
 * and the deciding rules are one tested function.
 */

/** One stored fixture of the season, as the bracket reads it. */
export interface BracketFixture {
  id: string;
  kickoff_at: string;
  status: string;
  /** The competition's own words for the round ("Round of 16"), else null. */
  round: string | null;
  stage: { name: string; kind: string } | null;
  /** 1 or 2 when our records say which leg; usually null. */
  leg: number | null;
  home: KnockoutTeam;
  away: KnockoutTeam;
  /** The latest score (after extra time when one was played), else the full-time one. */
  score: { home: number; away: number } | null;
  after_extra_time: boolean;
  penalties: { home: number; away: number } | null;
}

/** Ties each round has in the format, and matches per tie. */
const FORMAT: Record<KnockoutRoundKey, { ties: number; legs: 1 | 2 }> = {
  round_of_32: { ties: 16, legs: 2 },
  knockout_playoff: { ties: 8, legs: 2 },
  round_of_16: { ties: 8, legs: 2 },
  quarter_final: { ties: 4, legs: 2 },
  semi_final: { ties: 2, legs: 2 },
  final: { ties: 1, legs: 1 },
};

/**
 * Rounds only some formats play: the Europa League's old round of 32 and the
 * knockout play-offs that arrived with the league stage. Shown when our
 * records hold them; an empty one is only "not drawn yet" in a running season
 * where no later round exists (the format played since 2024/25).
 */
const OPTIONAL: ReadonlySet<KnockoutRoundKey> = new Set(['round_of_32', 'knockout_playoff']);

const FINISHED = new Set(['finished', 'awarded']);

/**
 * The knockout round a fixture belongs to, from the words our records hold.
 * A play-off that is not a qualifying one counts as the knockout play-offs
 * only when it is named so, or when it kicks off after the league stage
 * began: the qualifying play-offs in August carry the same word.
 */
export function roundKeyOf(
  label: string | null,
  kickoffAt: string,
  leagueStageStart: string | null,
): KnockoutRoundKey | null {
  if (label === null) return null;
  const r = (label.split(' - ')[0] ?? label).trim().toLowerCase();
  if (/qualif|preliminary|league (stage|phase)|group|regular season/.test(r)) return null;
  const playoff = /play-?offs?/.test(r);
  if (playoff && r.includes('knockout')) return 'knockout_playoff';
  if (playoff) {
    return leagueStageStart !== null && kickoffAt > leagueStageStart ? 'knockout_playoff' : null;
  }
  if (/round of 32|1\/16/.test(r)) return 'round_of_32';
  if (/round of 16|1\/8|eighth/.test(r)) return 'round_of_16';
  if (/quarter|1\/4/.test(r)) return 'quarter_final';
  if (/semi|1\/2/.test(r)) return 'semi_final';
  if (/^(the )?final$/.test(r)) return 'final';
  return null;
}

function isLeagueStage(f: BracketFixture): boolean {
  if (f.stage?.kind === 'league' || f.stage?.kind === 'group') return true;
  const label = (f.round ?? f.stage?.name ?? '').toLowerCase();
  return /^league (stage|phase)|^group/.test(label);
}

function goalsFor(leg: KnockoutLeg, teamId: string): number {
  // Called only for legs with a score.
  return leg.home.id === teamId ? leg.score!.home : leg.score!.away;
}

function decide(
  teams: [KnockoutTeam, KnockoutTeam],
  legs: KnockoutLeg[],
  expectedLegs: 1 | 2,
): Pick<KnockoutTie, 'aggregate' | 'winner' | 'decided_by'> {
  const undecided = { aggregate: null, winner: null, decided_by: null };
  if (legs.length !== expectedLegs) return undecided;
  if (!legs.every((l) => FINISHED.has(l.status) && l.score !== null)) return undecided;
  const [a, b] = teams;
  const totalA = legs.reduce((sum, l) => sum + goalsFor(l, a.id), 0);
  const totalB = legs.reduce((sum, l) => sum + goalsFor(l, b.id), 0);
  const aggregate: [number, number] | null = expectedLegs === 2 ? [totalA, totalB] : null;
  if (totalA !== totalB) {
    return {
      aggregate,
      winner: totalA > totalB ? a : b,
      decided_by: expectedLegs === 2 ? 'aggregate' : 'score',
    };
  }
  const last = legs[legs.length - 1]!;
  const pens = last.penalties;
  if (pens !== null && pens.home !== pens.away) {
    const homeWon = pens.home > pens.away;
    return { aggregate, winner: homeWon ? last.home : last.away, decided_by: 'penalties' };
  }
  // Level with no shoot-out in our records (or an away-goals era we do not
  // judge): the tie is stated as undecided rather than guessed.
  return { aggregate, winner: null, decided_by: null };
}

function tiesOf(fixtures: BracketFixture[], expectedLegs: 1 | 2): KnockoutTie[] {
  const byPair = new Map<string, BracketFixture[]>();
  for (const f of fixtures) {
    const key = [f.home.id, f.away.id].sort().join(':');
    const list = byPair.get(key);
    if (list === undefined) byPair.set(key, [f]);
    else list.push(f);
  }
  const ties: KnockoutTie[] = [];
  for (const group of byPair.values()) {
    group.sort((x, y) =>
      x.kickoff_at === y.kickoff_at
        ? x.id.localeCompare(y.id)
        : x.kickoff_at < y.kickoff_at
          ? -1
          : 1,
    );
    const legs: KnockoutLeg[] = group.map((f, index) => ({
      fixture_id: f.id,
      leg: f.leg ?? index + 1,
      kickoff_at: f.kickoff_at,
      status: f.status,
      home: f.home,
      away: f.away,
      score: f.score,
      after_extra_time: f.after_extra_time,
      penalties: f.penalties,
    }));
    const first = legs[0]!;
    const teams: [KnockoutTeam, KnockoutTeam] = [first.home, first.away];
    ties.push({ teams, legs, ...decide(teams, legs, expectedLegs) });
  }
  ties.sort((x, y) => {
    const a = x.legs[0]!;
    const b = y.legs[0]!;
    return a.kickoff_at === b.kickoff_at
      ? a.fixture_id.localeCompare(b.fixture_id)
      : a.kickoff_at < b.kickoff_at
        ? -1
        : 1;
  });
  return ties;
}

/**
 * The bracket. `open` is whether the season is still running: an empty round
 * of a running season is "not drawn yet"; of a finished one, or before a
 * round that does exist, it is a round our records do not hold.
 */
export function buildBracket(fixtures: readonly BracketFixture[], open: boolean): KnockoutBracket {
  let leagueStageStart: string | null = null;
  for (const f of fixtures) {
    if (isLeagueStage(f) && (leagueStageStart === null || f.kickoff_at < leagueStageStart)) {
      leagueStageStart = f.kickoff_at;
    }
  }

  const byRound = new Map<KnockoutRoundKey, BracketFixture[]>();
  for (const f of fixtures) {
    const key = roundKeyOf(f.round ?? f.stage?.name ?? null, f.kickoff_at, leagueStageStart);
    if (key === null) continue;
    const list = byRound.get(key);
    if (list === undefined) byRound.set(key, [f]);
    else list.push(f);
  }

  const lastHeld = KNOCKOUT_ROUNDS.reduce(
    (last, key, index) => (byRound.has(key) ? index : last),
    -1,
  );

  const rounds: KnockoutRound[] = [];
  KNOCKOUT_ROUNDS.forEach((key, index) => {
    const format = FORMAT[key];
    const held = byRound.get(key);
    if (held !== undefined) {
      rounds.push({
        key,
        state: 'drawn',
        legs: format.legs,
        expected_ties: format.ties,
        ties: tiesOf(held, format.legs),
      });
      return;
    }
    const later = index < lastHeld;
    if (OPTIONAL.has(key)) {
      // Only the current format's play-offs are awaited; an optional round
      // before one that exists was simply not played that season.
      if (key !== 'knockout_playoff' || later || !open) return;
    }
    rounds.push({
      key,
      state: open && !later ? 'not_drawn' : 'not_supplied',
      legs: format.legs,
      expected_ties: format.ties,
      ties: [],
    });
  });
  return { rounds };
}
