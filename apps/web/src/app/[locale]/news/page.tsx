import type { Metadata } from 'next';
import Link from 'next/link';
import { NEWS_SECTIONS, type NewsStoryCard } from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
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
  fetchTeams,
} from '@/lib/api';
import { clearDebateAction, selectDebateAction } from '@/lib/debate-actions';
import {
  REASON_KEY,
  SECTION_KEY,
  apiQuery,
  entityHref,
  feedsStale,
  pageHref,
  readNewsQuery,
} from '@/lib/news';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

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
    title: `${t(resolved, SECTION_KEY[q.section])} · ${t(resolved, 'news.title')} · FMIP`,
    description:
      'Football news as publishers report it: the latest, what is being discussed, the debates editors picked, and stories about what you follow.',
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
  const [me, result, countries, competitions, teams] = await Promise.all([
    fetchMe(cookie),
    fetchNewsSection(apiQuery(q), locale, cookie),
    fetchCountries(),
    fetchCompetitions(),
    fetchTeams(),
  ]);
  // The session carries no roles; an editor is whoever the editor's list answers.
  const editor = me !== null && (await fetchDebates(cookie)).ok;
  const timeZone = me?.timezone ?? 'UTC';
  const filtered =
    q.country !== null || q.competition !== null || q.team !== null || q.language !== null;
  const linkClass = (active: boolean): string =>
    `rounded px-2 py-1 ${active ? 'bg-current/10 font-semibold' : 'underline'}`;
  const label = (key: Parameters<typeof t>[1]): string => t(resolved, key);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={locale} message="news.title" />
      </h1>

      <nav
        aria-label={label('news.title')}
        className="flex flex-wrap gap-1 text-sm"
        data-testid="news-sections"
      >
        {NEWS_SECTIONS.map((section) => (
          <Link
            key={section}
            href={pageHref(locale, q, { section })}
            aria-current={section === q.section ? 'page' : undefined}
            className={linkClass(section === q.section)}
            data-testid={`section-${section}`}
          >
            <Translated locale={locale} message={SECTION_KEY[section]} />
          </Link>
        ))}
      </nav>

      <form
        action={`/${locale}/news`}
        method="get"
        className="flex flex-wrap items-end gap-3 text-sm"
        data-testid="news-filters"
      >
        {q.section !== 'latest' && <input type="hidden" name="section" value={q.section} />}
        {countries !== null && (
          <label className="flex flex-col gap-1">
            <Translated locale={locale} message="news.filter.country" />
            <select
              name="country"
              defaultValue={q.country ?? ''}
              className="rounded border border-current/30 px-2 py-1"
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
              className="rounded border border-current/30 px-2 py-1"
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
            <select
              name="team"
              defaultValue={q.team ?? ''}
              className="rounded border border-current/30 px-2 py-1"
            >
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
            className="rounded border border-current/30 px-2 py-1"
          >
            <option value="">{label('news.filter.any')}</option>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded border border-current px-3 py-1 font-medium">
          <Translated locale={locale} message="news.filter.apply" />
        </button>
        {filtered && (
          <Link
            href={pageHref(locale, q, {
              country: null,
              competition: null,
              team: null,
              language: null,
            })}
            className="underline"
          >
            <Translated locale={locale} message="news.filter.clear" />
          </Link>
        )}
        {(countries === null || competitions === null || teams === null) && (
          <span role="status" className="opacity-70">
            <Translated locale={locale} message="news.filter.unavailable" />
          </span>
        )}
      </form>

      {!result.ok ? (
        <p role="alert" data-testid="news-unreachable">
          <Translated locale={locale} message="news.unreachable" />
        </p>
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

          {result.data.stories.data !== null && result.data.stories.data.length > 0 && (
            <ol className="flex flex-col gap-5" data-testid="stories">
              {result.data.stories.data.map((card) => (
                <li key={card.story_id}>
                  <Story card={card} locale={locale} timeZone={timeZone} />
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
      className="text-sm opacity-80"
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
    </div>
  );
}

/** One story: the publisher's words, their name, and the way back to them. */
function Story({
  card,
  locale,
  timeZone,
}: {
  card: NewsStoryCard;
  locale: string;
  timeZone: string;
}) {
  return (
    <article
      className="flex flex-col gap-1 border-s-2 border-s-current/30 ps-4"
      data-testid="story"
      lang={card.language}
    >
      <h2 className="text-lg font-semibold">
        <a href={card.url} rel="noopener" className="underline" data-testid="story-link">
          {card.headline}
        </a>
      </h2>
      <p className="text-sm opacity-80" data-testid="story-source">
        <Translated locale={locale} message="news.readAt" />{' '}
        <a href={card.source.homepage_url} rel="noopener" className="underline">
          {card.source.name}
        </a>
        {card.byline !== null && <> · {card.byline}</>}
        {' · '}
        {card.published_at === null ? (
          <Translated locale={locale} message="news.noTime" />
        ) : (
          <time dateTime={card.published_at}>
            {formatDateTime(locale, card.published_at, timeZone)}
          </time>
        )}
      </p>
      {card.summary !== null && <p data-testid="story-summary">{card.summary}</p>}
      {card.entities.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm" data-testid="story-entities">
          {card.entities.map((entity) => (
            <li key={`${entity.entity_type}:${entity.entity_id}`}>
              <Link href={entityHref(locale, entity)} className="rounded bg-current/10 px-2 py-0.5">
                {entity.entity_type === 'fixture' ? (
                  <Translated locale={locale} message="news.match" />
                ) : (
                  (entity.localised_name ?? entity.name)
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {card.other_reports > 0 && (
        <p className="text-sm opacity-80" data-testid="story-others">
          <Translated locale={locale} message="news.otherReports" count={card.other_reports} />
        </p>
      )}
      {card.discussion !== null && (
        <p className="text-sm" data-testid="story-discussion">
          <Translated
            locale={locale}
            message="news.discussion"
            count={card.discussion.participants}
            params={{ hours: String(card.discussion.window_hours) }}
          />
        </p>
      )}
      {card.debate !== null && (
        <p className="text-sm" data-testid="story-debate">
          <span className="font-medium">
            <Translated locale={locale} message="news.debateNote" />
          </span>{' '}
          {card.debate.note}
        </p>
      )}
    </article>
  );
}
