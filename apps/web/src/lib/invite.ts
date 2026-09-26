import { canonicalUrl } from './seo';

/**
 * Invite links (T-522): a member's link to the registration page, and what a
 * sign-up through it is offered afterwards -- the inviter's profile, with its
 * own friend-request control and a sentence saying why it is there. The new
 * member may ignore it; nothing is sent on their behalf.
 *
 * Nothing is stored and nothing is counted: the link carries the inviter's
 * public username and no more, there is no reward for inviting and no table
 * of inviters (blueprint 1.5 -- a rating is earned by predicting).
 */

/** Mirrors the API's username rule (`identity/internal/validation.ts`). */
const USERNAME = /^[a-z0-9_]{3,20}$/;

/** The inviter a registration link names, or `null` for none or nonsense. */
export function readInviter(value: string | string[] | undefined): string | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
  return raw !== undefined && USERNAME.test(raw) ? raw : null;
}

/** A member's invite link: the registration page naming them. */
export function inviteUrl(locale: string, username: string, origin?: string): string {
  return `${canonicalUrl(locale, '/register', origin)}?invited_by=${encodeURIComponent(username)}`;
}

/**
 * Where a new account goes: the inviter's profile when someone else invited
 * them, their own otherwise.
 */
export function afterRegistration(
  locale: string,
  username: string,
  inviter: string | null,
): string {
  return inviter !== null && inviter !== username
    ? `/${locale}/u/${encodeURIComponent(inviter)}?invited=1`
    : `/${locale}/u/${encodeURIComponent(username)}`;
}
