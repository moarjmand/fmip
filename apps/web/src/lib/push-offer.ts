/**
 * When to offer push at the moment of a follow (T-1429). No catalogue and no
 * directive: the rules are plain functions over a `Storage`, so the client
 * component stays thin and the rules are tested without a browser.
 *
 * Two marks, both on this device only:
 *
 * - **The follow intent** (session storage). A follow is a plain form posting
 *   a server action, so the page that says "Following" is a fresh render. The
 *   form leaves a mark as it submits, and the offer beside the followed state
 *   takes it: the offer appears after a click, never on a page load, and once
 *   per click. A mark older than `INTENT_TTL_MS` is the leftover of a follow
 *   that never rendered and is ignored.
 * - **The dismissal** (local storage). "Not now" -- or a browser that refused
 *   permission -- quiets the offer on this device for `DISMISS_DAYS`. The
 *   switch in Settings → Notifications stays where it always was.
 *
 * Storage that throws (a private window, blocked site data) reads as "no
 * mark" and writes nothing: the offer then simply does not appear, which is
 * the safe direction.
 */

import {
  type FollowIntent,
  INTENT_KEY,
  type OfferedType,
  type Store,
  isOfferedType,
} from '@/lib/push-offer-intent';

export {
  type FollowIntent,
  INTENT_KEY,
  OFFERED_TYPES,
  type OfferedType,
  isOfferedType,
  markFollowIntent,
} from '@/lib/push-offer-intent';

export const DISMISSED_KEY = 'fmip.pushOffer.dismissedAt';
export const INTENT_TTL_MS = 2 * 60 * 1000;
export const DISMISS_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Take the mark if it is for this follow (or for any follow, when `entity` is
 * null) and fresh. A mark for another follow is left for its own offer.
 */
export function takeFollowIntent(
  store: Store | null,
  entity: { type: OfferedType; id: string } | null,
  now: number,
): FollowIntent | null {
  if (store === null) return null;
  try {
    const raw = store.getItem(INTENT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<FollowIntent>;
    const valid =
      typeof parsed.type === 'string' &&
      isOfferedType(parsed.type) &&
      typeof parsed.id === 'string' &&
      typeof parsed.at === 'number';
    if (!valid) {
      store.removeItem(INTENT_KEY);
      return null;
    }
    const intent = parsed as FollowIntent;
    if (entity !== null && (intent.type !== entity.type || intent.id !== entity.id)) return null;
    store.removeItem(INTENT_KEY);
    if (now - intent.at < 0 || now - intent.at > INTENT_TTL_MS) return null;
    return intent;
  } catch {
    return null;
  }
}

/** "Not now", or a refusal: quiet on this device for `DISMISS_DAYS`. */
export function rememberDismissal(store: Store | null, now: number): void {
  if (store === null) return;
  try {
    store.setItem(DISMISSED_KEY, String(now));
  } catch {
    // The offer only appears after a follow; at worst it appears once more.
  }
}

export function isDismissed(store: Store | null, now: number): boolean {
  if (store === null) return false;
  try {
    const raw = store.getItem(DISMISSED_KEY);
    if (raw === null) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return now - at < DISMISS_DAYS * DAY_MS;
  } catch {
    // Unreadable: treat as dismissed rather than risk asking again and again.
    return true;
  }
}

/** What the browser and the deployment say, gathered by the component. */
export interface OfferFacts {
  /** Service worker, `PushManager` and `Notification` all present. */
  supported: boolean;
  /** `Notification.permission`. */
  permission: NotificationPermission;
  /** This device already has a push subscription. */
  subscribed: boolean;
  dismissed: boolean;
}

/**
 * Whether to ask. A browser that has already refused is never asked through
 * the offer (it could not show the prompt anyway); a device that already
 * receives push has nothing to be offered.
 */
export function shouldOffer(facts: OfferFacts): boolean {
  return facts.supported && facts.permission !== 'denied' && !facts.subscribed && !facts.dismissed;
}
