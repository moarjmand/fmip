import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which part of the day's request budget a request may draw on (T-1365, D-183).
 *
 * The provider ceiling (`API_FOOTBALL_DAILY_BUDGET`) used to be one counter
 * every job drew on alike, so a day whose backlog and hourly sweeps spent it
 * stopped the live scores too, until midnight UTC. Each request now carries a
 * tier, and a lower tier stops earlier, so the last part of the day is kept
 * for what a reader is watching:
 *
 * - `critical`: the live job, line-ups and availability before kick-off, and
 *   the detail of a match that has just finished -- up to the whole budget;
 * - `standard`: the fixture list and the standings check -- up to
 *   `API_FOOTBALL_BUDGET_STANDARD_PERCENT` (90 unless set);
 * - `bulk`: the detail backlog, administrators' re-asks, backfills and the
 *   squads sweep -- up to `API_FOOTBALL_BUDGET_BULK_PERCENT` (70 unless set).
 *
 * A request sent outside any tier is `bulk`: work nobody classified never
 * eats the reserve.
 */
export const BUDGET_TIERS = ['critical', 'standard', 'bulk'] as const;
export type BudgetTier = (typeof BUDGET_TIERS)[number];

/** The percent of the daily budget each lower tier may reach; `critical` is always 100. */
export interface TierShares {
  bulk: number;
  standard: number;
}

export const DEFAULT_TIER_SHARES: TierShares = { bulk: 70, standard: 90 };

/** No reserve at all: every tier may spend the whole budget (Highlightly's free plan). */
export const NO_RESERVE: TierShares = { bulk: 100, standard: 100 };

const current = new AsyncLocalStorage<BudgetTier>();

/** Runs `work` with every request sent inside it drawn from `tier`. */
export function withBudgetTier<T>(tier: BudgetTier, work: () => Promise<T>): Promise<T> {
  return current.run(tier, work);
}

/** The tier of the request being sent now; `bulk` when nothing set one. */
export function currentBudgetTier(): BudgetTier {
  return current.getStore() ?? 'bulk';
}

/**
 * A run's tier from its job and scope. A backfill (`backfill`, `backfill
 * 2023/24`) is the fixtures job over a whole season and is `bulk`; the
 * post-match run is `critical` for its just-finished matches and drops to
 * `bulk` for its backlog and re-asks itself (`IngestionJobsService.postMatch`).
 */
export function tierOfRun(job: string, scope: string | null): BudgetTier {
  if (scope !== null && scope.startsWith('backfill')) return 'bulk';
  switch (job) {
    case 'live':
    case 'lineups':
    case 'post_match':
      return 'critical';
    case 'fixtures':
    case 'standings':
      return 'standard';
    default:
      return 'bulk';
  }
}

/** The highest count of today's requests at which a request of `tier` is still sent. */
export function tierCeiling(perDay: number, tier: BudgetTier, shares: TierShares): number {
  if (tier === 'critical') return perDay;
  return Math.floor((perDay * shares[tier]) / 100);
}

export interface TierShareEnv {
  API_FOOTBALL_BUDGET_BULK_PERCENT?: string;
  API_FOOTBALL_BUDGET_STANDARD_PERCENT?: string;
}

/**
 * The shares this deployment asked for, or why they are refused. Empty means
 * the default; a value that is not a whole number from 1 to 100, or a bulk
 * share above the standard one, is refused rather than guessed at, like the
 * ceiling itself.
 */
export function parseTierShares(env: TierShareEnv): TierShares | { error: string } {
  const read = (name: keyof TierShareEnv, fallback: number): number | string => {
    const raw = (env[name] ?? '').trim();
    if (raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      return `${name}=${raw} is not a whole percent from 1 to 100`;
    }
    return value;
  };
  const bulk = read('API_FOOTBALL_BUDGET_BULK_PERCENT', DEFAULT_TIER_SHARES.bulk);
  if (typeof bulk === 'string') return { error: bulk };
  const standard = read('API_FOOTBALL_BUDGET_STANDARD_PERCENT', DEFAULT_TIER_SHARES.standard);
  if (typeof standard === 'string') return { error: standard };
  if (bulk > standard) {
    return {
      error: `API_FOOTBALL_BUDGET_BULK_PERCENT=${bulk} is above API_FOOTBALL_BUDGET_STANDARD_PERCENT=${standard}`,
    };
  }
  return { bulk, standard };
}
