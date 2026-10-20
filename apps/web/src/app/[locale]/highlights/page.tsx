import type { Metadata } from 'next';
import Link from 'next/link';
import type { HighlightListItem, MatchViewing, ViewingTerritory } from '@fmip/contracts';
import { Score } from '@/components/score';
import { Translated } from '@/components/translated';
import { LinkOut, Notice, inlineTargetClasses } from '@/components/ui';
import { TerritoryChooser, hostOf } from '@/components/viewing-panel';
import { formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { fetchHighlights, fetchMe, fetchTerritories } from '@/lib/api';
import { say } from '@/lib/competition';
import {
  highlightsApiQuery,
  highlightsHref,
  pageCount,
  readHighlightsQuery,
} from '@/lib/highlights';
import { pageTimeZone } from '@/lib/reader-time-zone-server';
import { zoneWords } from '@/lib/reader-time-zone';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { withTerritory } from '@/lib/viewing';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/highlights',
    title: `${say(locale, 'highlights.title')} · FMIP`,
    description: say(locale, 'highlights.metaDescription'),
  });
}

const NONE = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;

/**
 * Highlights (T-1434, D-226): every official highlight link we hold -- the
 * licensed feed's verified clips (D-184), link only, never played here --
 * newest match first, each with its match (teams, score, date, competition),
 * the publisher, the way to the match page and the way out to the clip.
 *
 * Which clips is the API's answer for the reader's territory, by the match
 * page's rule (`offeredIn`): the member's stored one, or the one a guest
 * picks here, which then travels with every link on the page. With none,
 * only the clips offered everywhere are listed, and the page says why
 * others may be missing. A filter by competition and pages of twenty; an
 * empty list and an unreachable API each have their own sentence (rule 3).
 */
export default async function HighlightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const q = readHighlightsQuery(query);
  const { timeZone } = await pageTimeZone(locale, me);
  const [answer, territories] = await Promise.all([
    fetchHighlights(highlightsApiQuery(q), cookie),
    me === null ? fetchTerritories() : Promise.resolve(null),
  ]);
  const data = answer.ok ? answer.data : null;
  // A guest's territory travels on the links; a member's is stored.
  const carried = me === null ? q.territory : undefined;
  const territory: ViewingTerritory = data?.territory ?? { state: 'not_chosen' };
  const territoryState: MatchViewing = {
    fixture_id: '',
    territory,
    options: NONE,
    highlights: NONE,
  };
  const pages = data === null ? 1 : pageCount(data.total, data.page_size);
  const chip = (on: boolean): string =>
    `inline-flex min-h-touch items-center gap-1.5 rounded-control border px-3 text-sm ${
      on
        ? 'border-accent font-bold text-accent'
        : 'border-default font-semibold hover:border-strong'
    }`;

  return (
    <main className="page-frame flex flex-col gap-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
          <Translated locale={locale} message="highlights.title" />
        </h1>
        <p className="text-muted">
          <Translated locale={locale} message="highlights.lead" />
        </p>
      </header>

      <TerritoryChooser
        locale={locale}
        viewing={territoryState}
        signedIn={me !== null}
        href={`/${locale}/highlights`}
        territories={territories}
        hidden={q.competition === undefined ? {} : { competition: q.competition }}
      />

      {data === null ? (
        <Notice tone="danger" data-testid="highlights-unreachable">
          <Translated locale={locale} message="highlights.unreachable" />
        </Notice>
      ) : (
        <>
          {data.offered === 'everywhere' && (
            <Notice tone="info" data-testid="highlights-everywhere">
              <Translated locale={locale} message="highlights.everywhere" />
            </Notice>
          )}

          {data.competitions.length > 0 && (
            <nav aria-label={say(locale, 'highlights.filter')} data-testid="highlights-filter">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <Link
                    href={highlightsHref(locale, q, { competition: null })}
                    aria-current={data.competition === null ? 'page' : undefined}
                    className={chip(data.competition === null)}
                    data-testid="highlights-filter-all"
                  >
                    <Translated locale={locale} message="highlights.allCompetitions" />
                  </Link>
                </li>
                {data.competitions.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={highlightsHref(locale, q, { competition: c.id })}
                      aria-current={data.competition === c.id ? 'page' : undefined}
                      className={chip(data.competition === c.id)}
                      data-testid="highlights-filter-competition"
                      data-competition={c.id}
                    >
                      <bdi>{c.name}</bdi>
                      <span className="text-caption">{formatNumber(locale, c.count)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {data.items.length === 0 ? (
            <p className="text-muted" data-testid="highlights-empty">
              <Translated
                locale={locale}
                message={
                  data.total > 0
                    ? 'highlights.pastEnd'
                    : data.competition !== null
                      ? 'highlights.emptyCompetition'
                      : 'highlights.empty'
                }
              />
            </p>
          ) : (
            <ol className="flex flex-col gap-3" data-testid="highlights-list">
              {data.items.map((item) => (
                <HighlightRow
                  key={item.id}
                  locale={locale}
                  item={item}
                  timeZone={timeZone}
                  territory={carried}
                />
              ))}
            </ol>
          )}

          {data.total > data.page_size && (
            <nav
              aria-label={say(locale, 'highlights.pages')}
              className="flex flex-wrap items-center justify-between gap-3 text-sm"
              data-testid="highlights-pages"
            >
              {data.page > 1 ? (
                <Link
                  href={highlightsHref(locale, q, { page: data.page - 1 })}
                  rel="prev"
                  className={chip(false)}
                  data-testid="highlights-newer"
                >
                  <Translated locale={locale} message="highlights.newer" />
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted" data-testid="highlights-page">
                {say(locale, 'highlights.pageOf', {
                  page: formatNumber(locale, data.page),
                  pages: formatNumber(locale, pages),
                })}
              </span>
              {data.page < pages ? (
                <Link
                  href={highlightsHref(locale, q, { page: data.page + 1 })}
                  rel="next"
                  className={chip(false)}
                  data-testid="highlights-older"
                >
                  <Translated locale={locale} message="highlights.older" />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}

          {data.last_updated_at !== null && (
            <p className="text-xs text-caption" data-testid="highlights-updated">
              {say(locale, 'highlights.updated', {
                time: formatDateTime(locale, data.last_updated_at, timeZone),
                zone: zoneWords(locale, timeZone),
              })}
            </p>
          )}
        </>
      )}
    </main>
  );
}

/**
 * One clip: the competition and the date, the match (teams and score, a link
 * to its page), then the way out to the clip, naming who publishes it.
 */
function HighlightRow({
  locale,
  item,
  timeZone,
  territory,
}: {
  locale: string;
  item: HighlightListItem;
  timeZone: string;
  territory: string | undefined;
}) {
  const { fixture } = item;
  const host = item.publisher ?? hostOf(item.url);
  const name = (team: HighlightListItem['fixture']['home']) => team.short_name ?? team.name;
  return (
    <li
      className="flex flex-col gap-3 rounded-control border border-default bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="highlight-item"
      data-fixture={fixture.id}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-caption">
          <Link
            href={`/${locale}/competition/${fixture.competition.id}`}
            className={inlineTargetClasses('font-semibold underline')}
          >
            <bdi>{fixture.competition.name}</bdi>
          </Link>
          <span aria-hidden="true">·</span>
          <time dateTime={fixture.kickoff_at}>
            {formatDate(locale, fixture.kickoff_at, timeZone, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </time>
        </p>
        <Link
          href={withTerritory(`/${locale}/match/${fixture.id}`, territory)}
          className={inlineTargetClasses(
            'flex flex-wrap items-center gap-x-2 text-base font-semibold',
          )}
          data-testid="highlight-match"
        >
          <bdi>{name(fixture.home)}</bdi>
          {fixture.score === null ? (
            <span className="text-caption">–</span>
          ) : (
            <Score
              locale={locale}
              home={fixture.score.home}
              away={fixture.score.away}
              separator=" – "
              className="font-black tabular-nums"
              testId="highlight-score"
            />
          )}
          <bdi>{name(fixture.away)}</bdi>
          {fixture.penalties !== null && (
            <span className="text-sm font-normal text-muted" data-testid="highlight-penalties">
              {say(locale, 'highlights.penalties')}{' '}
              <Score locale={locale} home={fixture.penalties.home} away={fixture.penalties.away} />
            </span>
          )}
        </Link>
      </div>
      <LinkOut
        href={item.url}
        host={host}
        look="button"
        icon="play"
        className="shrink-0"
        testId="highlight-link"
      >
        <Translated locale={locale} message="viewing.highlightsPage" />
      </LinkOut>
    </li>
  );
}
