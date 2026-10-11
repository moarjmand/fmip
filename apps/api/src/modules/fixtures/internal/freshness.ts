import {
  type FixtureStatus,
  type Freshness,
  STALE_LIVE_AFTER_MS,
  liveFreshnessFrom,
} from '@fmip/contracts';

/**
 * The freshness rule (rule 4, T-083, D-045), pure so it is tested without a
 * clock. Only a match in progress can be stale: before kick-off nothing is
 * expected to change, and after the end nothing will. `suspended` counts as
 * in progress — a feed that stops during a suspension is still a feed that
 * stopped.
 *
 * Measured from `liveFreshnessFrom` (T-1394, D-209): the last change, or,
 * where the stored clock stands still (half-time, added time, the breaks, a
 * suspension), the later of that and the provider's last live answer, so a
 * half-time the provider is still answering about is not called behind.
 */
export function freshnessOf(
  status: FixtureStatus,
  lastUpdatedAt: Date,
  now: Date,
  staleAfterMs: number = STALE_LIVE_AFTER_MS,
  clock: { minute?: number | null; liveAnsweredAt?: Date | null } = {},
): Freshness | null {
  if (status !== 'live' && status !== 'suspended') return null;
  const from = liveFreshnessFrom({
    status,
    minute: clock.minute ?? null,
    last_updated_at: lastUpdatedAt.toISOString(),
    live_answered_at: clock.liveAnsweredAt?.toISOString() ?? null,
  });
  return now.getTime() - from > staleAfterMs ? 'stale' : 'current';
}
