import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FollowInviteLink } from '@/components/group-controls';
import { fetchInviteLinkPreview, fetchMe } from '@/lib/api';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * A link is a key: never indexed, and never sent onward in a `Referer` to
 * whatever the page links to.
 */
export const metadata: Metadata = {
  title: 'A group invitation · FMIP',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const DEAD: Record<string, string> = {
  revoked: 'This invite link was revoked.',
  expired: 'This invite link has expired.',
  exhausted: 'This invite link has been used as many times as it allows.',
  orphaned: 'Whoever made this invite link can no longer invite people to this group.',
};

/**
 * Following an invite link (blueprint 8.2, T-1021, D-132).
 *
 * Nothing is decided here. The API answers 404 for a link that does not exist
 * and for a dead link to a group nobody may find; a dead link to a group that
 * can be found comes back with its `state`, and the page says which kind of
 * dead it is. Following it is one button whose words follow the group's
 * visibility: a discoverable group is asked, not joined.
 */
export default async function GroupInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/group-invite/${token}`);

  const result = await fetchInviteLinkPreview(token, cookie);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">A group invitation</h1>
        <Notice tone="danger" data-testid="invite-link-unreachable">
          This invitation cannot be shown right now.
        </Notice>
      </main>
    );
  }

  const { group, state, follow, member } = result.data.preview;
  const groupHref = `/${locale}/groups/${encodeURIComponent(group.slug)}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold" data-testid="invite-link-group">
        {group.name}
      </h1>
      {group.description !== null && <p>{group.description}</p>}

      {member ? (
        <p className="text-sm" data-testid="invite-link-member">
          You are already in this group.{' '}
          <Link href={groupHref} className="underline">
            Open it
          </Link>
          .
        </p>
      ) : state !== 'live' ? (
        <Notice tone="danger" data-testid="invite-link-dead">
          {DEAD[state] ?? 'This invite link no longer works.'}
        </Notice>
      ) : (
        <>
          <p className="text-sm text-muted" data-testid="invite-link-how">
            {follow === 'join'
              ? 'This link lets you into the group.'
              : 'This group is joined by request. The link sends yours to the people who run it.'}
          </p>
          <FollowInviteLink locale={locale} token={token} follow={follow} />
        </>
      )}
    </main>
  );
}
