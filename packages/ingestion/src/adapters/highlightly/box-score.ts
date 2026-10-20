/**
 * Highlightly's per-player box score (T-1432, D-224): `GET /box-score/{id}`,
 * and `GET /matches` to find that id for one of our matches. Same host,
 * headers and budget as the highlights client. Field names below are
 * Highlightly's and stay in this directory; what leaves it is
 * `NormalisedBoxScore` and `BoxScoreMatch`.
 *
 * Recorded 2026-10-20 (Serie A, Juventus-Lazio, `_fixtures/highlightly-box-score/`):
 *   - the body is an array of `{ team, players }`, one per side, with no side
 *     named -- a side is the team's id;
 *   - each player has the provider's `id`, `name`, `shirtNumber`,
 *     `minutesPlayed`, `matchRating` (a string) and `statistics`, which holds
 *     `expectedGoals`, `expectedAssists`, `expectedGoalsOnTarget`,
 *     `expectedGoalsOnTargetConceded` and `expectedGoalsPrevented` -- numbers,
 *     or `null` where the provider has none (a player who took no shot has no
 *     xG; 0 is a value, null is not);
 *   - `expectedGoalsPrevented` (xGOT conceded minus goals let in) is negative
 *     for a keeper who let in more than expected;
 *   - an unused substitute (`minutesPlayed` 0) sometimes carries another
 *     player's expected figures (the recording has two such copies). A player
 *     who did not play has no expected figures here, whatever the body says.
 *
 * Only the expected-goals family leaves this file. The provider's rating,
 * minutes and counts are not read into the contract: API-Football's own are
 * stored and shown already, and two sources' ratings are never blended or
 * set side by side as one figure (rules 3 and 6, D-224).
 */

import type { AdapterResult, Transport } from '../_contract';
import { highlightlyGet } from './highlights';
import { isRecord, mapStatus } from './map';

/** The expected-goals family, in our words. */
export const EXPECTED_METRICS = ['xg', 'xa', 'xgot', 'xgot_conceded', 'xgp'] as const;
export type ExpectedMetric = (typeof EXPECTED_METRICS)[number];

/** The provider's name for each, read here only. */
const PROVIDER_FIELD: Record<ExpectedMetric, string> = {
  xg: 'expectedGoals',
  xa: 'expectedAssists',
  xgot: 'expectedGoalsOnTarget',
  xgot_conceded: 'expectedGoalsOnTargetConceded',
  xgp: 'expectedGoalsPrevented',
};

/** Goals prevented may be negative; every other figure is an expectation of a count. */
const SIGNED: ReadonlySet<ExpectedMetric> = new Set(['xgp']);
/** What a two-decimal `numeric(6, 2)` holds, with room to spare: no match has 100 xG. */
const LIMIT = 100;

export interface BoxScoreRef {
  externalId: string;
  name: string;
}

export interface NormalisedBoxScorePlayer {
  /** The provider's id: what `provider_mapping` resolves (rule 1). */
  externalId: string;
  name: string;
  shirtNumber: number | null;
  minutes: number | null;
  /** Only the figures the provider supplied for a player who played; absent is not supplied. */
  expected: Partial<Record<ExpectedMetric, number>>;
}

export interface NormalisedBoxScoreSide {
  team: BoxScoreRef;
  players: NormalisedBoxScorePlayer[];
}

export interface NormalisedBoxScore {
  /** Empty when the provider has no box score for the match (yet). */
  sides: NormalisedBoxScoreSide[];
  /** Player entries that could not be read (no id, no name). */
  malformed: number;
}

/** One match on the provider's list, enough to place it on ours. */
export interface BoxScoreMatch {
  externalId: string;
  kickoffAt: string;
  finished: boolean;
  home: BoxScoreRef;
  away: BoxScoreRef;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
const idOf = (value: unknown): string | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? String(value)
    : typeof value === 'string' && /^\d+$/.test(value)
      ? value
      : null;
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

function ref(value: unknown): BoxScoreRef | null {
  if (!isRecord(value)) return null;
  const externalId = idOf(value.id);
  const name = str(value.name);
  return externalId === null || name === null ? null : { externalId, name };
}

/** One figure: a finite number in range, to two decimals; anything else is not supplied. */
function figure(metric: ExpectedMetric, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (Math.abs(value) >= LIMIT) return null;
  if (value < 0 && !SIGNED.has(metric)) return null;
  const rounded = Math.round(value * 100) / 100;
  // -0 and 0 are one value; keep the sign out of the store.
  return rounded === 0 ? 0 : rounded;
}

/** One player entry, or null when it names nobody we could ever resolve. */
export function mapBoxScorePlayer(item: unknown): NormalisedBoxScorePlayer | null {
  if (!isRecord(item)) return null;
  const externalId = idOf(item.id);
  const name = str(item.name) ?? str(item.fullName);
  if (externalId === null || name === null) return null;
  const minutes = count(item.minutesPlayed);
  const statistics = isRecord(item.statistics) ? item.statistics : {};
  const expected: Partial<Record<ExpectedMetric, number>> = {};
  // A player who did not play has no expected figures (see the file comment).
  if (minutes !== null && minutes > 0) {
    for (const metric of EXPECTED_METRICS) {
      const value = figure(metric, statistics[PROVIDER_FIELD[metric]]);
      if (value !== null) expected[metric] = value;
    }
  }
  return { externalId, name, shirtNumber: count(item.shirtNumber), minutes, expected };
}

/** The box-score body; null when it is not the documented array. */
export function mapBoxScore(body: unknown): NormalisedBoxScore | null {
  if (!Array.isArray(body)) return null;
  const score: NormalisedBoxScore = { sides: [], malformed: 0 };
  for (const entry of body) {
    const team = isRecord(entry) ? ref(entry.team) : null;
    if (team === null || !isRecord(entry) || !Array.isArray(entry.players)) return null;
    const players: NormalisedBoxScorePlayer[] = [];
    for (const item of entry.players) {
      const player = mapBoxScorePlayer(item);
      if (player === null) score.malformed += 1;
      else players.push(player);
    }
    score.sides.push({ team, players });
  }
  return score;
}

/** One `/matches` item, or null when it lacks what placing it needs. */
export function mapBoxScoreMatch(item: unknown): BoxScoreMatch | null {
  if (!isRecord(item)) return null;
  const externalId = idOf(item.id);
  const kickoff = str(item.date);
  const home = ref(item.homeTeam);
  const away = ref(item.awayTeam);
  if (externalId === null || kickoff === null || home === null || away === null) return null;
  const at = Date.parse(kickoff);
  if (Number.isNaN(at)) return null;
  const state = isRecord(item.state) ? item.state : {};
  return {
    externalId,
    kickoffAt: new Date(at).toISOString(),
    finished: mapStatus(state.description) === 'finished',
    home,
    away,
  };
}

export interface BoxScoreMatchesQuery {
  /** YYYY-MM-DD, read by the provider in UTC. */
  date: string;
  leagueExternalId: string;
}

/** The provider's largest `/matches` page; a league's day is far below it. */
const MATCHES_LIMIT = 100;

export interface HighlightlyBoxScores {
  /** One league's matches on one UTC day: one request. */
  matches(query: BoxScoreMatchesQuery): Promise<AdapterResult<BoxScoreMatch[]>>;
  /** One match's box score: one request. */
  boxScore(matchExternalId: string): Promise<AdapterResult<NormalisedBoxScore>>;
}

/** The box-score client over the injected transport (the budget is the caller's). */
export function createHighlightlyBoxScores(
  transport: Transport,
  apiKey: string,
): HighlightlyBoxScores {
  const get = highlightlyGet(transport, apiKey);
  return {
    async matches(query) {
      const result = await get('/matches', {
        leagueId: query.leagueExternalId,
        date: query.date,
        timezone: 'Etc/UTC',
        limit: String(MATCHES_LIMIT),
      });
      if (!result.ok) return { ok: false, error: result.error, requests: 1 };
      const items =
        isRecord(result.body) && Array.isArray(result.body.data) ? result.body.data : null;
      if (items === null) {
        return {
          ok: false,
          error: { kind: 'malformed', message: `no data array for ${query.date}` },
          requests: 1,
        };
      }
      const data = items
        .map(mapBoxScoreMatch)
        .filter((match): match is BoxScoreMatch => match !== null);
      return { ok: true, data, requests: 1, fetchedAt: result.receivedAt };
    },

    async boxScore(matchExternalId) {
      if (!/^\d+$/.test(matchExternalId)) {
        return {
          ok: false,
          error: { kind: 'unsupported', message: `not a match id: ${matchExternalId}` },
          requests: 0,
        };
      }
      const result = await get(`/box-score/${matchExternalId}`);
      if (!result.ok) return { ok: false, error: result.error, requests: 1 };
      const data = mapBoxScore(result.body);
      if (data === null) {
        return {
          ok: false,
          error: { kind: 'malformed', message: `no box score array for ${matchExternalId}` },
          requests: 1,
        };
      }
      return { ok: true, data, requests: 1, fetchedAt: result.receivedAt };
    },
  };
}
