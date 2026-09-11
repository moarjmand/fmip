import type { SquadPlayer, SquadPosition, TableContext, TeamFixture } from '@fmip/contracts';

/**
 * The team page's pure helpers (T-036): the squad grouped by position, how
 * the table context reads, and which side the team was on in a match.
 */

export const POSITION_ORDER: readonly (SquadPosition | 'unknown')[] = [
  'goalkeeper',
  'defender',
  'midfielder',
  'forward',
  'unknown',
];

export const POSITION_LABEL: Record<SquadPosition | 'unknown', string> = {
  goalkeeper: 'Goalkeepers',
  defender: 'Defenders',
  midfielder: 'Midfielders',
  forward: 'Forwards',
  unknown: 'Position not recorded',
};

export interface SquadGroup {
  position: SquadPosition | 'unknown';
  label: string;
  players: SquadPlayer[];
}

/** Groups in position order, shirt numbers ascending inside, empty groups left out. */
export function groupSquad(players: readonly SquadPlayer[]): SquadGroup[] {
  return POSITION_ORDER.map((position) => ({
    position,
    label: POSITION_LABEL[position],
    players: players
      .filter((p) => (p.position ?? 'unknown') === position)
      .sort(
        (a, b) =>
          (a.shirt_number ?? 100) - (b.shirt_number ?? 100) ||
          a.person.name.localeCompare(b.person.name),
      ),
  })).filter((g) => g.players.length > 0);
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "3rd of 20 · 45 pts". */
export function contextLine(context: TableContext): string {
  return `${ordinal(context.position)} of ${context.total} · ${context.points} pts`;
}

/** The match from the team's side: the opponent, home or away, and the result letter once played. */
export function fromTeamSide(
  fixture: TeamFixture,
  teamId: string,
): { opponent: string; home: boolean; result: 'W' | 'D' | 'L' | null } {
  const home = fixture.home.id === teamId;
  const opponent = home ? fixture.away : fixture.home;
  let result: 'W' | 'D' | 'L' | null = null;
  if (fixture.status === 'finished' && fixture.score !== null) {
    const mine = home ? fixture.score.home : fixture.score.away;
    const theirs = home ? fixture.score.away : fixture.score.home;
    result = mine > theirs ? 'W' : mine === theirs ? 'D' : 'L';
  }
  return { opponent: opponent.short_name ?? opponent.name, home, result };
}
