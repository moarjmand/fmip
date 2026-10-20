/**
 * The follow intent's half of the push offer's rules (T-1429), apart from the
 * rest so the follow forms' mark -- on every page with a follow button --
 * carries only this. The rules and why: `@/lib/push-offer`.
 */

export const INTENT_KEY = 'fmip.pushOffer.intent';

/** The follows whose alerts reach a device: a team, a competition, a match. */
export const OFFERED_TYPES = ['team', 'competition', 'fixture'] as const;
export type OfferedType = (typeof OFFERED_TYPES)[number];

export interface FollowIntent {
  type: OfferedType;
  id: string;
  at: number;
}

export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function isOfferedType(type: string): type is OfferedType {
  return (OFFERED_TYPES as readonly string[]).includes(type);
}

/** The form is submitting a follow: leave the mark the next render takes. */
export function markFollowIntent(store: Store | null, type: string, id: string, now: number): void {
  if (store === null || id === '' || !isOfferedType(type)) return;
  try {
    store.setItem(INTENT_KEY, JSON.stringify({ type, id, at: now } satisfies FollowIntent));
  } catch {
    // Nothing remembered, nothing offered.
  }
}
