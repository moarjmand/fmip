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
 *
 * A match still `scheduled` more than `AWAITING_UPDATE_AFTER_MS` after its
 * kick-off is `awaiting_update` (T-1708, D-343); at exactly the threshold it
 * is still to come. Derived here at read time from the stored status and
 * kick-off, never written back: the stored row keeps what the feed said, and
 * the feed's next answer replaces the state on its own.
 */
export function freshnessOf(
  status: FixtureStatus,
  lastUpdatedAt: Date,
  now: Date,
  staleAfterMs: number = STALE_LIVE_AFTER_MS,
  clock: { minute?: number | null; liveAnsweredAt?: Date | null; kickoffAt?: Date | null } = {},
): Freshness | null {
  if (status === 'scheduled') {
    return clock.kickoffAt != null &&
      now.getTime() - clock.kickoffAt.getTime() > AWAITING_UPDATE_AFTER_MS
      ? 'awaiting_update'
      : null;
  }
  if (status !== 'live' && status !== 'suspended') return null;
  const from = liveFreshnessFrom({
    status,
    minute: clock.minute ?? null,
    last_updated_at: lastUpdatedAt.toISOString(),
    live_answered_at: clock.liveAnsweredAt?.toISOString() ?? null,
  });
  return now.getTime() - from > staleAfterMs ? 'stale' : 'current';
}

/**
 * The freshness a list of fixtures carries (T-1710, D-343): the competition
 * and team pages' lists, and the team page's next match. Only
 * `awaiting_update`, by the same rule as `freshnessOf`; never `stale`, which
 * needs the provider's live answers that only the scores answer and the
 * match centre read.
 */
export function listFreshnessOf(
  status: string,
  kickoffAt: string,
  now: Date,
): 'awaiting_update' | null {
  if (status !== 'scheduled') return null;
  return freshnessOf('scheduled', now, now, undefined, { kickoffAt: new Date(kickoffAt) }) ===
    'awaiting_update'
    ? 'awaiting_update'
    : null;
}

/**
 * How long after its kick-off a match may still be `scheduled` (T-1708,
 * D-343): three hours. Ninety minutes, half-time, added time, extra time with
 * its break and a shoot-out come to under three hours, so a match the feed
 * still calls scheduled by then started late, was postponed or was played,
 * and we do not know which. Kept here, not in the contracts, which are in
 * every page's JavaScript: the web reads the derived word, never the rule.
 */
export const AWAITING_UPDATE_AFTER_MS = 3 * 60 * 60_000;
