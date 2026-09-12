import { type FixtureStatus, type Freshness, STALE_LIVE_AFTER_MS } from '@fmip/contracts';

/**
 * The freshness rule (rule 4, T-083, D-045), pure so it is tested without a
 * clock. Only a match in progress can be stale: before kick-off nothing is
 * expected to change, and after the end nothing will. `suspended` counts as
 * in progress — a feed that stops during a suspension is still a feed that
 * stopped.
 */
export function freshnessOf(
  status: FixtureStatus,
  lastUpdatedAt: Date,
  now: Date,
  staleAfterMs: number = STALE_LIVE_AFTER_MS,
): Freshness | null {
  if (status !== 'live' && status !== 'suspended') return null;
  return now.getTime() - lastUpdatedAt.getTime() > staleAfterMs ? 'stale' : 'current';
}
