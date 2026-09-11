import { RATING_FORMULA_V1 } from './formula';

/**
 * Leaderboard rules (blueprint 9.3), version 1. The board ranks members by
 * their current rating; the minimum-sample filter is what keeps a member with
 * one lucky result from ranking above established performers, so it has a
 * floor the request cannot go under. The floor is the formula's provisional
 * threshold: a provisional rating is not a ranking.
 */
export interface LeaderboardRules {
  version: string;
  /** The lowest minimum-sample filter the board accepts. */
  floor: number;
  /** Filter values the UI offers. All at or above the floor. */
  presets: number[];
  defaultLimit: number;
  maxLimit: number;
}

export const LEADERBOARD_RULES_V1: LeaderboardRules = {
  version: 'leaderboard@1.0.0',
  floor: RATING_FORMULA_V1.provisionalBelow,
  presets: [RATING_FORMULA_V1.provisionalBelow, RATING_FORMULA_V1.establishedAt, 100],
  defaultLimit: 50,
  maxLimit: 100,
};

export interface LeaderboardQuery {
  minSettled: number;
  limit: number;
  offset: number;
}

export type ParsedLeaderboardQuery =
  { ok: true; query: LeaderboardQuery } | { ok: false; fields: Record<string, string> };

/** Fastify hands a repeated parameter over as an array; the first one counts. */
function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function integer(value: string): number | null {
  return /^\d{1,9}$/.test(value) ? Number(value) : null;
}

/**
 * Parses `min_settled`, `limit` and `offset`, naming every bad field at once.
 * Absent fields take the rules' defaults; a `min_settled` under the floor is
 * refused rather than raised, so the caller learns the rule.
 */
export function parseLeaderboardQuery(
  raw: Record<string, unknown>,
  rules: LeaderboardRules = LEADERBOARD_RULES_V1,
): ParsedLeaderboardQuery {
  const fields: Record<string, string> = {};
  let minSettled = rules.floor;
  let limit = rules.defaultLimit;
  let offset = 0;

  const min = first(raw.min_settled);
  if (min !== undefined) {
    const n = integer(min);
    if (n === null) fields.min_settled = 'Must be a whole number.';
    else if (n < rules.floor) fields.min_settled = `Must be at least ${rules.floor}.`;
    else minSettled = n;
  }

  const lim = first(raw.limit);
  if (lim !== undefined) {
    const n = integer(lim);
    if (n === null || n < 1 || n > rules.maxLimit)
      fields.limit = `Must be a whole number from 1 to ${rules.maxLimit}.`;
    else limit = n;
  }

  const off = first(raw.offset);
  if (off !== undefined) {
    const n = integer(off);
    if (n === null) fields.offset = 'Must be a whole number.';
    else offset = n;
  }

  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, query: { minSettled, limit, offset } };
}
