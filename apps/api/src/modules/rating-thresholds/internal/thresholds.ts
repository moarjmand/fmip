import {
  RATING_THRESHOLD_BOUNDS,
  RATING_THRESHOLD_FIELDS,
  type RatingThresholdValues,
} from '@fmip/contracts';

/**
 * The thresholds in force (T-1160, D-152, D-164): one `rating_threshold_version`
 * row as the code reads it. Pure; the store reads and writes the rows.
 */
export interface RatingThresholds {
  version: number;
  provisionalBelow: number;
  establishedAt: number;
  contributorMinRating: number;
  contributorMinSettled: number;
  conductWindowDays: number;
  flagPeriodDays: number;
}

/**
 * Version 1: the constants in force before T-1160, exactly as the migration
 * writes them. Nothing reads this in place of the table; it is what the
 * migration is checked against, and what a unit test with no database rates
 * under. A spec holds it equal to `RATING_FORMULA_V1`, `ELIGIBILITY_V1` and
 * D-137's period, so the day this ships nothing moves.
 */
export const THRESHOLDS_V1: RatingThresholds = {
  version: 1,
  provisionalBelow: 30,
  establishedAt: 50,
  contributorMinRating: 70,
  contributorMinSettled: 50,
  conductWindowDays: 90,
  flagPeriodDays: 30,
};

const REASON_MAX = 500;

export type ParsedRequest =
  | {
      ok: true;
      values: RatingThresholdValues;
      /** Null means now, by the database clock. */
      effectiveFrom: string | null;
      reason: string;
    }
  | { ok: false; message: string; fields: Record<string, string> };

/** An instant with its zone: `2026-10-01T00:00Z`, `2026-10-01T02:00:00+02:00`. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * `POST /admin/rating-thresholds`'s body, every problem named at once. The
 * reason is checked first and alone, so a body complete but for its reason
 * is refused for that and nothing else.
 */
export function parseRequest(body: unknown): ParsedRequest {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (reason === '')
    return {
      ok: false,
      message: 'Say why. The reason is recorded with the new version.',
      fields: { reason: 'Say why.' },
    };
  if (reason.length > REASON_MAX)
    return {
      ok: false,
      message: `The reason is at most ${REASON_MAX} characters.`,
      fields: { reason: `At most ${REASON_MAX} characters.` },
    };

  const fields: Record<string, string> = {};
  const values = {} as RatingThresholdValues;
  for (const name of RATING_THRESHOLD_FIELDS) {
    const bounds = RATING_THRESHOLD_BOUNDS[name];
    const value = raw[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fields[name] = 'A number is required.';
    } else if (bounds.integer && !Number.isInteger(value)) {
      fields[name] = 'A whole number is required.';
    } else if (!bounds.integer && Math.abs(Math.round(value * 10) - value * 10) > 1e-9) {
      fields[name] = 'At most one decimal place.';
    } else if (value < bounds.min || value > bounds.max) {
      fields[name] = `From ${bounds.min} to ${bounds.max}.`;
    } else {
      values[name] = bounds.integer ? value : Math.round(value * 10) / 10;
    }
  }
  if (
    fields.provisional_below === undefined &&
    fields.established_at === undefined &&
    values.established_at < values.provisional_below
  ) {
    fields.established_at =
      'At least the provisional count: a rating cannot be provisional and established at once.';
  }

  let effectiveFrom: string | null = null;
  const start = raw.effective_from;
  if (start !== undefined && start !== null && start !== '') {
    if (typeof start !== 'string' || !INSTANT.test(start) || Number.isNaN(Date.parse(start))) {
      fields.effective_from = 'An instant with its zone, e.g. 2026-10-01T00:00Z; empty means now.';
    } else {
      effectiveFrom = start;
    }
  }

  if (Object.keys(fields).length > 0)
    return { ok: false, message: 'Some values are not acceptable.', fields };
  return { ok: true, values, effectiveFrom, reason };
}

/** Whether two versions hold the same six values. */
export function sameValues(a: RatingThresholdValues, b: RatingThresholdValues): boolean {
  return RATING_THRESHOLD_FIELDS.every((name) => a[name] === b[name]);
}

export function valuesOf(t: RatingThresholds): RatingThresholdValues {
  return {
    provisional_below: t.provisionalBelow,
    established_at: t.establishedAt,
    contributor_min_rating: t.contributorMinRating,
    contributor_min_settled: t.contributorMinSettled,
    conduct_window_days: t.conductWindowDays,
    flag_period_days: t.flagPeriodDays,
  };
}
