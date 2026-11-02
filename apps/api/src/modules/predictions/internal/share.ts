import { randomBytes } from 'node:crypto';
import type { CalledItCard, PredictionOutcome } from '@fmip/contracts';

/**
 * The "called it" card's rules (T-1723, D-351), pure so each is tested
 * without a database.
 *
 * A prediction has a card only when its **current** settlement -- the newest
 * row, the one every other surface reads (T-052) -- is `settled` with the
 * outcome right. The card shows the version that was settled, never the
 * latest one, and the score it was settled against, never the score on the
 * page now. Nothing is recomputed (rule 8).
 */

/** One prediction with its current settlement and the version it settled. */
export interface ShareableRow {
  prediction_id: string;
  user_id: string;
  username: string;
  account_status: string;
  fixture_id: string;
  kickoff_at: Date;
  round: string | null;
  competition: string;
  home_name: string;
  home_short_name: string | null;
  away_name: string;
  away_short_name: string | null;
  settlement_status: 'settled' | 'void' | null;
  outcome_correct: boolean | null;
  score_correct: boolean | null;
  actual_home: number | null;
  actual_away: number | null;
  outcome: PredictionOutcome | null;
  home_goals: number | null;
  away_goals: number | null;
  submitted_at: Date | null;
}

export type CardVerdict =
  | { kind: 'called'; card: CalledItCard }
  | { kind: 'not_called'; reason: 'open' | 'void' | 'wrong' };

export function cardOf(row: ShareableRow): CardVerdict {
  if (row.settlement_status === null) return { kind: 'not_called', reason: 'open' };
  if (row.settlement_status === 'void') return { kind: 'not_called', reason: 'void' };
  if (
    row.outcome_correct !== true ||
    row.actual_home === null ||
    row.actual_away === null ||
    row.outcome === null ||
    row.submitted_at === null
  ) {
    return { kind: 'not_called', reason: 'wrong' };
  }
  return {
    kind: 'called',
    card: {
      fixture_id: row.fixture_id,
      competition: row.competition,
      round: row.round,
      home: { name: row.home_name, short_name: row.home_short_name },
      away: { name: row.away_name, short_name: row.away_short_name },
      actual: { home: row.actual_home, away: row.actual_away },
      pick: {
        outcome: row.outcome,
        score:
          row.home_goals !== null && row.away_goals !== null
            ? { home: row.home_goals, away: row.away_goals }
            : null,
      },
      exact: row.score_correct === true,
      picked_at: row.submitted_at.toISOString(),
      kickoff_at: row.kickoff_at.toISOString(),
      username: row.username,
    },
  };
}

/** A new link's token: 128 random bits, base64url without padding (22 characters). */
export function newShareToken(): string {
  return randomBytes(16).toString('base64url');
}
