import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import type { CompetitionDirectoryEntry, SearchType } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { menuAnswers } from '@/components/competitions-menu';
import { EntityImage } from '@/components/entity-image';
import { MemberHandle, MemberName } from '@/components/member-name';
import { shellReader } from '@/components/site-header';
import { Translated } from '@/components/translated';
import { formatNumber } from '@/i18n/format';
import { attribute } from '@/i18n/messages';
import { fetchAsk, fetchSearch } from '@/lib/api';
import { pageLocale, say } from '@/lib/competition';
import { storyHref } from '@/lib/news';
import { readerTimeZone } from '@/lib/reader-time-zone';
import {
  GROUP_VISIBILITY_KEY,
  MIN_QUERY_LENGTH,
  RESULT_IMAGE_KIND,
  SECTION_TITLE_KEY,
  apiQuery,
  communityQuery,
  entityQuery,
  entitySections,
  groupHref,
  keywordsAsAsked,
  matchNote,
  noneLine,
  ofType,
  readSearchTerm,
  resultHref,
  resultLine,
  searchChips,
  splitSections,
} from '@/lib/search';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader, readerAddress } from '@/lib/session';
import { Button, Notice, TextField } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** A result's link: a 44px target on a phone, the line's own height from 768px (T-1574). */
const RESULT_LINK = 'inline-flex min-h-touch items-center font-medium underline md:min-h-0';
/** A chip on the empty page (T-1803): a 44px link with the competition's logo. */
const CHIP =
  'inline-flex min-h-touch items-center gap-2 rounded-pill border border-default px-3 text-sm font-semibold hover:border-strong';

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
    title: `${say(locale, 'nav.search')} · Stadiomind`,
    description: say(locale, 'searchPage.metaDescription'),
    index: readSearchTerm(query) === '',
  });
}

/** One kind's section with what it found: its heading and count, then its rows (T-1803: a kind with none has no section). */
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
        <span className="font-normal text-muted"> · {formatNumber(locale, count)}</span>
      </h2>
      <ol className="flex flex-col divide-y divide-default">{children}</ol>
    </section>
  );
}

/** A heading and a row of competition chips, each a link to its page. */
function Chips({
  locale,
  id,
  heading,
  competitions,
  more,
}: {
  locale: string;
  id: string;
  heading: ReactNode;
  competitions: readonly CompetitionDirectoryEntry[];
  more?: boolean;
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby={id} data-testid={id}>
      <h2 id={id} className="text-sm font-semibold text-muted">
        {heading}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {competitions.map((c) => (
          <li key={c.id}>
            <Link
              href={`/${locale}/competition/${c.id}`}
              className={CHIP}
              data-testid="search-chip"
            >
              <EntityImage media={c.logo} kind="logo" name={c.name} size={20} />
              <bdi>{c.name}</bdi>
            </Link>
          </li>
        ))}
        {more === true && (
          <li>
            <Link href={`/${locale}/competitions`} className={`${CHIP} text-muted`}>
              <Translated locale={locale} message="searchPage.allCompetitions" />
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

/**
 * The chip lists as they are now, from the competitions menu's own answers
 * (shared for a few seconds between readers). A plain function, not a
 * component: it reads the clock.
 */
async function loadChips(locale: string, timeZone: string) {
  const { directory, scores } = await menuAnswers(locale, timeZone, Date.now());
  return searchChips(directory, scores, pageLocale(locale));
}

/** "Nothing matches “zzqxv”", the term isolated from the sentence around it. */
function nothingHeading(locale: string, term: string): ReactNode {
  const [before = '', after = ''] = say(locale, 'searchPage.nothing', { term: '\u0000' }).split(
    '\u0000',
  );
  return (
    <>
      {before}
      <bdi>{term}</bdi>
      {after}
    </>
  );
}

/**
 * Search (T-038, T-642): teams, competitions and players by name or alias
 * from `/ask`, and news stories, findable groups and public members from
 * `GET /search`. The form is a plain GET so the URL is the state; an
 * unreachable API is said out loud, never shown as "no results". Its words
 * come from the catalogue (T-1304).
 *
 * T-1803 (D-401): a team's second line says where it plays; a kind with no
 * hit is named in one line instead of a section of its own, and nothing found
 * anywhere is one heading and the big five; the empty page offers the big
 * five and today's competitions, from the site's own lists. How the question
 * was read -- or why it was searched as keywords -- is the search's plumbing
 * and is no longer printed; it stays on the results as `data-reason`.
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query, { session, guest }] = await Promise.all([
    params,
    searchParams,
    shellReader(),
  ]);
  const lang = pageLocale(locale);
  const term = readSearchTerm(query);
  const ask = apiQuery(term);
  const community = communityQuery(term);
  // Read by the model when there is one (T-421); the search's own rows either
  // way. The session only hides members on either side of a block.
  const [cookie, clientIp] = await Promise.all([sessionCookieHeader(), readerAddress()]);
  const [asked, found] =
    ask === null || community === null
      ? [null, null]
      : await Promise.all([fetchAsk(term, { cookie, clientIp }), fetchSearch(community, cookie)]);
  // Past the ceiling on the model's questions (T-838) the question is searched
  // as keywords instead -- no model, no ceiling -- and the refusal's sentence
  // is shown beside the rows, so a shared address never leaves a reader
  // without a search.
  const limited = asked !== null && !asked.ok && asked.status === 429 ? asked : null;
  const keywords = limited === null ? null : entityQuery(term);
  const result =
    keywords === null
      ? asked
      : await fetchSearch(keywords, cookie).then((plain) =>
          plain.ok ? { ...plain, data: keywordsAsAsked(term, plain.data) } : plain,
        );

  const entity = result !== null && result.ok ? result.data : null;
  const stories = found?.ok === true ? found.data.stories : null;
  const groups = found?.ok === true ? found.data.groups : null;
  const members = found?.ok === true ? found.data.members : null;
  const communityRead = stories !== null && groups !== null && members !== null;
  const { shown, none } = splitSections([
    ...(entity === null
      ? []
      : entitySections(entity.interpretation.data?.types ?? null).map((type) => ({
          type,
          count: ofType(entity.results, type).length,
        }))),
    ...(stories === null || groups === null || members === null
      ? []
      : [
          { type: 'story' as const, count: stories.length },
          { type: 'group' as const, count: groups.length },
          { type: 'member' as const, count: members.length },
        ]),
  ]);
  const nothingAtAll = ask !== null && entity !== null && communityRead && shown.length === 0;

  // The chips are asked for only where the page shows them.
  const chips =
    term === '' || nothingAtAll
      ? await loadChips(locale, readerTimeZone(locale, session?.user ?? null, guest))
      : null;

  const field = attribute(lang, 'searchPage.field');
  const noneText = noneLine(locale, none);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={locale} message="nav.search" />
      </h1>

      <form action={`/${locale}/search`} method="get" className="flex gap-2" role="search">
        <TextField
          label={field.text}
          hideLabel
          id="search-term"
          name="q"
          type="search"
          defaultValue={term}
          placeholder={field.text}
          lang={field.lang}
          autoComplete="off"
          className="grow"
          data-testid="search-input"
        />
        <Button type="submit" size="md">
          <Translated locale={locale} message="nav.search" />
        </Button>
      </form>

      {limited !== null && (
        <Notice tone="warning" data-testid="search-limited">
          {limited.error?.message ?? say(locale, 'searchPage.limited')}{' '}
          <Translated locale={locale} message="searchPage.keywordsInstead" />
        </Notice>
      )}

      {ask === null ? (
        <>
          <p className="text-sm text-muted" data-testid="search-hint">
            {term === '' ? (
              <Translated locale={locale} message="searchPage.hint" />
            ) : (
              <Translated locale={locale} message="searchPage.minLength" count={MIN_QUERY_LENGTH} />
            )}
          </p>
          {chips !== null && chips.bigFive.length > 0 && (
            <Chips
              locale={locale}
              id="search-big-five"
              heading={<Translated locale={locale} message="competitionsMenu.region.bigFive" />}
              competitions={chips.bigFive}
            />
          )}
          {chips !== null && chips.today !== null && chips.today.length > 0 && (
            <Chips
              locale={locale}
              id="search-today"
              heading={<Translated locale={locale} message="searchPage.playingToday" />}
              competitions={chips.today}
              more={chips.more}
            />
          )}
        </>
      ) : nothingAtAll ? (
        <section
          className="flex flex-col gap-3"
          data-testid="search-nothing"
          data-reason={entity?.reason ?? 'read'}
        >
          <h2 className="text-lg font-semibold">{nothingHeading(locale, term)}</h2>
          <p className="text-sm text-muted">
            <Translated locale={locale} message="searchPage.tryThese" />
          </p>
          {chips !== null && chips.bigFive.length > 0 && (
            <Chips
              locale={locale}
              id="search-big-five"
              heading={<Translated locale={locale} message="competitionsMenu.region.bigFive" />}
              competitions={chips.bigFive}
            />
          )}
          <p className="text-xs text-muted">
            <Translated locale={locale} message="searchPage.neverListed" />
          </p>
        </section>
      ) : (
        <>
          {entity === null ? (
            <Notice tone="danger" data-testid="search-unreachable">
              <Translated locale={locale} message="searchPage.unreachable" />
            </Notice>
          ) : (
            <div
              className="flex flex-col gap-6"
              data-testid="search-results"
              data-reason={entity.reason ?? 'read'}
            >
              {entitySections(entity.interpretation.data?.types ?? null)
                .filter((type) => shown.includes(type))
                .map((type) => {
                  const hits = ofType(entity.results, type);
                  return (
                    <Section key={type} locale={locale} type={type} count={hits.length}>
                      {hits.map((hit) => {
                        const line = resultLine(locale, hit);
                        return (
                          <li
                            key={hit.id}
                            className="flex flex-wrap items-center gap-x-3 py-2"
                            data-testid="search-result"
                          >
                            {/* The crest, logo or photo we hold, or the lettered mark (T-1617). */}
                            <EntityImage
                              media={hit.image}
                              kind={RESULT_IMAGE_KIND[hit.type]}
                              name={hit.name}
                              size={22}
                            />
                            <Link href={resultHref(locale, hit)} className={RESULT_LINK}>
                              {hit.name}
                            </Link>
                            {line.length > 0 && (
                              <span className="text-sm text-muted" data-testid="search-line">
                                {line.map((part, i) => (
                                  <span key={i}>
                                    {i > 0 && ' · '}
                                    <bdi>{part}</bdi>
                                  </span>
                                ))}
                              </span>
                            )}
                            {matchNote(locale, hit) !== null && (
                              <span className="text-xs text-muted" data-testid="search-alias">
                                {matchNote(locale, hit)}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </Section>
                  );
                })}
            </div>
          )}

          {stories === null || groups === null || members === null ? (
            <Notice tone="danger" data-testid="search-community-unreachable">
              <Translated locale={locale} message="search.communityUnreachable" />
            </Notice>
          ) : !(['story', 'group', 'member'] as const).some((type) =>
              shown.includes(type),
            ) ? null : (
            <div className="flex flex-col gap-6" data-testid="search-community">
              {shown.includes('story') && (
                <Section locale={locale} type="story" count={stories.length}>
                  {stories.map((story) => (
                    <li
                      key={story.story_id}
                      className="flex flex-wrap items-baseline gap-x-3 py-2"
                      data-testid="search-story"
                    >
                      <Link
                        href={storyHref(locale, story.story_id, story.language)}
                        className={RESULT_LINK}
                        lang={story.language}
                        dir="auto"
                      >
                        {story.headline}
                      </Link>
                      <span className="text-sm text-muted">{story.source_name}</span>
                    </li>
                  ))}
                </Section>
              )}
              {shown.includes('group') && (
                <Section locale={locale} type="group" count={groups.length}>
                  {groups.map((group) => (
                    <li
                      key={group.slug}
                      className="flex flex-wrap items-baseline gap-x-3 py-2"
                      data-testid="search-group"
                    >
                      <Link href={groupHref(locale, group.slug)} className={RESULT_LINK}>
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
              )}
              {shown.includes('member') && (
                <Section locale={locale} type="member" count={members.length}>
                  {members.map((member) => (
                    <li
                      key={member.username}
                      className="flex flex-wrap items-baseline gap-x-3 py-2"
                      data-testid="search-member"
                    >
                      <MemberName
                        locale={locale}
                        member={member}
                        link
                        className="font-medium underline"
                      />
                      <MemberHandle username={member.username} className="text-sm text-muted" />
                    </li>
                  ))}
                </Section>
              )}
            </div>
          )}

          {noneText !== null && (
            <p className="text-sm text-muted" data-testid="search-none">
              {noneText}
            </p>
          )}
        </>
      )}
    </main>
  );
}
