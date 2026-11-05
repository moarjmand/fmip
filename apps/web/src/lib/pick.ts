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

/**
 * The control's states (the board's four, D-359):
 * - `open`: nothing chosen;
 * - `chosen`: an outcome carried in the address and not stored -- a guest's,
 *   or a member's who chose before signing in;
 * - `saved`: the member's stored pick, still open to change;
 * - `locked`: kick-off has passed, whatever was or was not picked.
 */
export type PickControlState = 'open' | 'chosen' | 'saved' | 'locked';

export function pickControlState(input: {
  locked: boolean;
  /** The outcome of the member's stored pick, if there is one. */
  saved: PickOutcome | null;
  /** The outcome carried in the address, if there is one. */
  chosen: PickOutcome | null;
}): PickControlState {
  if (input.locked) return 'locked';
  if (input.saved !== null) return 'saved';
  return input.chosen !== null ? 'chosen' : 'open';
}

/**
 * The outcome the control marks: the stored one always wins over the
 * address's, and after kick-off only a stored pick is one (an address cannot
 * claim a pick the API never took).
 */
export function markedOutcome(input: {
  locked: boolean;
  saved: PickOutcome | null;
  chosen: PickOutcome | null;
}): PickOutcome | null {
  if (input.saved !== null) return input.saved;
  return input.locked ? null : input.chosen;
}
