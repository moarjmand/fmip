import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { NEWS_SECTIONS, STORY_TYPES, type NewsStoryCard } from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
import { SaveArticle } from '@/components/save-article';
import { Translated } from '@/components/translated';
import { formatDateTime } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, UNFINISHED_LOCALES, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';
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
  REASON_KEY,
  SECTION_KEY,
  STORY_TYPE_KEY,
  apiQuery,
  feedsStale,
  isFiltered,
  pageHref,
  readNewsQuery,
} from '@/lib/news';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Button, Notice, controlClasses } from '@/components/ui';
import { SectionTabs } from '@/components/ui/section-tabs';
import { NewsStory as Story } from '@/components/news-story';
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

/**
 * The news page (blueprint 3.1 and 3.2, T-143): four sections over the same
 * stories, each saying what it is computed from, and filters by country,
 * competition, team and language.
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
  const mePromise = fetchMe(cookie);
  // D-124: dates are the viewer's calendar days, so a dated query waits for
  // their zone; an undated one does not wait at all.
  const newsPromise = (
    q.from === null && q.to === null
      ? Promise.resolve('UTC')
      : mePromise.then(async (m) => (await pageTimeZone(locale, m)).timeZone)
  ).then((zone) => fetchNewsSection(apiQuery(q, zone), locale, cookie));
  const [me, result, countries, competitions, teams, savedList, player] = await Promise.all([
    mePromise,
    newsPromise,
    fetchCountries(),
    fetchCompetitions(),
    fetchTeams(),
    fetchSavedArticles(cookie),
    q.player === null ? Promise.resolve(null) : fetchPlayer(q.player, locale),
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
  const filtered = isFiltered(q);
  const label = (key: Parameters<typeof t>[1]): string => t(resolved, key);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={locale} message="news.title" />
      </h1>

      {/* The Design System's tabs, as on the competition, club and player pages (T-1570). */}
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

      {/*
        On a phone the six filters filled the first screen before a single
        story (T-1206): they wait behind a disclosure, open when one is set.
      */}
      <details open={filtered} className="group text-sm" data-testid="news-filters-toggle">
        <summary className="flex min-h-touch cursor-pointer items-center gap-2 font-medium">
          <Translated
            locale={locale}
            message={filtered ? 'newsPage.filtersOn' : 'newsPage.filters'}
          />
        </summary>
        <form
          action={`/${locale}/news`}
          method="get"
          className="mt-2 flex flex-wrap items-end gap-3 text-sm"
          data-testid="news-filters"
        >
          {q.section !== 'latest' && <input type="hidden" name="section" value={q.section} />}
          {countries !== null && (
            <label className="flex flex-col gap-1">
              <Translated locale={locale} message="news.filter.country" />
              <select
                name="country"
                defaultValue={q.country ?? ''}
                className={controlClasses('sm')}
              >
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
            <label className="flex flex-col gap-1">
              <Translated locale={locale} message="news.filter.competition" />
              <select
                name="competition"
                defaultValue={q.competition ?? ''}
                className={controlClasses('sm')}
              >
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
            <label className="flex flex-col gap-1">
              <Translated locale={locale} message="news.filter.team" />
              <select name="team" defaultValue={q.team ?? ''} className={controlClasses('sm')}>
                <option value="">{label('news.filter.any')}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <Translated locale={locale} message="news.filter.language" />
            <select
              name="language"
              defaultValue={q.language ?? ''}
              className={controlClasses('sm')}
            >
              <option value="">{label('news.filter.any')}</option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <Translated locale={locale} message="news.filter.type" />
            <select
              name="type"
              defaultValue={q.type ?? ''}
              className={controlClasses('sm')}
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
          <label className="flex flex-col gap-1">
            <Translated locale={locale} message="news.filter.from" />
            <input
              type="date"
              name="from"
              defaultValue={q.from ?? ''}
              className={controlClasses('sm')}
              data-testid="news-filter-from"
            />
          </label>
          <label className="flex flex-col gap-1">
            <Translated locale={locale} message="news.filter.to" />
            <input
              type="date"
              name="to"
              defaultValue={q.to ?? ''}
              className={controlClasses('sm')}
              data-testid="news-filter-to"
            />
          </label>
          {q.player !== null && (
            <p className="flex flex-wrap items-center gap-2" data-testid="news-filter-player">
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
          <Button type="submit" className="font-medium">
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
              className="underline"
            >
              <Translated locale={locale} message="news.filter.clear" />
            </Link>
          )}
          {(countries === null || competitions === null || teams === null) && (
            <span role="status" className="text-muted">
              <Translated locale={locale} message="news.filter.unavailable" />
            </span>
          )}
        </form>
      </details>

      {!result.ok ? (
        <Notice tone="danger" data-testid="news-unreachable">
          <Translated locale={locale} message="news.unreachable" />
        </Notice>
      ) : (
        <>
          <Freshness
            lastUpdatedAt={result.data.stories.last_updated_at}
            locale={locale}
            timeZone={timeZone}
          />

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

          {result.data.stories.data !== null && result.data.stories.data.length > 0 && (
            <ol className="flex flex-col gap-5 lite:gap-3" data-testid="stories">
              {result.data.stories.data.map((card) => (
                <li key={card.story_id}>
                  <Story card={card} locale={locale} timeZone={timeZone} />
                  {saved !== null && (
                    <div className="mt-1 ps-4">
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
                </li>
              ))}
            </ol>
          )}

          {result.data.next_before !== null && (
            <p>
              <Link
                href={pageHref(locale, q, { before: result.data.next_before })}
                className="underline"
                data-testid="news-older"
              >
                <Translated locale={locale} message="news.older" />
              </Link>
            </p>
          )}
        </>
      )}
    </main>
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
      className="text-sm text-muted"
      data-testid="news-freshness"
      data-stale={stale ? 'true' : 'false'}
    >
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
          <span role="status" className="font-medium">
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
  label: (key: Parameters<typeof t>[1]) => string;
}) {
  return (
    <div className="mt-2 ps-4 text-sm" data-testid="debate-controls">
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
