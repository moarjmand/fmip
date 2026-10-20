import type { ExpectedMetric, NormalisedBoxScore } from '@fmip/ingestion';
import type { FeedCandidate } from './highlight-feed';

/**
 * The box-score job's rules (T-1432, D-224), pure: how many box scores a run
 * may ask for, when a stored one is asked for again, and which of a box
 * score's figures become rows of ours. The service runs them; the store keeps
 * what they decide.
 */

/** Box scores asked for per run, when `BOX_SCORE_BATCH` is empty. */
export const BOX_SCORE_DEFAULT_BATCH = 60;
/**
 * A stored box score with players we could not place yet is asked for again
 * after this long, inside the window, so a player mapped since is filled in;
 * at most four times in 51 hours.
 */
export const REASK_AFTER_HOURS = 12;

/** The injection token for the batch, read from the environment once at boot. */
export const BOX_SCORE_BATCH = Symbol('BOX_SCORE_BATCH');

/** `BOX_SCORE_BATCH`: empty is the default; not a positive whole number stops the API at boot (D-049's rule). */
export function boxScoreBatch(env: NodeJS.ProcessEnv): number {
  const raw = (env.BOX_SCORE_BATCH ?? '').trim();
  if (raw === '') return BOX_SCORE_DEFAULT_BATCH;
  const batch = Number(raw);
  if (!Number.isInteger(batch) || batch <= 0) {
    throw new Error(`BOX_SCORE_BATCH must be a positive whole number, not "${raw}"`);
  }
  return batch;
}

/** A finished match inside the window, with its two sides' rows. */
export interface BoxScoreCandidate extends FeedCandidate {
  homeParticipantId: string | null;
  awayParticipantId: string | null;
}

/** One stored figure. */
export interface ExpectedRow {
  participantId: string;
  personId: string;
  metric: ExpectedMetric;
  value: number;
}

/** A player the source listed, as the job decided about them. */
export type PlayerPlacement =
  | { kind: 'resolved'; personId: string }
  /** Not mapped (queued for review) or ignored by a reviewer: not ours to show. */
  | { kind: 'unresolved' };

export type BoxScoreRows =
  | {
      kind: 'rows';
      rows: ExpectedRow[];
      /** Player entries the source listed. */
      players: number;
      /** Of those, not placed on one of our people. */
      unresolved: number;
    }
  /** The source answered with no player yet: ask again on a later run. */
  | { kind: 'not_ready' }
  /** A side of the box score is neither of the match's teams: nothing is stored. */
  | { kind: 'side_mismatch'; teamExternalId: string };

/**
 * A box score's figures as our rows. Each side must be one of the match's two
 * teams (`teams`: the source's team id -> ours, through `provider_mapping`);
 * each player is placed by `people` (the source's player id -> the decision).
 * A person who appears twice (two of the source's ids mapped to one of ours)
 * keeps the first entry's figures. Unresolved players are counted, never
 * written under a guessed person (rule 1).
 */
export function boxScoreRows(
  score: NormalisedBoxScore,
  candidate: BoxScoreCandidate,
  teams: ReadonlyMap<string, string | null>,
  people: ReadonlyMap<string, PlayerPlacement>,
): BoxScoreRows {
  const players = score.sides.reduce((sum, side) => sum + side.players.length, 0);
  if (players === 0) return { kind: 'not_ready' };
  const rows: ExpectedRow[] = [];
  const seen = new Set<string>();
  let unresolved = 0;
  for (const side of score.sides) {
    const team = teams.get(side.team.externalId) ?? null;
    const participantId =
      team !== null && team === candidate.homeTeamId
        ? candidate.homeParticipantId
        : team !== null && team === candidate.awayTeamId
          ? candidate.awayParticipantId
          : null;
    if (participantId === null)
      return { kind: 'side_mismatch', teamExternalId: side.team.externalId };
    for (const player of side.players) {
      const placed = people.get(player.externalId);
      if (placed === undefined || placed.kind !== 'resolved') {
        unresolved += 1;
        continue;
      }
      if (seen.has(placed.personId)) continue;
      seen.add(placed.personId);
      for (const [metric, value] of Object.entries(player.expected) as [ExpectedMetric, number][]) {
        rows.push({ participantId, personId: placed.personId, metric, value });
      }
    }
  }
  return { kind: 'rows', rows, players, unresolved };
}
