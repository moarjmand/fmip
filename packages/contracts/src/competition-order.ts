// ---------------------------------------------------------------------------
// The competitions' order in the console (T-1162, D-154): where each
// competition sits on the scores page and the homepage after a member's
// favourites (`competition.display_order`, T-504), set by an administrator
// with a reason instead of `catalog.mjs --set-order` on the server. The
// script keeps working; both write the same audited change.
// ---------------------------------------------------------------------------

/** The highest place a competition can be given (the column is a `smallint`). */
export const COMPETITION_ORDER_MAX = 32767;

/** One competition as the console lists it, in the order readers meet them. */
export interface AdminCompetition {
  id: string;
  name: string;
  short_name: string | null;
  /** The country's name; `null` for an international competition. */
  country: string | null;
  /** Its stated place, 1 first; `null` when none is stated (then by country and name, after the stated ones). */
  display_order: number | null;
  is_active: boolean;
}

/** `GET /admin/competitions`: every competition, stated places first, then by country and name. */
export interface AdminCompetitionsResponse {
  competitions: AdminCompetition[];
}

/** `PUT /admin/competitions/:id/order`: `order` 1 first, `null` to clear it; audited with the reason. */
export interface SetCompetitionOrderRequest {
  order: number | null;
  reason: string;
}

export interface SetCompetitionOrderResponse {
  previous: number | null;
  next: number | null;
  audit_id: string;
}
