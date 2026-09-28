import { isDeletedMember } from '@fmip/contracts';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';

/**
 * What a member is called on a page (T-908, D-094).
 *
 * A deleted account keeps a `deleted_` + 12 hex username and a stored
 * `display_name` of the English literal "Deleted member". Neither is shown:
 * the tombstone username is recognised by `isDeletedMember` (the contract's
 * rule, never a match on the stored name) and the member is called
 * `account.deletedMember` in the reader's language. This file and
 * `components/member-name.tsx` are the only places in `apps/web` that read a
 * member's `display_name` for display; `member-names.spec.ts` holds that.
 */
export interface NamedMember {
  username: string;
  /** Absent where a contract carries the username only (a leaderboard row, a message's author). */
  display_name?: string;
}

/** The name as plain text, for a title or a line built as a string. */
export function memberName(locale: string, member: NamedMember): string {
  if (isDeletedMember(member.username)) {
    return t(isLocale(locale) ? locale : DEFAULT_LOCALE, 'account.deletedMember');
  }
  return member.display_name ?? `@${member.username}`;
}

/** `@username`, or null for a deleted member: the tombstone is not a handle. */
export function memberHandle(username: string): string | null {
  return isDeletedMember(username) ? null : `@${username}`;
}

/** The member's profile, or null for a deleted member: there is nobody to open. */
export function memberProfileHref(locale: string, username: string): string | null {
  return isDeletedMember(username) ? null : `/${locale}/u/${encodeURIComponent(username)}`;
}
