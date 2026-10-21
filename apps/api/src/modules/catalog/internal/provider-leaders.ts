import type { Covered, PlayerSeasonMinutes } from '@fmip/contracts';
import { Pool } from 'pg';
import { covered } from '../../fixtures/fixtures.service';
import type { BoardRow, Scorer } from '../../standings/standings.service';
import { seasonMinutes } from './player-store';

/** The only provider whose season totals we keep (T-1431). */
const SOURCE = 'api_football';

/** One line of `player_season_stat`: a player's totals for a team in a competition's season. */
export interface ProviderLeaderLine {
  personId: string;
  personName: string;
  teamId: string;
  teamName: string;
  appearances: number;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  /** Straight reds and second yellows together, as the player page counts a red; null if neither was supplied. */
  redCards: number | null;
  fetchedAt: string;
}

/** The year a season label starts in: "2025/26" and "2025" are both 2025. */
export function seasonYearOf(label: string): number | null {
  const match = /^\d{4}/.exec(label);
  return match === null ? null : Number(match[0]);
}

/**
 * The provider's own totals for one competition's season (T-1441, D-232): the
 * lines `player_season_stat` holds for the competition and the season year its
 * label starts in. Read only for a season of which we store no incident.
 */
export async function readProviderLeaders(
  pool: Pool,
  competitionId: string,
  seasonLabel: string,
): Promise<ProviderLeaderLine[]> {
  const year = seasonYearOf(seasonLabel);
  if (year === null) return [];
  const { rows } = await pool.query<{
    person_id: string;
    person_name: string;
    team_id: string;
    team_name: string;
    appearances: number;
    minutes: number | null;
    goals: number | null;
    assists: number | null;
    yellow_cards: number | null;
    second_yellow_cards: number | null;
    red_cards: number | null;
    fetched_at: Date;
  }>(
    `SELECT s.person_id, COALESCE(pe.known_as, pe.full_name) AS person_name,
            s.team_id, t.name AS team_name, s.appearances, s.minutes, s.goals, s.assists,
            s.yellow_cards, s.second_yellow_cards, s.red_cards, s.fetched_at
       FROM player_season_stat s
       JOIN person pe ON pe.id = s.person_id
       JOIN team t ON t.id = s.team_id
      WHERE s.source = $1 AND s.competition_id = $2 AND s.season_year = $3`,
    [SOURCE, competitionId, year],
  );
  return rows.map((r) => ({
    personId: r.person_id,
    personName: r.person_name,
    teamId: r.team_id,
    teamName: r.team_name,
    appearances: r.appearances,
    minutes: r.minutes,
    goals: r.goals,
    assists: r.assists,
    yellowCards: r.yellow_cards,
    redCards:
      r.red_cards === null && r.second_yellow_cards === null
        ? null
        : (r.red_cards ?? 0) + (r.second_yellow_cards ?? 0),
    fetchedAt: r.fetched_at.toISOString(),
  }));
}

/** The boards the provider's totals can fill: no clean sheets, which the provider does not count. */
export interface ProviderBoards {
  scorers: Covered<Scorer[]>;
  assists: Covered<BoardRow<{ assists: number }>[]>;
  cards: Covered<BoardRow<{ yellow_cards: number; red_cards: number }>[]>;
  /** Per player, over every team: the provider's appearances and minutes in `PlayerSeasonMinutes`' terms. */
  minutes: Map<string, PlayerSeasonMinutes>;
}

/**
 * The provider's lines as the three boards (T-1441). A figure the provider
 * left out is absent from that board, never a zero; a player is listed in a
 * board only with a figure above nought. Every module is `limited` when it
 * has rows, since only the players the provider has been asked about appear
 * (never `available`), and `not_supplied` when it has none. `fetchedAt` is
 * the module's `last_updated_at`.
 */
export function providerBoards(lines: readonly ProviderLeaderLine[]): ProviderBoards {
  const person = (l: ProviderLeaderLine) => ({ id: l.personId, name: l.personName });
  const team = (l: ProviderLeaderLine) => ({ id: l.teamId, name: l.teamName });
  const latest = (picked: readonly ProviderLeaderLine[]): string | null =>
    picked.reduce<string | null>(
      (last, l) => (last === null || l.fetchedAt > last ? l.fetchedAt : last),
      null,
    );
  const module = <T>(picked: readonly ProviderLeaderLine[], rows: T[]): Covered<T[]> =>
    covered(rows, rows.length === 0, 'limited', latest(picked));

  const scoring = lines.filter((l) => (l.goals ?? 0) > 0);
  const assisting = lines.filter((l) => (l.assists ?? 0) > 0);
  const booked = lines.filter((l) => (l.yellowCards ?? 0) > 0 || (l.redCards ?? 0) > 0);

  const totals = new Map<string, { matches: number; withMinutes: number; minutes: number }>();
  for (const l of lines) {
    const t = totals.get(l.personId) ?? { matches: 0, withMinutes: 0, minutes: 0 };
    t.matches += l.appearances;
    if (l.minutes !== null) {
      t.withMinutes += l.appearances;
      t.minutes += l.minutes;
    }
    totals.set(l.personId, t);
  }

  return {
    scorers: module(
      scoring,
      scoring.map((l) => ({ person: person(l), team: team(l), goals: l.goals! })),
    ),
    assists: module(
      assisting,
      assisting.map((l) => ({ person: person(l), team: team(l), assists: l.assists! })),
    ),
    cards: module(
      booked,
      booked.map((l) => ({
        person: person(l),
        team: team(l),
        yellow_cards: l.yellowCards ?? 0,
        red_cards: l.redCards ?? 0,
      })),
    ),
    minutes: new Map(
      [...totals].map(([id, t]) => [id, seasonMinutes(t.matches, t.withMinutes, t.minutes)]),
    ),
  };
}
