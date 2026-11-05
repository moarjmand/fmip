/**
 * The pick control's rules that are not markup (T-1738, D-359): which of its
 * four states it is in, and the address a guest's outcome leads to. Pure, so
 * the spec covers them without rendering anything.
 */

export const PICK_OUTCOMES = ['home', 'draw', 'away'] as const;
export type PickOutcome = (typeof PICK_OUTCOMES)[number];

/** `?pick=` as an outcome, or `null` for anything else (a repeated or unknown value is ignored). */
export function readPick(value: string | readonly string[] | undefined | null): PickOutcome | null {
  return typeof value === 'string' && (PICK_OUTCOMES as readonly string[]).includes(value)
    ? (value as PickOutcome)
    : null;
}

/**
 * The match page with one outcome chosen, at its pick control:
 * `/<locale>/match/<fixture id>?pick=<home|draw|away>#pick`. The choice lives
 * in the address and nowhere else, so nothing is stored for a guest.
 */
export function pickReturnPath(locale: string, fixtureId: string, outcome: PickOutcome): string {
  return `/${locale}/match/${encodeURIComponent(fixtureId)}?pick=${outcome}#pick`;
}

/**
 * Where a guest's outcome leads (the contract of D-359): the register page
 * with the way back in `next`, URL-encoded --
 * `/<locale>/register?next=<encoded pickReturnPath>`. The register page
 * hands the same `next` on to sign-in for a visitor who has an account.
 */
export function guestPickHref(locale: string, fixtureId: string, outcome: PickOutcome): string {
  return `/${locale}/register?next=${encodeURIComponent(pickReturnPath(locale, fixtureId, outcome))}`;
}

/** The sign-in page with the same `next` as `guestPickHref`. */
export function guestSignInHref(locale: string, fixtureId: string, outcome: PickOutcome): string {
  return `/${locale}/login?next=${encodeURIComponent(pickReturnPath(locale, fixtureId, outcome))}`;
}

const MATCH_PICK_PATH =
  /^\/([^/?#]+)\/match\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\?pick=(home|draw|away)(?:#pick)?$/i;

/**
 * The match and the outcome a return address names, when it is exactly the
 * address `pickReturnPath` writes under `locale` --
 * `/<locale>/match/<uuid>?pick=<home|draw|away>`, with or without `#pick` --
 * and `null` for anything else (T-1740, D-361). It is how `registerAction`
 * knows the new member came from an outcome, so that the pick can be saved
 * with the account. Hand it a `next` that `safeReturnPath` already accepted;
 * this adds only the shape, and reads nothing it does not match whole.
 */
export function pickFromReturnPath(
  locale: string,
  next: string | null | undefined,
): { fixtureId: string; outcome: PickOutcome } | null {
  if (typeof next !== 'string') return null;
  const match = MATCH_PICK_PATH.exec(next);
  if (match === null || match[1] !== locale) return null;
  const outcome = readPick(match[3]?.toLowerCase());
  const fixtureId = match[2]?.toLowerCase();
  return outcome === null || fixtureId === undefined ? null : { fixtureId, outcome };
}

/**
 * A pending pick (D-361) as the control reads it: the member's pick saved
 * before their email address was confirmed. `pending` while it waits for the
 * confirmation; `uncounted` once kick-off came first -- saved, not counted.
 * `null` for none, and for one that is no longer standing (it became a
 * prediction, was replaced or was taken back).
 */
export type PendingView = { outcome: PickOutcome; state: 'pending' | 'uncounted' } | null;

export function pendingView(
  pick: { outcome: PickOutcome; status: string } | null | undefined,
): PendingView {
  if (pick === null || pick === undefined) return null;
  if (pick.status === 'pending') return { outcome: pick.outcome, state: 'pending' };
  return pick.status === 'expired' ? { outcome: pick.outcome, state: 'uncounted' } : null;
}

/**
 * The control's states (the board's four, D-359, and the pending pick's two,
 * D-361):
 * - `open`: nothing chosen;
 * - `chosen`: an outcome carried in the address and not stored -- a guest's,
 *   or a member's who chose before signing in;
 * - `pending`: the pick of a member whose email address is not confirmed
 *   yet, saved and waiting: it counts once they confirm before kick-off;
 * - `saved`: the member's stored pick, still open to change;
 * - `locked`: kick-off has passed, whatever was or was not picked;
 * - `uncounted`: kick-off has passed and the pick was still waiting for the
 *   confirmation -- saved, not counted.
 */
export type PickControlState = 'open' | 'chosen' | 'pending' | 'saved' | 'locked' | 'uncounted';

export function pickControlState(input: {
  locked: boolean;
  /** The outcome of the member's stored pick, if there is one. */
  saved: PickOutcome | null;
  /** The outcome carried in the address, if there is one. */
  chosen: PickOutcome | null;
  /** The member's pending pick, if one stands (`pendingView`). */
  pending?: PendingView;
}): PickControlState {
  // A prediction is the pick; a pending pick beside one has done its job.
  if (input.saved !== null) return input.locked ? 'locked' : 'saved';
  const pending = input.pending ?? null;
  if (pending !== null) {
    // The API's word that kick-off came first, or this page's own clock.
    return input.locked || pending.state === 'uncounted' ? 'uncounted' : 'pending';
  }
  if (input.locked) return 'locked';
  return input.chosen !== null ? 'chosen' : 'open';
}

/**
 * The outcome the control marks: the stored one always wins over the
 * address's -- a prediction first, then a pending pick -- and after kick-off
 * only a stored pick is one (an address cannot claim a pick the API never
 * took).
 */
export function markedOutcome(input: {
  locked: boolean;
  saved: PickOutcome | null;
  chosen: PickOutcome | null;
  pending?: PendingView;
}): PickOutcome | null {
  if (input.saved !== null) return input.saved;
  if (input.pending !== null && input.pending !== undefined) return input.pending.outcome;
  return input.locked ? null : input.chosen;
}

/**
 * The match page at its pick card with nothing chosen yet (T-1741, D-362):
 * `/<locale>/match/<fixture id>#pick`. Where "Make your pick" leads from a
 * card that shows a match without the control itself -- the team page's next
 * match and the news story's predictions card.
 */
export function pickCardPath(locale: string, fixtureId: string): string {
  return `/${locale}/match/${encodeURIComponent(fixtureId)}#pick`;
}

/**
 * Whether a card may still offer the way to the pick card (T-1741): the
 * match is still `scheduled` and, when the caller passes the moment of its
 * render, kick-off is after it. Picks lock at kick-off (blueprint 6.6) and
 * the API is the authority; this only keeps a match already under way, or
 * one whose status is behind its kick-off, from inviting a pick.
 */
export function pickOpen(fixture: { status: string; kickoff_at: string }, now?: number): boolean {
  if (fixture.status !== 'scheduled') return false;
  return now === undefined || Date.parse(fixture.kickoff_at) > now;
}
