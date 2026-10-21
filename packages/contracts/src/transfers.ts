import type { Covered } from './coverage';

/**
 * Transfers as the data provider lists them (T-1440, D-231): the moves into
 * and out of a club, and a player's moves. Structured records from the
 * licensed feed, kept apart from news: a rumour or a story about a move stays
 * a typed story (D-123, D-166) and never becomes a line here.
 */

/**
 * What kind of move it was, read from the provider's word for it: a loan, the
 * end of one, a free move, a fee (`TransferLine.fee` keeps the provider's
 * text), a permanent move without a fee given, or a word we cannot read.
 */
export type TransferKind = 'loan' | 'loan_return' | 'free' | 'fee' | 'transfer' | 'unknown';

/**
 * A club on one side of a move. With an `id` it is one of ours, named as our
 * catalogue names it, and links to its page. Without one it is a club we do
 * not hold, named only as the provider wrote it: shown as plain text, never a
 * link and never matched to a club of ours (rule 1).
 */
export type TransferClub = { id: string; name: string } | { id: null; name: string };

export interface TransferLine {
  /** The day of the move, `YYYY-MM-DD`. */
  date: string;
  kind: TransferKind;
  /** The provider's fee as written ("€ 75M"), for `kind: 'fee'` only. */
  fee: string | null;
  /** The player: ours with an `id`, or the provider's name alone, as for a club. */
  player: { id: string; name: string } | { id: null; name: string };
  /** `null` when the provider names no club on that side (a player without one). */
  from: TransferClub | null;
  to: TransferClub | null;
}

/**
 * `GET /teams/:id/transfers`. `not_supplied` until the provider has been asked
 * about this club, and when it lists no move for it (`last_updated_at` then
 * says when it was asked); `delayed` when the last answer is older than the
 * job's refresh allows; `available` otherwise. Newest first in both lists,
 * at most `TEAM_TRANSFERS_SHOWN` each; the totals count them all.
 */
export interface TeamTransfers {
  /** Who listed these moves, for the page to say so ("API-Football"). */
  source_name: string;
  transfers: Covered<{
    arrivals: TransferLine[];
    departures: TransferLine[];
    arrivals_total: number;
    departures_total: number;
  }>;
}

/** How many arrivals and departures a club's section lists. */
export const TEAM_TRANSFERS_SHOWN = 25;

/**
 * `GET /players/:id/transfers`, newest first. `available` (or `delayed`) when
 * the provider was asked about this player himself; `limited` when it was not
 * yet, but the answers about clubs we follow list some of his moves -- only
 * those, so the history may have gaps; `not_supplied` when neither lists one.
 */
export interface PlayerTransfers {
  source_name: string;
  transfers: Covered<{ lines: TransferLine[] }>;
}
