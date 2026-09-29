import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { GroupSummary } from '@fmip/contracts';
import { fetchGroupInvites, fetchGroups, fetchMe, fetchMyGroups } from '@/lib/api';
import { languageName } from '@/lib/group-about';
import { DEFAULT_LOCALE, type Locale, UNFINISHED_LOCALES, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { MemberName } from '@/components/member-name';
import { Translated } from '@/components/translated';
import { Button, Notice, TextField, controlClasses } from '@/components/ui';

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

/** The languages the filter offers: the site's own, as the news filter does. */
const LANGUAGES: readonly string[] = ['en', ...UNFINISHED_LOCALES];

function GroupRow({ group, locale }: { group: GroupSummary; locale: string }) {
  const lang = group.language ?? undefined;
  return (
    <li className="flex flex-col gap-1 border-s-2 border-s-default ps-3">
      <Link
        href={`/${locale}/groups/${encodeURIComponent(group.slug)}`}
        className="font-medium underline"
        lang={lang}
      >
        {group.name}
      </Link>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="groups.memberCount" count={group.member_count} /> ·{' '}
        {VISIBILITY[group.visibility] ?? group.visibility}
        {group.language !== null && <> · {languageName(locale, group.language)}</>}
        {group.favourite !== null && <> · {group.favourite.name}</>}
      </p>
      {group.description !== null && (
        <p className="text-sm" lang={lang}>
          {group.description}
        </p>
      )}
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

  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const term = first(query.q).trim();
  // The directory's filters (T-1022) go to the API as they came; what it
  // could read comes back in `filters`, and that is what the page shows.
  const filterQuery = {
    language: first(query.language).trim(),
    team: first(query.team).trim(),
    competition: first(query.competition).trim(),
  };
  const [found, mine, invites] = await Promise.all([
    fetchGroups(term, cookie, filterQuery),
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
                <p className="text-sm text-muted">
                  Invited by <MemberName locale={locale} member={{ username: invite.invited_by }} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2" data-testid="my-groups">
        <h2 className="text-lg font-semibold">Yours</h2>
        {!mine.ok ? (
          <Notice tone="danger" data-testid="my-groups-unreachable">
            Your groups cannot be shown right now.
          </Notice>
        ) : mine.data.groups.length === 0 ? (
          <p className="text-sm text-muted" data-testid="my-groups-none">
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
        <form action={`/${locale}/groups`} className="flex flex-wrap items-center gap-2">
          {filterQuery.team !== '' && <input type="hidden" name="team" value={filterQuery.team} />}
          {filterQuery.competition !== '' && (
            <input type="hidden" name="competition" value={filterQuery.competition} />
          )}
          <label className="flex items-center gap-2 text-sm">
            <Translated locale={locale} message="groups.filter.language" />
            <select
              name="language"
              defaultValue={filterQuery.language}
              className={controlClasses('sm')}
              data-testid="group-language-filter"
            >
              {/* An <option> holds text, not markup, so the words come as text. */}
              <option value="">{t(resolved, 'groups.filter.anyLanguage')}</option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {languageName(locale, language)}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Search groups"
            hideLabel
            id="group-search"
            name="q"
            type="search"
            size="sm"
            defaultValue={term}
            placeholder="Search groups"
            data-testid="group-search"
          />
          <Button type="submit" variant="ghost" size="sm">
            Search
          </Button>
        </form>

        {found.ok && found.data.filters?.favourite != null && (
          <p className="text-sm" data-testid="group-favourite-filter">
            <Translated locale={locale} message="groups.filter.showing" />{' '}
            {found.data.filters.favourite.name} ·{' '}
            <Link href={`/${locale}/groups`} className="underline">
              <Translated locale={locale} message="groups.filter.clear" />
            </Link>
          </p>
        )}

        {!found.ok ? (
          <Notice tone="danger" data-testid="group-directory-unreachable">
            The directory is unreachable right now.
          </Notice>
        ) : found.data.groups.length === 0 ? (
          <p className="text-sm text-muted" data-testid="group-directory-none">
            {term === '' ? 'No groups yet.' : 'Nothing matches that.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {found.data.groups.map((group) => (
              <GroupRow key={group.slug} group={group} locale={locale} />
            ))}
          </ul>
        )}
        <p className="text-sm text-muted" data-testid="group-directory-note">
          Groups that are joined by invitation are not listed here.
        </p>
      </section>
    </main>
  );
}
