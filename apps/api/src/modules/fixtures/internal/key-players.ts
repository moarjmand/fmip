import {
  KEY_PLAYERS_PER_SIDE,
  type Covered,
  type KeyPlayer,
  type KeyPlayerAvailability,
  type KeyPlayersSide,
  type MatchAbsence,
} from '@fmip/contracts';

/**
 * The key-players rule (T-841), pure so it is one tested function: the
 * players with the most minutes for the team in this competition's season
 * before the match; a tie on minutes goes to more goals plus assists, then
 * the name, then the id. A player with no minutes is never picked.
 */

/** One player's season so far for one team, summed from the per-match figures. */
export type SeasonFigures = Omit<KeyPlayer, 'availability'>;

export function pickKeyPlayers(
  players: readonly SeasonFigures[],
  count = KEY_PLAYERS_PER_SIDE,
): SeasonFigures[] {
  return players
    .filter((p) => p.minutes > 0)
    .sort(
      (a, b) =>
        b.minutes - a.minutes ||
        b.goals + b.assists - (a.goals + a.assists) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, count);
}

/**
 * What the provider said about one player for this match (T-103). Null when
 * it was never asked: nothing is claimed. Asked and not on its list is
 * `not_listed`, which is what it said -- not a promise that he plays.
 */
export function availabilityOf(
  playerId: string,
  absences: readonly MatchAbsence[],
  askedAt: string | null,
): KeyPlayerAvailability | null {
  if (askedAt === null) return null;
  const absence = absences.find((a) => a.id === playerId);
  if (absence === undefined) return { status: 'not_listed', kind: null, reason: null };
  return { status: absence.status, kind: absence.kind, reason: absence.reason };
}

/**
 * A side's module. Before the team's first match of the season there is
 * nothing to count, and it says so with `matches_played` 0; matches played
 * with no player figures at all are `not_supplied`; some without them,
 * `limited` -- the minutes are then a floor, never the whole season.
 */
export function keyPlayersSide(
  team: KeyPlayersSide['team'],
  counts: { played: number; withFigures: number },
  players: KeyPlayer[],
  lastUpdatedAt: string | null,
): Covered<KeyPlayersSide> {
  const data: KeyPlayersSide = {
    team,
    matches_played: counts.played,
    matches_with_figures: counts.withFigures,
    players,
  };
  if (counts.played === 0) return { coverage: 'available', last_updated_at: null, data };
  if (counts.withFigures === 0 || players.length === 0) {
    return { coverage: 'not_supplied', last_updated_at: lastUpdatedAt, data: null };
  }
  return {
    coverage: counts.withFigures < counts.played ? 'limited' : 'available',
    last_updated_at: lastUpdatedAt,
    data,
  };
}
