import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FollowInviteLink } from '@/components/group-controls';
import { fetchInviteLinkPreview, fetchMe } from '@/lib/api';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { type MessageKey, t } from '@/i18n/messages';

export const dynamic = 'force-dynamic';

/**
 * A link is a key: never indexed, and never sent onward in a `Referer` to
 * whatever the page links to.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return {
    title: `${t(resolved, 'groupsPage.invite.title')} · FMIP`,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

const DEAD: Record<string, MessageKey> = {
  revoked: 'groupsPage.invite.revoked',
  expired: 'groupsPage.invite.expired',
  exhausted: 'groupsPage.invite.exhausted',
  orphaned: 'groupsPage.invite.orphaned',
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
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="groupsPage.invite.title" />
        </h1>
        <Notice tone="danger" data-testid="invite-link-unreachable">
          <Translated locale={locale} message="groupsPage.invite.unreachable" />
        </Notice>
      </main>
    );
  }

  const { group, state, follow, member, rules } = result.data.preview;
  const groupHref = `/${locale}/groups/${encodeURIComponent(group.slug)}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1
        className="text-2xl font-semibold"
        data-testid="invite-link-group"
        lang={group.language ?? undefined}
      >
        {group.name}
      </h1>
      {group.description !== null && <p lang={group.language ?? undefined}>{group.description}</p>}

      {member ? (
        <p className="text-sm" data-testid="invite-link-member">
          <Translated locale={locale} message="groupsPage.invite.member" />{' '}
          <Link href={groupHref} className="underline">
            <Translated locale={locale} message="groupsPage.invite.open" />
          </Link>
          .
        </p>
      ) : state !== 'live' ? (
        <Notice tone="danger" data-testid="invite-link-dead">
          <Translated locale={locale} message={DEAD[state] ?? 'groupsPage.invite.dead'} />
        </Notice>
      ) : (
        <>
          <p className="text-sm text-muted" data-testid="invite-link-how">
            <Translated
              locale={locale}
              message={follow === 'join' ? 'groupsPage.invite.join' : 'groupsPage.invite.ask'}
            />
          </p>
          {rules !== null && (
            <section className="flex flex-col gap-2" data-testid="invite-link-rules">
              <h2 className="text-lg font-semibold">
                <Translated locale={locale} message="groupsPage.rulesTitle" />
              </h2>
              <p className="whitespace-pre-line text-sm" lang={group.language ?? undefined}>
                {rules.body}
              </p>
              <p className="text-sm text-muted">
                <Translated locale={locale} message="groupsPage.invite.rulesWhose" />
              </p>
            </section>
          )}
          <FollowInviteLink
            locale={locale}
            token={token}
            follow={follow}
            rulesVersion={rules?.version ?? null}
          />
        </>
      )}
    </main>
  );
}
