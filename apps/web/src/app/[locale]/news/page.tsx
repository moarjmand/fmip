import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { NEWS_SECTIONS, STORY_TYPES, type NewsSection, type NewsStoryCard } from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
import { SaveArticle } from '@/components/save-article';
import { Translated } from '@/components/translated';
import { formatAgo, formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, UNFINISHED_LOCALES, isLocale } from '@/i18n/locales';
import { type MessageKey, t } from '@/i18n/messages';
import {
  fetchCompetitions,
  fetchCountries,
  fetchDebates,
  fetchMe,
  fetchNewsSection,
  fetchPlayer,
  fetchSavedArticles,
  fetchTeams,
} from '@/lib/api';
import { clearBreakingAction, markBreakingAction } from '@/lib/breaking-actions';
import { clearDebateAction, selectDebateAction } from '@/lib/debate-actions';
import {
  type NewsPageQuery,
  REASON_KEY,
  SECTION_KEY,
  STORY_TYPE_KEY,
  apiQuery,
  feedsStale,
  frontPage,
  isFiltered,
  pageHref,
  readNewsQuery,
  recentAge,
} from '@/lib/news';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Button, ButtonLink, Notice, controlClasses } from '@/components/ui';
import { SectionTabs } from '@/components/ui/section-tabs';
import { NewsStory } from '@/components/news-story';
import { pageTimeZone } from '@/lib/reader-time-zone-server';

export const dynamic = 'force-dynamic';

/** The languages a reader can ask for a version in: the site's own. */
const LANGUAGES: readonly string[] = ['en', ...UNFINISHED_LOCALES];

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const q = readNewsQuery(query);
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    // The sections are one page with four views; the filters do not make new ones.
    path: q.section === 'latest' ? '/news' : `/news?section=${q.section}`,
    title: `${t(resolved, SECTION_KEY[q.section])} · ${t(resolved, 'news.title')} · Stadiomind`,
    description: t(resolved, 'newsPage.description'),
  });
}

/** The sections the latest front page carries the heads of, beside its list (T-1613). */
const RAIL: readonly { section: 'trending' | 'debate'; limit: number }[] = [
  { section: 'trending', limit: 5 },
  { section: 'debate', limit: 3 },
];

const RAIL_ALL: Record<'trending' | 'debate', MessageKey> = {
  trending: 'newsPage.rail.trending',
  debate: 'newsPage.rail.debate',
};

type SectionAnswer = Awaited<ReturnType<typeof fetchNewsSection>>;

/**
 * The news page (blueprint 3.1 and 3.2, T-143): four sections over the same
 * stories, each saying what it is computed from, and filters by country,
 * competition, team and language.
 *
 * A first page is a front page (T-1613, D-284): the lead story with its
 * picture, a row of cards, then the compact list, in the section's own
 * order; the unfiltered latest page also carries the heads of trending and
 * debate beside the list. A story's picture is its licensed photo, credited
 * (D-177), or a designed panel of what it is filed under -- never a stand-in
 * photo (rule 3).
 *
 * Every card is a publisher's own words and a link back to them (D-061);
 * nothing here is a body. A section that holds nothing says why (rule 3),
 * and a list read too long ago says so rather than posing as current
 * (rule 4).
 */
export default async function NewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const q = readNewsQuery(query);
  const cookie = await sessionCookieHeader();
  const filtered = isFiltered(q);
  const withRail = q.section === 'latest' && !filtered && q.before === null;
  const mePromise = fetchMe(cookie);
  // D-124: dates are the viewer's calendar days, so a dated query waits for
  // their zone; an undated one does not wait at all.
  const newsPromise = (
    q.from === null && q.to === null
      ? Promise.resolve('UTC')
      : mePromise.then(async (m) => (await pageTimeZone(locale, m)).timeZone)
  ).then((zone) => fetchNewsSection(apiQuery(q, zone), locale, cookie));
  const railPromise: Promise<SectionAnswer[] | null> = withRail
    ? Promise.all(
        RAIL.map(({ section, limit }) =>
          fetchNewsSection(`?section=${section}&limit=${limit}`, locale, cookie),
        ),
      )
    : Promise.resolve(null);
  const [me, result, countries, competitions, teams, savedList, player, railAnswers] =
    await Promise.all([
      mePromise,
      newsPromise,
      fetchCountries(),
      fetchCompetitions(),
      fetchTeams(),
      fetchSavedArticles(cookie),
      q.player === null ? Promise.resolve(null) : fetchPlayer(q.player, locale),
      railPromise,
    ]);
  const playerName =
    player !== null && player.ok
      ? (player.data.person.localised_name ??
        player.data.person.known_as ??
        player.data.person.full_name)
      : null;
  // T-842: a member's save control knows what is saved; a guest gets none,
  // and an unreachable list offers none rather than a wrong state.
  const saved =
    me !== null && savedList !== null && savedList.ok
      ? new Set(savedList.data.saved.map((s) => s.story_id))
      : null;
  // The session carries no roles; an editor is whoever the editor's list answers.
  const editor = me !== null && (await fetchDebates(cookie)).ok;
  const { timeZone } = await pageTimeZone(locale, me);
  const label = (key: MessageKey): string => t(resolved, key);
  const now = new Date().toISOString();

  // T-1613 (D-284): a first page is a front page -- the lead, the cards, the list.
  const front = frontPage(result.ok ? (result.data.stories.data ?? []) : [], q.before === null);
  const rail =
    railAnswers === null
      ? null
      : RAIL.map(({ section }, index) => ({ section, answer: railAnswers[index]! }));
  const extras = (card: NewsStoryCard) => (
    <>
      {saved !== null && (
        <div className="mt-2">
          <SaveArticle
            locale={locale}
            storyId={card.story_id}
            headline={card.headline}
            language={card.language}
            saved={saved.has(card.story_id)}
          />
        </div>
      )}
      {editor && <EditorControls card={card} locale={locale} label={label} />}
    </>
  );

  return (
    <main className="page-frame flex flex-col gap-8 pt-6 pb-12 md:pt-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1
            className="border-s-4 border-s-accent ps-4 text-3xl leading-tight font-extrabold font-stretch-semi-expanded sm:text-display-2"
            data-testid="title"
          >
            <Translated locale={locale} message="news.title" />
          </h1>
          {result.ok && (
            <Freshness
              lastUpdatedAt={result.data.stories.last_updated_at}
              locale={locale}
              timeZone={timeZone}
            />
          )}
        </div>

        {/* The Design System's tabs, as on the competition, club and player pages (T-1570). */}
        <div className="border-b border-default">
          <SectionTabs
            label={label('news.title')}
            testId="section"
            tabs={NEWS_SECTIONS.map((section) => ({
              key: section,
              href: pageHref(locale, q, { section }),
              label: label(SECTION_KEY[section]),
              current: section === q.section,
            }))}
          />
        </div>

        <Filters
          locale={locale}
          q={q}
          filtered={filtered}
          playerName={playerName}
          countries={countries}
          competitions={competitions}
          teams={teams}
          label={label}
        />
      </header>

      {!result.ok ? (
        <Notice tone="danger" data-testid="news-unreachable">
          <Translated locale={locale} message="news.unreachable" />
        </Notice>
      ) : (
        <>
          {result.data.reason !== null && (
            <p role="status" className="text-sm font-medium" data-testid="news-reason">
              <Translated locale={locale} message={REASON_KEY[result.data.reason]} />
              {result.data.reason === 'needs_session' && (
                <>
                  {' '}
                  <Link href={`/${locale}/login`} className="underline">
                    <Translated locale={locale} message="news.signIn" />
                  </Link>
                </>
              )}
            </p>
          )}

          {result.data.untyped !== null && result.data.untyped > 0 && (
            <p role="status" className="text-sm text-muted" data-testid="news-untyped">
              <Translated
                locale={locale}
                message="news.filter.untyped"
                count={result.data.untyped}
              />
            </p>
          )}

          {(front.lead !== null || front.rest.length > 0) && (
            <div className="flex flex-col gap-10" data-testid="stories">
              {front.lead !== null && (
                <div className="border-b border-default pb-8">
                  <NewsStory
                    card={front.lead}
                    locale={locale}
                    timeZone={timeZone}
                    now={now}
                    variant="lead"
                  />
                  {extras(front.lead)}
                </div>
              )}

              {front.cards.length > 0 && (
                <section aria-labelledby="news-top">
                  <h2 id="news-top" className="sr-only">
                    <Translated locale={locale} message="newsPage.top" />
                  </h2>
                  <ol className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
                    {front.cards.map((card) => (
                      <li key={card.story_id} className="min-w-0">
                        <NewsStory
                          card={card}
                          locale={locale}
                          timeZone={timeZone}
                          now={now}
                          variant="card"
                        />
                        {extras(card)}
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {(front.rest.length > 0 || rail !== null) && (
                <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
                  {front.rest.length > 0 && (
                    <section aria-labelledby="news-more" className="min-w-0 flex-[999_1_34rem]">
                      <h2
                        id="news-more"
                        className="text-[1.375rem] leading-tight font-extrabold font-stretch-semi-expanded"
                      >
                        <Translated
                          locale={locale}
                          message={front.lead === null ? 'news.title' : 'newsPage.more'}
                        />
                      </h2>
                      <ol className="divide-y">
                        {front.rest.map((card) => (
                          <li key={card.story_id} className="py-4">
                            <NewsStory
                              card={card}
                              locale={locale}
                              timeZone={timeZone}
                              now={now}
                              variant="row"
                            />
                            {extras(card)}
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                  {rail !== null && (
                    <aside className="flex min-w-0 flex-[1_1_18rem] flex-col gap-6 lg:max-w-sm">
                      {rail.map(({ section, answer }) => (
                        <RailBlock
                          key={section}
                          section={section}
                          answer={answer}
                          locale={locale}
                          timeZone={timeZone}
                          now={now}
                          href={pageHref(locale, q, { section })}
                          label={label}
                        />
                      ))}
                    </aside>
                  )}
                </div>
              )}
            </div>
          )}

          {result.data.next_before !== null && (
            <p>
              <ButtonLink
                href={pageHref(locale, q, { before: result.data.next_before })}
                variant="secondary"
                data-testid="news-older"
              >
                <Translated locale={locale} message="news.older" />
              </ButtonLink>
            </p>
          )}
        </>
      )}
    </main>
  );
}

/**
 * One section's head on the front page (T-1613): its first stories, numbered,
 * each a link to the original with its source and time; or, when it holds
 * none, the sentence the API gives for why (rule 3); and the way to the whole
 * section.
 */
function RailBlock({
  section,
  answer,
  locale,
  timeZone,
  now,
  href,
  label,
}: {
  section: 'trending' | 'debate';
  answer: SectionAnswer;
  locale: string;
  timeZone: string;
  now: string;
  href: string;
  label: (key: MessageKey) => string;
}) {
  const stories = answer.ok ? (answer.data.stories.data ?? []) : [];
  const id = `news-rail-${section}`;
  const empty: MessageKey = !answer.ok
    ? 'news.unreachable'
    : answer.data.reason !== null
      ? REASON_KEY[answer.data.reason]
      : 'news.reason.noMatch';
  return (
    <section
      aria-labelledby={id}
      className="rounded-card border border-default bg-surface p-5"
      data-testid={id}
    >
      <h2
        id={id}
        className="flex items-center gap-2 text-sm font-extrabold tracking-widest uppercase"
      >
        <span aria-hidden="true" className="h-3.5 w-1 bg-brand" />
        {label(SECTION_KEY[section as NewsSection])}
      </h2>
      {stories.length > 0 ? (
        <ol className="mt-2 divide-y">
          {stories.map((card, index) => (
            <li key={card.story_id} className="flex gap-3 py-3">
              <span
                aria-hidden="true"
                className="w-6 shrink-0 text-2xl leading-none font-extrabold text-accent tabular-nums"
              >
                {formatNumber(locale, index + 1)}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <a
                  href={card.url}
                  rel="noopener"
                  lang={card.language}
                  dir="auto"
                  className="leading-snug font-semibold hover:underline"
                  data-testid="rail-story"
                >
                  {card.headline}
                </a>
                <p className="text-xs text-muted">
                  <bdi className="font-semibold text-fg">{card.source.name}</bdi>
                  {card.published_at !== null && (
                    <>
                      {' · '}
                      <time dateTime={card.published_at}>
                        {shortTime(locale, card.published_at, timeZone, now)}
                      </time>
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted" data-testid="news-rail-empty">
          <Translated locale={locale} message={empty} />
        </p>
      )}
      <Link
        href={href}
        className="mt-2 inline-flex min-h-touch items-center text-sm font-semibold underline md:min-h-6"
      >
        {label(RAIL_ALL[section])}
      </Link>
    </section>
  );
}

/** "3 hr ago" within a day, else the day and month. */
function shortTime(locale: string, iso: string, timeZone: string, now: string): string {
  const age = recentAge(iso, new Date(now));
  return age !== null
    ? formatAgo(locale, age)
    : formatDate(locale, iso, timeZone, { day: 'numeric', month: 'short' });
}

/**
 * The filters as a GET form (T-143, T-1003), behind a disclosure that is open
 * when one is set: on a phone the six filters filled the first screen before
 * a single story (T-1206). A panel of the page's own fields (T-1613).
 */
function Filters({
  locale,
  q,
  filtered,
  playerName,
  countries,
  competitions,
  teams,
  label,
}: {
  locale: string;
  q: NewsPageQuery;
  filtered: boolean;
  playerName: string | null;
  countries: { id: string; name: string }[] | null;
  competitions: { id: string; name: string }[] | null;
  teams: { id: string; name: string }[] | null;
  label: (key: MessageKey) => string;
}) {
  const field = 'flex min-w-0 flex-col gap-1 font-medium';
  const control = controlClasses('sm', 'w-full bg-surface font-normal');
  return (
    <details
      open={filtered}
      className="group rounded-card border border-default bg-surface text-sm"
      data-testid="news-filters-toggle"
    >
      <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 px-4 font-semibold [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
          className="shrink-0 text-accent"
        >
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        <Translated
          locale={locale}
          message={filtered ? 'newsPage.filtersOn' : 'newsPage.filters'}
        />
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className="ms-auto shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <form
        action={`/${locale}/news`}
        method="get"
        className="grid gap-4 border-t border-default p-4 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="news-filters"
      >
        {q.section !== 'latest' && <input type="hidden" name="section" value={q.section} />}
        {countries !== null && (
          <label className={field}>
            <Translated locale={locale} message="news.filter.country" />
            <select name="country" defaultValue={q.country ?? ''} className={control}>
              <option value="">{label('news.filter.any')}</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {competitions !== null && (
          <label className={field}>
            <Translated locale={locale} message="news.filter.competition" />
            <select name="competition" defaultValue={q.competition ?? ''} className={control}>
              <option value="">{label('news.filter.any')}</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {teams !== null && (
          <label className={field}>
            <Translated locale={locale} message="news.filter.team" />
            <select name="team" defaultValue={q.team ?? ''} className={control}>
              <option value="">{label('news.filter.any')}</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={field}>
          <Translated locale={locale} message="news.filter.language" />
          <select name="language" defaultValue={q.language ?? ''} className={control}>
            <option value="">{label('news.filter.any')}</option>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          <Translated locale={locale} message="news.filter.type" />
          <select
            name="type"
            defaultValue={q.type ?? ''}
            className={control}
            data-testid="news-filter-type"
          >
            <option value="">{label('news.filter.any')}</option>
            {STORY_TYPES.map((type) => (
              <option key={type} value={type}>
                {label(STORY_TYPE_KEY[type])}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          <Translated locale={locale} message="news.filter.from" />
          <input
            type="date"
            name="from"
            defaultValue={q.from ?? ''}
            className={control}
            data-testid="news-filter-from"
          />
        </label>
        <label className={field}>
          <Translated locale={locale} message="news.filter.to" />
          <input
            type="date"
            name="to"
            defaultValue={q.to ?? ''}
            className={control}
            data-testid="news-filter-to"
          />
        </label>
        {q.player !== null && (
          <p
            className="flex flex-wrap items-center gap-2 sm:col-span-full"
            data-testid="news-filter-player"
          >
            <input type="hidden" name="player" value={q.player} />
            <Translated locale={locale} message="news.filter.player" />{' '}
            <Link href={`/${locale}/player/${q.player}`} className="underline">
              {playerName ?? q.player}
            </Link>
            <Link href={pageHref(locale, q, { player: null })} className="underline">
              <Translated locale={locale} message="news.filter.playerClear" />
            </Link>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-full">
          <Button type="submit" className="font-semibold">
            <Translated locale={locale} message="news.filter.apply" />
          </Button>
          {filtered && (
            <Link
              href={pageHref(locale, q, {
                country: null,
                competition: null,
                team: null,
                language: null,
                type: null,
                player: null,
                from: null,
                to: null,
              })}
              className="inline-flex min-h-touch items-center underline md:min-h-6"
            >
              <Translated locale={locale} message="news.filter.clear" />
            </Link>
          )}
          {(countries === null || competitions === null || teams === null) && (
            <span role="status" className="text-muted">
              <Translated locale={locale} message="news.filter.unavailable" />
            </span>
          )}
        </div>
      </form>
    </details>
  );
}

function Freshness({
  lastUpdatedAt,
  locale,
  timeZone,
}: {
  lastUpdatedAt: string | null;
  locale: string;
  timeZone: string;
}) {
  const stale = feedsStale(lastUpdatedAt);
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted"
      data-testid="news-freshness"
      data-stale={stale ? 'true' : 'false'}
    >
      <span
        aria-hidden="true"
        className={stale ? 'size-2 rounded-full bg-warning' : 'size-2 rounded-full bg-brand'}
      />
      {lastUpdatedAt === null ? (
        <Translated locale={locale} message="news.neverRead" />
      ) : (
        <>
          <Translated locale={locale} message="news.updated" />{' '}
          <time dateTime={lastUpdatedAt}>{formatDateTime(locale, lastUpdatedAt, timeZone)}</time>
        </>
      )}
      {stale && lastUpdatedAt !== null && (
        <>
          {' '}
          <span role="status" className="font-medium text-warning">
            <Translated locale={locale} message="news.stale" />
          </span>
        </>
      )}
    </p>
  );
}

/**
 * The editor's two decisions on a card (rule 10): select it for the debate
 * section with the note readers will see, or take it off with a reason.
 * Drawn only for a viewer the editor's list answered.
 */
function EditorControls({
  card,
  locale,
  label,
}: {
  card: NewsStoryCard;
  locale: string;
  label: (key: MessageKey) => string;
}) {
  return (
    <div className="mt-2 text-sm" data-testid="debate-controls">
      {card.debate === null ? (
        <ActionForm
          action={selectDebateAction.bind(null, locale, card.story_id)}
          fields={[
            { name: 'note', label: label('news.debate.noteLabel'), type: 'text', required: true },
          ]}
          submitLabel={label('news.debate.select')}
          testId="debate-select"
        />
      ) : (
        <ActionForm
          action={clearDebateAction.bind(null, locale, card.story_id)}
          fields={[
            {
              name: 'reason',
              label: label('news.debate.reasonLabel'),
              type: 'text',
              required: true,
            },
          ]}
          submitLabel={label('news.debate.clear')}
          testId="debate-clear"
        />
      )}
      {card.breaking === null ? (
        <ActionForm
          action={markBreakingAction.bind(null, locale, card.story_id)}
          fields={[
            {
              name: 'note',
              label: label('news.breaking.noteLabel'),
              type: 'text',
              required: true,
            },
          ]}
          submitLabel={label('news.breaking.mark')}
          testId="breaking-mark"
        />
      ) : (
        <ActionForm
          action={clearBreakingAction.bind(null, locale, card.story_id)}
          fields={[
            {
              name: 'reason',
              label: label('news.breaking.reasonLabel'),
              type: 'text',
              required: true,
            },
          ]}
          submitLabel={label('news.breaking.clear')}
          testId="breaking-clear"
        />
      )}
    </div>
  );
}
