/**
 * Deciding which matches have a public discussion (blueprint 10.2, T-253).
 *
 * **An operator decides, and the decision has a name on it.** Every shape here
 * carries a `reason`, and none of them is optional: a panel opened for no stated
 * reason is one nobody can review, and the first time that matters is the first
 * time one goes wrong.
 */

/** One fixture's panel, as an operator sees it. */
export interface PanelRecord {
  fixture_id: string;
  /** Enough to recognise the match without a second request. */
  home: string;
  away: string;
  /** ISO 8601. */
  kickoff_at: string;
  /** Who opened it, and why. */
  opened_by: string;
  reason: string;
  /** ISO 8601. */
  opened_at: string;
  /** Null while it is open. */
  closed_at: string | null;
  closed_by: string | null;
  close_reason: string | null;
  /**
   * How many posts it holds, removed ones included.
   *
   * Counted rather than implied, because it is the number an operator weighs
   * before closing one: a panel with forty posts on it is a different decision
   * from a panel with none.
   */
  posts: number;
}

/** `GET /admin/panels?state=`. */
export interface PanelListResponse {
  /** ISO 8601, when this page was assembled. */
  generated_at: string;
  panels: PanelRecord[];
}

/** `POST /admin/fixtures/:id/panel` and `.../panel/close`. */
export interface PanelDecisionRequest {
  /** Recorded on the row and in the audit log; required. */
  reason: string;
}
