import type {
  AdminUser,
  ContributorFlag,
  PredictionHistoryItem,
  SettlementVoidReason,
} from '@fmip/contracts';

/**
 * A member's page in the console (blueprint 16, T-1164): account status,
 * rating history and tier, settlements, Career Points, eligibility and grants,
 * sanctions and flags, and the audit rows about them, on one page.
 *
 * Every section is an answer the API already gives an administrator; this
 * page adds no read of its own and no write. Where the API gives an
 * administrator no more than any other viewer -- a member's private
 * prediction history -- the page says so rather than reaching around it.
 * Pure, so the choices are tested without a page.
 */

/** How many predictions the settlements section reads; the member's own pages have the rest. */
export const MEMBER_SETTLEMENTS = 30;

/**
 * The account the page is about: the search result whose username is exactly
 * the one in the address. Search matches on parts of names and e-mails, so
 * "ali" would also find "alice"; only an exact username is this member.
 */
export function exactMember(users: readonly AdminUser[], username: string): AdminUser | null {
  const wanted = username.toLowerCase();
  return users.find((user) => user.username.toLowerCase() === wanted) ?? null;
}

/** A deleted account is an anonymous tombstone (D-094): shown as one, never as a member. */
export function isTombstone(user: AdminUser): boolean {
  return user.status === 'deleted';
}

export interface SettlementRow {
  fixtureId: string;
  match: string;
  competition: string;
  kickoffAt: string;
  status: 'settled' | 'void';
  voidReason: SettlementVoidReason | null;
  outcomeCorrect: boolean | null;
  scoreCorrect: boolean | null;
  settledAt: string;
}

/**
 * The stored settlements among the predictions read, newest kick-off first
 * as the history gives them. A prediction not yet settled is not a
 * settlement and is left out; nothing is recomputed here (T-052's rows).
 */
export function settlementRows(items: readonly PredictionHistoryItem[]): SettlementRow[] {
  return items.flatMap(({ fixture, prediction }) => {
    const s = prediction.settlement;
    if (s === null) return [];
    return [
      {
        fixtureId: fixture.id,
        match: `${fixture.home.name} v ${fixture.away.name}`,
        competition: fixture.competition.name,
        kickoffAt: fixture.kickoff_at,
        status: s.status,
        voidReason: s.void_reason,
        outcomeCorrect: s.outcome_correct,
        scoreCorrect: s.score_correct,
        settledAt: s.settled_at,
      },
    ];
  });
}

/** The contributor flags raised on this member, from the console's list of them. */
export function flagsOf(flags: readonly ContributorFlag[], username: string): ContributorFlag[] {
  const wanted = username.toLowerCase();
  return flags.filter((flag) => flag.username.toLowerCase() === wanted);
}

/** `yes`, `no`, or `—` where the question does not apply (a void match, no exact score predicted). */
export function yesNo(value: boolean | null): string {
  return value === null ? '—' : value ? 'yes' : 'no';
}
