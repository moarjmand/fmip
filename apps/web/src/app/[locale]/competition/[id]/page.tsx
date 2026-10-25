import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { notFound } from 'next/navigation';
import type { CompetitionPage as Page, Covered } from '@fmip/contracts';
import { MAX_FORECAST_FIXTURES } from '@fmip/contracts';
import {
  BOARDS,
  BoardList,
  CompetitionFollow,
  CoveragePanel,
  LeagueNumbersPanel,
  LiveFreshness,
  QualifyingNote,
  ProviderTotalsNote,
  ScorerList,
} from '@/components/competition-page';
import type { FreshnessWords } from '@/components/freshness-stamp';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import { JsonLd } from '@/components/json-ld';
import { KnockoutBracket } from '@/components/knockout-bracket';
import { EntityNews } from '@/components/related-news';
import { GroupTables, showsLeagueTable } from '@/components/standings-table';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { formatNumber, localDigits } from '@/i18n/format';
import { message } from '@/i18n/messages';
import {
  fetchCompetition,
  fetchEntityNews,
  fetchFollowing,
  fetchForecastSummaries,
  fetchFounderFeed,
  fetchMe,
  fetchModelAccuracy,
} from '@/lib/api';
import {
  competitionQuery,
  leadersHref,
  pageLocale,
  readMinMinutesParam,
  readSeasonParam,
  say,
} from '@/lib/competition';
import {
  type CompetitionTab,
  type LeagueModel,
  availableTabs,
  currentMatchweek,
  hasTable,
  lastResultDay,
  leagueModel,
  leagueNumbers,
  nextMatchDay,
  readTabParam,
  roundGroups,
  tabHref,
} from '@/lib/competition-overview';
import { type CardForecast, cardForecast } from '@/lib/score-card-products';
import { competitionJsonLd, pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { pageTimeZone } from '@/lib/reader-time-zone-server';
import {
  Card,
  CoveredCard,
  DayCard,
  Empty,
  ModelCard,
  ModelMonths,
  ResultsCard,
  RoundsCard,
  TableCard,
} from './competition-cards';
import { CompetitionHeader } from './competition-header';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  const fallback = `${say(locale, 'competitionPage.title')} · Stadiomind`;
  if (!UUID.test(id)) return { title: fallback, robots: { index: false, follow: false } };
  const season = readSeasonParam(query);
  const result = await fetchCompetition(id, competitionQuery(season), locale);
  if (!result.ok) return pageMetadata({ locale, path: `/competition/${id}`, title: fallback });
  const c = result.data.competition;
  // The current season is the canonical page; an older season is its own URL.
  const path = result.data.season.is_current
    ? `/competition/${c.id}`
    : `/competition/${c.id}?season=${result.data.season.id}`;
  // The season in the page's digits, as the header draws it (D-193).
  const seasonLabel = localDigits(locale, result.data.season.label);
  return pageMetadata({
    locale,
    path,
    title: `${c.localised_name ?? c.name} ${seasonLabel} · Stadiomind`,
    description: say(locale, 'competitionPage.metaDescription', {
      name: c.name,
      season: seasonLabel,
    }),
  });
}

/**
 * The model's latest pre-kick-off forecast for each of these matches: one
 * request for all of them (at most `MAX_FORECAST_FIXTURES`), never one per
 * match. A request that fails marks every match `unreachable`, which the row
 * says in words (rule 3).
 */
async function forecastsFor(ids: string[]): Promise<Record<string, CardForecast>> {
  if (ids.length === 0) return {};
  const answer = await fetchForecastSummaries(ids);
  const found = new Map(
    answer.ok ? answer.data.fixtures.map((e) => [e.fixture_id, e.pre_kickoff]) : [],
  );
  return Object.fromEntries(
    ids.map((id) => [
      id,
      answer.ok ? cardForecast(found.get(id) ?? null) : ({ state: 'unreachable' } as const),
    ]),
  );
}

/** The fixtures still to come that the Matches tab asks the model about, soonest first. */
function upcoming(page: Page): string[] {
  return page.fixtures
    .filter((f) => f.status === 'scheduled' || f.status === 'live')
    .slice(0, MAX_FORECAST_FIXTURES)
    .map((f) => f.id);
}

/**
 * The competition page (blueprint 5.1, T-035) in the Stadiomind design
 * (T-1498, D-274): the header with the season menu, follow and the section
 * tabs, then the tab. The Overview is the canvas's: the full table with the
 * form, and beside it the day's matches with the model's percentages, the
 * latest results and the model in this league with its coverage badge; the
 * season's coverage closes it. Table, Matches, Players, the model's months
 * and News are tabs of their own. Every module states its coverage; none is
 * drawn as if it had data it does not (rule 3). An unreachable API is said
 * out loud.
 */
export default async function CompetitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const seasonParam = readSeasonParam(query);
  const minMinutes = readMinMinutesParam(query);
  const requested = readTabParam(query);
  const cookie = await sessionCookieHeader();
  const [result, me, following, founder, news, accuracy] = await Promise.all([
    fetchCompetition(id, competitionQuery(seasonParam, minMinutes), locale),
    fetchMe(cookie),
    fetchFollowing(cookie),
    // Each tab asks only for its own modules.
    requested === 'news' ? fetchFounderFeed({ competition: id, limit: 3 }) : null,
    requested === 'news' ? fetchEntityNews('competition', id, locale) : null,
    requested === 'overview' || requested === 'model' ? fetchModelAccuracy('month') : null,
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main data-mode="data" className="pb-16">
        <div className="page-frame flex flex-col gap-4 pt-8">
          <h1 className="text-2xl font-extrabold font-stretch-semi-expanded">
            <Translated locale={locale} message="competitionPage.title" />
          </h1>
          <Notice tone="danger" data-testid="competition-unreachable">
            <Translated locale={locale} message="competitionPage.unreachable" />
          </Notice>
        </div>
      </main>
    );
  }
  const page = result.data;
  const { timeZone } = await pageTimeZone(locale, me);
  const tabs = availableTabs(page);
  const tab: CompetitionTab = tabs.includes(requested) ? requested : 'overview';
  // The moment this answer is rendered: what the next match day and a live list's age count from (rule 4).
  const now = new Date().getTime();
  const day = tab === 'overview' ? nextMatchDay(page, timeZone, now) : null;
  const forecasts =
    tab === 'overview' && day !== null
      ? await forecastsFor(day.fixtures.slice(0, MAX_FORECAST_FIXTURES).map((f) => f.id))
      : tab === 'matches'
        ? await forecastsFor(upcoming(page))
        : {};
  const model = leagueModel(accuracy?.ok === true ? accuracy.data : null, page.competition.id);
  const l = pageLocale(locale);
  const freshnessWords: FreshnessWords = {
    'freshness.checked': message(l, 'freshness.checked'),
    'freshness.behind': message(l, 'freshness.behind'),
  };
  const ctx = { page, locale, timeZone, now, freshnessWords };

  return (
    <main data-mode="data" className="pb-16" data-testid="competition-page" data-tab={tab}>
      <JsonLd data={competitionJsonLd(locale, page)} />
      <CompetitionHeader
        page={page}
        locale={locale}
        tab={tab}
        tabs={tabs}
        minMinutes={minMinutes}
        matchweek={currentMatchweek(locale, page)}
        follow={
          <CompetitionFollow
            locale={locale}
            competitionId={page.competition.id}
            name={page.competition.localised_name ?? page.competition.name}
            signedIn={me !== null}
            following={following}
          />
        }
      />
      <div className="page-frame flex flex-col gap-5 pt-5 sm:pt-6">
        {tab === 'overview' && (
          <>
            <div className="flex flex-wrap items-start gap-5 lg:gap-6">
              <div className="flex min-w-0 flex-[999_1_40rem] flex-col gap-5">
                <TableModules page={page} locale={locale} timeZone={timeZone} />
              </div>
              <div className="flex min-w-0 flex-[1_1_21rem] flex-col gap-5">
                <DayCard {...ctx} day={day} forecasts={forecasts} />
                <ResultsCard
                  day={lastResultDay(page, timeZone, day?.day ?? null)}
                  locale={locale}
                  timeZone={timeZone}
                />
                <ModelCard
                  model={model}
                  locale={locale}
                  timeZone={timeZone}
                  more={{
                    href: tabHref(locale, page.competition.id, page.season, 'model'),
                    label: 'competitionPage.model.more',
                  }}
                />
              </div>
            </div>
            <CoveragePanel page={page} locale={locale} timeZone={timeZone} />
          </>
        )}
        {tab === 'table' && <TableTab {...ctx} />}
        {tab === 'matches' && <MatchesTab {...ctx} forecasts={forecasts} />}
        {tab === 'players' && <PlayersTab page={page} locale={locale} timeZone={timeZone} />}
        {tab === 'model' && <ModelTab model={model} locale={locale} timeZone={timeZone} />}
        {tab === 'news' && (
          <NewsTab
            page={page}
            locale={locale}
            timeZone={timeZone}
            founder={founder?.ok === true ? founder.data.analyses : []}
            news={news?.ok === true ? news.data : null}
          />
        )}
      </div>
    </main>
  );
}

interface TabProps {
  page: Page;
  locale: string;
  timeZone: string;
  now: number;
  freshnessWords: FreshnessWords;
}

/**
 * The season's tables (T-1336): the league table when it has rows or no
 * group stage, every group's table when there is one, and for a cup played
 * only in knockout rounds the sentence that it has no table.
 */
function TableModules({
  page,
  locale,
  timeZone,
}: {
  page: Page;
  locale: string;
  timeZone: string;
}) {
  if (!hasTable(page)) {
    return (
      <Card testId="no-table" title={say(locale, 'competitionPage.tab.table')}>
        <Empty testId="no-table" locale={locale}>
          <Translated locale={locale} message="competitionPage.noTable" />
        </Empty>
      </Card>
    );
  }
  return (
    <>
      {showsLeagueTable(page) && <TableCard page={page} locale={locale} timeZone={timeZone} />}
      {page.group_tables !== null && (
        <CoveredCard
          testId="group-tables"
          title={<Translated locale={locale} message="competitionPage.groupTables" />}
          module={page.group_tables}
          locale={locale}
          timeZone={timeZone}
        >
          {(groups) => <GroupTables groups={groups} locale={locale} />}
        </CoveredCard>
      )}
    </>
  );
}

/** The Table tab: every table, a cup's knockout rounds (T-630), and the season in figures. */
function TableTab({ page, locale, timeZone }: TabProps) {
  return (
    <>
      {hasTable(page) && <TableModules page={page} locale={locale} timeZone={timeZone} />}
      {page.bracket !== null && (
        <div className="rounded-tile border border-default bg-surface p-4 sm:p-4.5 [&_h2]:text-lg [&_h2]:font-extrabold">
          <KnockoutBracket bracket={page.bracket} locale={locale} timeZone={timeZone} />
        </div>
      )}
      <LeagueNumbersPanel numbers={leagueNumbers(page.results)} locale={locale} />
    </>
  );
}

/** The Matches tab: the fixtures to come with the model's percentages, then the results, by round. */
function MatchesTab({
  page,
  locale,
  timeZone,
  now,
  freshnessWords,
  forecasts,
}: TabProps & { forecasts: Record<string, CardForecast> }) {
  const asked = Object.keys(forecasts).length;
  const toCome = page.fixtures.filter((f) => f.status === 'scheduled' || f.status === 'live');
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <RoundsCard
        testId="fixtures"
        title={<Translated locale={locale} message="competitionPage.fixtures" />}
        groups={roundGroups(locale, page.fixtures)}
        empty={<Translated locale={locale} message="competitionPage.noFixtures" />}
        locale={locale}
        timeZone={timeZone}
        forecasts={forecasts}
        aside={
          <>
            <LiveFreshness
              fixtures={page.fixtures}
              checkedAt={page.last_updated_at}
              now={now}
              locale={locale}
              words={freshnessWords}
            />
            {asked > 0 && (
              <span className="text-xs font-semibold text-model">
                <Translated locale={locale} message="competitionPage.day.modelHead" />
              </span>
            )}
          </>
        }
        footer={
          toCome.length > asked
            ? say(locale, 'competitionPage.matches.modelFirst', {
                number: formatNumber(locale, asked),
              })
            : undefined
        }
      />
      <RoundsCard
        testId="results"
        title={<Translated locale={locale} message="competitionPage.results" />}
        groups={roundGroups(locale, page.results)}
        empty={<Translated locale={locale} message="competitionPage.noResults" />}
        locale={locale}
        timeZone={timeZone}
      />
    </div>
  );
}

/** The Model tab: the model in this league, then month by month (T-1498). */
function ModelTab({
  model,
  locale,
  timeZone,
}: {
  model: LeagueModel;
  locale: string;
  timeZone: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[1_1_21rem] flex-col gap-5">
        <ModelCard
          model={model}
          locale={locale}
          timeZone={timeZone}
          more={{ href: `/${locale}/model-accuracy`, label: 'competitionPage.model.record' }}
        />
      </div>
      <div className="flex min-w-0 flex-[999_1_36rem] flex-col gap-5">
        <ModelMonths model={model} locale={locale} />
      </div>
    </div>
  );
}

/** The News tab: related news, then the founder's analysis of this competition in its own box (rule 6). */
function NewsTab({
  page,
  locale,
  timeZone,
  founder,
  news,
}: {
  page: Page;
  locale: string;
  timeZone: string;
  founder: Parameters<typeof FounderAnalysisFeed>[0]['analyses'];
  news: Parameters<typeof EntityNews>[0]['news'];
}) {
  const box =
    'rounded-tile border border-default bg-surface p-4 sm:p-4.5 [&_h2]:text-lg [&_h2]:font-extrabold';
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <div className={box}>
        <EntityNews locale={locale} timeZone={timeZone} news={news} />
      </div>
      {founder.length > 0 && (
        <div className={box}>
          <FounderAnalysisFeed
            analyses={founder}
            locale={locale}
            timeZone={timeZone}
            heading={say(locale, 'competitionPage.founderHeading', {
              name: page.competition.name,
            })}
          />
        </div>
      )}
    </div>
  );
}

/** The Players tab: the scorers under the minutes floor (T-824), then the other boards (T-943). */
function PlayersTab({ page, locale, timeZone }: { page: Page; locale: string; timeZone: string }) {
  const c = page.competition;
  const floor = page.leaders_filter.min_minutes;
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      {page.leaders_source === 'provider_totals' && <ProviderTotalsNote locale={locale} />}
      <CoveredCard
        locale={locale}
        timeZone={timeZone}
        title={<Translated locale={locale} message="competitionPage.topScorers" />}
        module={page.leaders}
        testId="leaders"
        empty={
          floor !== null && page.leaders.data !== null ? (
            <Translated locale={locale} message="competition.leaders.noneReach" />
          ) : undefined
        }
        intro={
          <>
            <nav
              aria-labelledby="leaders-filter"
              className="flex flex-wrap items-center gap-1 text-sm"
              data-testid="leaders-filter"
            >
              <span id="leaders-filter" className="me-1 text-xs font-bold text-muted">
                <Translated locale={locale} message="competition.leaders.filter" />
              </span>
              {[null, ...page.leaders_filter.presets].map((preset) => {
                const current = preset === floor;
                return (
                  <Link
                    key={preset ?? 'any'}
                    href={leadersHref(locale, c.id, page.season, preset)}
                    aria-current={current ? 'true' : undefined}
                    className={
                      current
                        ? 'inline-flex min-h-8 items-center rounded-pill bg-fg px-3 font-bold text-canvas'
                        : 'inline-flex min-h-8 items-center rounded-pill border border-default px-3 text-muted hover:text-fg'
                    }
                  >
                    {preset === null ? (
                      <Translated locale={locale} message="competition.leaders.anyMinutes" />
                    ) : (
                      <Translated locale={locale} message="minutes.total" count={preset} />
                    )}
                  </Link>
                );
              })}
            </nav>
            <QualifyingNote results={page.results} locale={locale} />
            {floor !== null && (
              <p className="text-sm text-muted" data-testid="leaders-floor">
                <Translated locale={locale} message="competition.leaders.floor" count={floor} />
                {page.leaders_filter.unproven > 0 && (
                  <>
                    {' '}
                    <Translated
                      locale={locale}
                      message="competition.leaders.unproven"
                      count={page.leaders_filter.unproven}
                    />
                  </>
                )}
              </p>
            )}
          </>
        }
      >
        {(leaders) => <ScorerList leaders={leaders} locale={locale} />}
      </CoveredCard>
      {BOARDS.map((board) => {
        const boardModule = page.boards[board.key] as Covered<
          Parameters<typeof BoardList>[0]['rows']
        >;
        const unproven = page.boards.unproven[board.key];
        return (
          <CoveredCard
            locale={locale}
            timeZone={timeZone}
            key={board.key}
            title={<Translated locale={locale} message={board.title} />}
            module={boardModule}
            testId={board.testId}
            empty={
              boardModule.data === null ? undefined : floor !== null ? (
                <Translated locale={locale} message="competition.boards.noneReach" />
              ) : (
                <Translated locale={locale} message={board.none} />
              )
            }
            intro={
              floor !== null && unproven > 0 ? (
                <p className="text-sm text-muted" data-testid={`${board.testId}-unproven`}>
                  <Translated
                    locale={locale}
                    message="competition.boards.unproven"
                    count={unproven}
                  />
                </p>
              ) : undefined
            }
          >
            {(rows) => <BoardList rows={rows} board={board.key} locale={locale} />}
          </CoveredCard>
        );
      })}
    </div>
  );
}
