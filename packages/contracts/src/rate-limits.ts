/**
 * The rate-limit inventory (T-811, D-103): every write the API takes, the
 * ceiling it is held to, or the reason it has none, with how many requests
 * each ceiling refused per UTC day.
 *
 * `GET /admin/rate-limits` answers `RateLimitsReport` (admin role only). The
 * ceilings are read from the `rate_limit` table at the time of the request,
 * so an administrator's UPDATE shows at once; the list of writes is the
 * API's own inventory, which a test holds to the router.
 */

export const RATE_REFUSAL_RETENTION_DAYS = 30;
/** The days the System page shows. */
export const RATE_REFUSAL_DAYS = 7;

/** Whose count a ceiling is: one member, one network address, or one identifier typed. */
export type RateLimitSubject = 'member' | 'address' | 'identifier';

/** Where the ceiling is enforced: a trigger on the insert, or the API before the work. */
export type RateLimitEnforcement = 'database' | 'api';

/** One UTC day and how many requests a ceiling refused on it. Days with none are 0. */
export interface RateRefusalDay {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  count: number;
}

export interface RateLimitCeiling {
  /** The `rate_limit` row's key, e.g. `friend_request`. */
  action: string;
  /** Per hour, as the table says now; `null` when the row is missing, which means not limited. */
  per_hour: number | null;
  subject: RateLimitSubject;
  enforced: RateLimitEnforcement;
  /** What it limits, in a sentence. */
  what: string;
  /** The writes it holds, `METHOD /path` as the router registers them. */
  routes: string[];
  /** One entry per day of the window, oldest first. */
  refusals: RateRefusalDay[];
}

/** A write with no ceiling, and why it needs none. */
export interface RateLimitExemption {
  route: string;
  reason: string;
}

export interface RateLimitsReport {
  ceilings: RateLimitCeiling[];
  exempt: RateLimitExemption[];
  /** The days `refusals` covers, oldest first. */
  days: string[];
  generated_at: string;
}
