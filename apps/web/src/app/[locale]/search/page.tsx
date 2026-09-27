import type { Metadata } from 'next';
import Link from 'next/link';
import type { AskReason, SearchType } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { Translated } from '@/components/translated';
import type { MessageKey } from '@/i18n/messages';
import { fetchAsk, fetchSearch } from '@/lib/api';
import { storyHref } from '@/lib/news';
import {
  GROUP_VISIBILITY_KEY,
  MIN_QUERY_LENGTH,
  SECTION_EMPTY_KEY,
  SECTION_TITLE_KEY,
  TYPE_LABEL,
  apiQuery,
  communityQuery,
  entitySections,
  groupHref,
  matchNote,
  memberHref,
  ofType,
  readSearchTerm,
  resultHref,
} from '@/lib/search';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Button, Notice, TextField } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Why the question was searched as keywords (T-422), as a sentence beside the results. */
const REASON_KEY: Record<AskReason, MessageKey> = {
  no_model: 'search.reason.noModel',
  unreadable: 'search.reason.unreadable',
  nothing_named: 'search.reason.nothingNamed',
  failed: 'search.reason.failed',
};

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  // The empty form is a page; a result list is not, so it is never indexed.
  return pageMetadata({
    locale,
    path: '/search',
    title: 'Search · FMIP',
    description:
      'Find teams, competitions, players, news, groups and members by name, alias or another spelling.',
    index: readSearchTerm(query) === '',
  });
}

/** One kind's section: its heading, then its rows or its own sentence for none. */
function Section({
  locale,
  type,
  count,
  children,
}: {
  locale: string;
  type: SearchType;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={`search-section-${type}`}>
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message={SECTION_TITLE_KEY[type]} />
      </h2>
      {count === 0 ? (
        <p className="text-sm text-muted" data-testid="search-section-empty">
          <Translated locale={locale} message={SECTION_EMPTY_KEY[type]} />
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-default">{children}</ol>
      )}
    </section>
  );
}

/**
 * Search (T-038, T-642): teams, competitions and players by name or alias
 * from `/ask`, and news stories, findable groups and public members from
 * `GET /search`, each kind in its own section with its own sentence when
 * nothing matched. The form is a plain GET so the URL is the state; an
 * unreachable API is said out loud, never shown as "no results".
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const term = readSearchTerm(query);
  const ask = apiQuery(term);
  const community = communityQuery(term);
  // Read by the model when there is one (T-421); the search's own rows either
  // way. The session only hides members on either side of a block.
  const [result, found] =
    ask === null || community === null
      ? [null, null]
      : await Promise.all([
          fetchAsk(term),
          sessionCookieHeader().then((cookie) => fetchSearch(community, cookie)),
        ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        Search
      </h1>

      <form action={`/${locale}/search`} method="get" className="flex gap-2" role="search">
        <TextField
          label="Team, competition, player, news, group or member"
          hideLabel
          id="search-term"
          name="q"
          type="search"
          defaultValue={term}
          placeholder="Team, competition, player, news, group or member"
          autoComplete="off"
          className="grow"
          data-testid="search-input"
        />
        <Button type="submit" size="md">
          Search
        </Button>
      </form>

      {result !== null && result.ok && (
        <p
          className="text-sm text-muted"
          data-testid="search-reading"
          data-reason={result.data.reason ?? 'read'}
        >
          {result.data.interpretation.data !== null ? (
            <>
              <Translated locale={locale} message="search.readAs" />{' '}
              {result.data.interpretation.data.names.join(', ')}
              {result.data.interpretation.data.types.length > 0 && (
                <>
                  {' · '}
                  <Translated locale={locale} message="search.kinds" />{' '}
                  {result.data.interpretation.data.types.map((type) => TYPE_LABEL[type]).join(', ')}
                </>
              )}
            </>
          ) : result.data.reason !== null ? (
            <Translated locale={locale} message={REASON_KEY[result.data.reason]} />
          ) : null}
        </p>
      )}

      {ask === null ? (
        <p className="text-sm text-muted" data-testid="search-hint">
          {term === ''
            ? 'Type a name, an abbreviation, a headline or a spelling in another language.'
            : `Type at least ${MIN_QUERY_LENGTH} characters.`}
        </p>
      ) : (
        <>
          {result === null || !result.ok ? (
            <Notice tone="danger" data-testid="search-unreachable">
              The service is unreachable right now, so nothing can be searched.
            </Notice>
          ) : (
            <div className="flex flex-col gap-6" data-testid="search-results">
              {entitySections(result.data.interpretation.data?.types ?? null).map((type) => {
                const hits = ofType(result.data.results, type);
                return (
                  <Section key={type} locale={locale} type={type} count={hits.length}>
                    {hits.map((hit) => (
                      <li
                        key={hit.id}
                        className="flex flex-wrap items-baseline gap-x-3 py-2"
                        data-testid="search-result"
                      >
                        <Link href={resultHref(locale, hit)} className="font-medium underline">
                          {hit.name}
                        </Link>
                        {hit.secondary !== null && (
                          <span className="text-sm text-muted">{hit.secondary}</span>
                        )}
                        {matchNote(hit) !== null && (
                          <span className="text-xs text-muted" data-testid="search-alias">
                            {matchNote(hit)}
                          </span>
                        )}
                      </li>
                    ))}
                  </Section>
                );
              })}
            </div>
          )}

          {found === null ||
          !found.ok ||
          found.data.stories === null ||
          found.data.groups === null ||
          found.data.members === null ? (
            <Notice tone="danger" data-testid="search-community-unreachable">
              <Translated locale={locale} message="search.communityUnreachable" />
            </Notice>
          ) : (
            <div className="flex flex-col gap-6" data-testid="search-community">
              <Section locale={locale} type="story" count={found.data.stories.length}>
                {found.data.stories.map((story) => (
                  <li
                    key={story.story_id}
                    className="flex flex-wrap items-baseline gap-x-3 py-2"
                    data-testid="search-story"
                  >
                    <Link
                      href={storyHref(locale, story.story_id, story.language)}
                      className="font-medium underline"
                      lang={story.language}
                    >
                      {story.headline}
                    </Link>
                    <span className="text-sm text-muted">{story.source_name}</span>
                  </li>
                ))}
              </Section>
              <Section locale={locale} type="group" count={found.data.groups.length}>
                {found.data.groups.map((group) => (
                  <li
                    key={group.slug}
                    className="flex flex-wrap items-baseline gap-x-3 py-2"
                    data-testid="search-group"
                  >
                    <Link href={groupHref(locale, group.slug)} className="font-medium underline">
                      {group.name}
                    </Link>
                    <span className="text-sm text-muted">
                      <Translated
                        locale={locale}
                        message={GROUP_VISIBILITY_KEY[group.visibility]}
                      />
                    </span>
                  </li>
                ))}
              </Section>
              <Section locale={locale} type="member" count={found.data.members.length}>
                {found.data.members.map((member) => (
                  <li
                    key={member.username}
                    className="flex flex-wrap items-baseline gap-x-3 py-2"
                    data-testid="search-member"
                  >
                    <Link
                      href={memberHref(locale, member.username)}
                      className="font-medium underline"
                    >
                      {member.display_name}
                    </Link>
                    <span className="text-sm text-muted">@{member.username}</span>
                  </li>
                ))}
              </Section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
