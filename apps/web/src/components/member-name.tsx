import Link from '@/components/ui/link';
import { isDeletedMember } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { memberProfileHref, type NamedMember } from '@/lib/member-name';

/**
 * A member's name on a page (T-908): the display name, a link to the profile
 * when `link` is set, and for a deleted account "a deleted member" from the
 * catalogue, with no link and no handle. See `lib/member-name.ts`.
 *
 * The name is the member's own words, so it is isolated (T-1975): a display
 * name in `<bdi>` (its direction from its first letter), a handle in
 * `<bdi dir="ltr">`, so `@ali_fan` keeps its `@` in front on a Persian page
 * and a Persian name does not turn an English line around.
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
  const displayName = member.display_name ?? null;
  const name =
    displayName === null ? <bdi dir="ltr">@{member.username}</bdi> : <bdi>{displayName}</bdi>;
  const href = memberProfileHref(locale, member.username);
  return link && href !== null ? (
    <Link href={href} className={className}>
      {name}
    </Link>
  ) : (
    <span className={className}>{name}</span>
  );
}

/**
 * `@username` beside a name; nothing for a deleted member. Left to right in
 * its own isolate (T-1975), so a Persian line shows `@ali_fan`, not `ali_fan@`.
 * The isolate sits inside the span, so the span keeps the page's direction for
 * its alignment and its logical margins.
 */
export function MemberHandle({ username, className }: { username: string; className?: string }) {
  if (isDeletedMember(username)) return null;
  return (
    <span className={className}>
      <bdi dir="ltr">@{username}</bdi>
    </span>
  );
}
