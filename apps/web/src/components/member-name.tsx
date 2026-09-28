import Link from 'next/link';
import { isDeletedMember } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { memberProfileHref, type NamedMember } from '@/lib/member-name';

/**
 * A member's name on a page (T-908): the display name, a link to the profile
 * when `link` is set, and for a deleted account "a deleted member" from the
 * catalogue, with no link and no handle. See `lib/member-name.ts`.
 */
export function MemberName({
  locale,
  member,
  link = false,
  className,
}: {
  locale: string;
  member: NamedMember;
  link?: boolean;
  className?: string;
}) {
  if (isDeletedMember(member.username)) {
    return (
      <span className={className} data-member="deleted">
        <Translated locale={locale} message="account.deletedMember" />
      </span>
    );
  }
  const name = member.display_name ?? `@${member.username}`;
  const href = memberProfileHref(locale, member.username);
  return link && href !== null ? (
    <Link href={href} className={className}>
      {name}
    </Link>
  ) : (
    <span className={className}>{name}</span>
  );
}

/** `@username` beside a name; nothing for a deleted member. */
export function MemberHandle({ username, className }: { username: string; className?: string }) {
  if (isDeletedMember(username)) return null;
  return <span className={className}>@{username}</span>;
}
