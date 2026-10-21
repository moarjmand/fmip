/**
 * How often a club's or a player's transfers are asked for again (T-1440,
 * D-231): weekly while a transfer window is open, monthly otherwise. Shared by
 * the job that asks and the read that says when an answer is behind, so both
 * use one calendar.
 *
 * The windows are the European ones most of our competitions follow, widened
 * a little: 1 June to 15 September and 1 January to 15 February (UTC). A
 * league whose window differs is asked monthly in its own window, which is
 * slower, not wrong.
 */

/** Whether a transfer window is open on this day (UTC). Pure. */
export function inTransferWindow(at: Date): boolean {
  const month = at.getUTCMonth() + 1;
  const date = at.getUTCDate();
  if (month >= 6 && month <= 8) return true;
  if (month === 9) return date <= 15;
  if (month === 1) return true;
  return month === 2 && date <= 15;
}

export const TRANSFERS_REFRESH_DAYS_IN_WINDOW = 7;
export const TRANSFERS_REFRESH_DAYS_OUTSIDE = 30;

/** How many days an answer stands before it is asked for again. Pure. */
export function transfersRefreshDays(at: Date): number {
  return inTransferWindow(at) ? TRANSFERS_REFRESH_DAYS_IN_WINDOW : TRANSFERS_REFRESH_DAYS_OUTSIDE;
}
