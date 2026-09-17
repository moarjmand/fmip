import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { GroupSummary } from '@fmip/contracts';
import { fetchGroupInvites, fetchGroups, fetchMe, fetchMyGroups } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Translated } from '@/components/translated';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({ locale, path: '/groups', title: 'Groups · FMIP' });
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

const VISIBILITY: Record<string, string> = {
  public: 'Anyone can join',
  discoverable: 'Ask to join',
  invite_only: 'By invitation',
};

function GroupRow({ group, locale }: { group: GroupSummary; locale: string }) {
  return (
    <li className="flex flex-col gap-1 border-s-2 border-s-current/20 ps-3">
      <Link
        href={`/${locale}/groups/${encodeURIComponent(group.slug)}`}
        className="font-medium underline"
      >
        {group.name}
      </Link>
      <p className="text-sm opacity-70">
        <Translated locale={locale} message="groups.memberCount" count={group.member_count} /> ·{' '}
        {VISIBILITY[group.visibility] ?? group.visibility}
      </p>
      {group.description !== null && <p className="text-sm">{group.description}</p>}
    </li>
  );
}

/**
 * The group directory (blueprint 8.2, T-242).
 *
 * **What is here is what can be found.** An invite-only group is absent — not
 * hidden by a filter on this page, but absent from the answer and from the
 * index behind it (T-240). A discoverable one is here with its name, its
 * description and how many members it has, and nothing about who they are:
 * found, not read, which is the whole reason there are three visibilities and
 * not two.
 */
export default async function GroupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login`);

  const term = first(query.q).trim();
  const [found, mine, invites] = await Promise.all([
    fetchGroups(term, cookie),
    fetchMyGroups(cookie),
    fetchGroupInvites(cookie),
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <h1 className="text-2xl font-semibold">Groups</h1>

      {invites.ok && invites.data.invites.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="group-invites">
          <h2 className="text-lg font-semibold">You have been invited</h2>
          <ul className="flex flex-col gap-3">
            {invites.data.invites.map((invite) => (
              <li key={invite.group.slug} className="flex flex-col gap-1">
                <Link
                  href={`/${locale}/groups/${encodeURIComponent(invite.group.slug)}`}
                  className="font-medium underline"
                >
                  {invite.group.name}
                </Link>
                <p className="text-sm opacity-70">Invited by @{invite.invited_by}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2" data-testid="my-groups">
        <h2 className="text-lg font-semibold">Yours</h2>
        {!mine.ok ? (
          <p role="alert" data-testid="my-groups-unreachable">
            Your groups cannot be shown right now.
          </p>
        ) : mine.data.groups.length === 0 ? (
          <p className="text-sm opacity-70" data-testid="my-groups-none">
            You are not in a group yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.data.groups.map((group) => (
              <GroupRow key={group.slug} group={group} locale={locale} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" data-testid="group-directory">
        <h2 className="text-lg font-semibold">Find a group</h2>
        <form action={`/${locale}/groups`} className="flex items-center gap-2">
          <label htmlFor="group-search" className="sr-only">
            Search groups
          </label>
          <input
            id="group-search"
            name="q"
            type="search"
            defaultValue={term}
            placeholder="Search groups"
            className="rounded border border-current/30 bg-transparent px-3 py-1 text-sm text-start"
            data-testid="group-search"
          />
          <button type="submit" className="text-sm underline">
            Search
          </button>
        </form>

        {!found.ok ? (
          <p role="alert" data-testid="group-directory-unreachable">
            The directory is unreachable right now.
          </p>
        ) : found.data.groups.length === 0 ? (
          <p className="text-sm opacity-70" data-testid="group-directory-none">
            {term === '' ? 'No groups yet.' : 'Nothing matches that.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {found.data.groups.map((group) => (
              <GroupRow key={group.slug} group={group} locale={locale} />
            ))}
          </ul>
        )}
        <p className="text-sm opacity-70" data-testid="group-directory-note">
          Groups that are joined by invitation are not listed here.
        </p>
      </section>
    </main>
  );
}
