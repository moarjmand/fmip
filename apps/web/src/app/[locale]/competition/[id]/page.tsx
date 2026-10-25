import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { notFound } from 'next/navigation';
import type { CompetitionPage as Page, Covered } from '@fmip/contracts';
import {
  BOARDS,
  BoardList,
  CompetitionBand,
  CompetitionFollow,
  CoveragePanel,
  CoveredPanel,
  LeagueNumbersPanel,
  LiveFreshness,
  MatchweekPanel,
  MoreLink,
  NoTableNote,
  ProjectionNote,
  QualifyingNote,
  RoundsPanel,
  ProviderTotalsNote,
  ScorerList,
  ZoneLegend,
} from '@/components/competition-page';
import type { FreshnessWords } from '@/components/freshness-stamp';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import { JsonLd } from '@/components/json-ld';
import { KnockoutBracket } from '@/components/knockout-bracket';
import { EntityNews } from '@/components/related-news';
import { GroupTables, StandingsTable, showsLeagueTable } from '@/components/standings-table';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { message } from '@/i18n/messages';
import {
  fetchCompetition,
  fetchEntityNews,
  fetchFollowing,
  fetchForecastSummaries,
  fetchFounderFeed,
  fetchMe,
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
  type Matchweek,
  availableTabs,
  currentMatchweek,
  hasTable,
  leagueNumbers,
  readTabParam,
  roundGroups,
  tabHref,
} from '@/lib/competition-overview';
import { type CardForecast, cardForecast } from '@/lib/score-card-products';
import { competitionJsonLd, pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { forecastBarWords } from '@/lib/words-server';
import { pageTimeZone } from '@/lib/reader-time-zone-server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Scorers on the Overview's short list (T-1385); the Players tab has them all. */
const OVERVIEW_SCORERS = 5;

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
  return pageMetadata({
    locale,
    path,
    title: `${c.localised_name ?? c.name} ${result.data.season.label} · Stadiomind`,
    description: say(locale, 'competitionPage.metaDescription', {
      name: c.name,
      season: result.data.season.label,
    }),
  });
}

/**
 * The model's latest pre-kick-off forecast for each match of the Overview's
 * round (T-1385): one request for the whole round (at most
 * `MATCHWEEK_LIMIT`), never one per match. A request that fails marks every
 * match `unreachable`, which the bar says in words (rule 3).
 */
async function roundForecasts(ids: string[]): Promise<Record<string, CardForecast>> {
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

/**
 * The competition page (blueprint 5.1, T-035), in the Hybrid design's data
 * mode (T-1385, D-203): on the stage, following Day and Night, under a band
 * in the brand's colours with the follow button, and in tabs. It opens on
 * the Overview -- the table's summary, this round's matches with the model's
 * three-way, the top scorers, the season in figures and the news -- and the
 * other tabs hold what the page always had: the full table with its groups
 * and knockout rounds, fixtures and results by round, the players' boards,
 * and the coverage. Every module states its coverage; none is drawn as if
 * it had data it does not (rule 3). An unreachable API is said out loud.
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
  const overview = requested === 'overview';
  const cookie = await sessionCookieHeader();
  const [result, me, following, founder, news] = await Promise.all([
    fetchCompetition(id, competitionQuery(seasonParam, minMinutes), locale),
    fetchMe(cookie),
    fetchFollowing(cookie),
    // The Overview's own modules; the other tabs do not ask for them.
    overview ? fetchFounderFeed({ competition: id, limit: 3 }) : null,
    overview ? fetchEntityNews('competition', id, locale) : null,
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main data-mode="data" className="pb-16">
        <div className="page-frame flex flex-col gap-4 pt-8">
          <h1 className="text-2xl font-semibold">
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
  const matchweek = currentMatchweek(locale, page);
  const forecasts =
    tab === 'overview' && matchweek !== null
      ? await roundForecasts(matchweek.fixtures.map((f) => f.id))
      : {};
  const l = pageLocale(locale);
  const freshnessWords: FreshnessWords = {
    'freshness.checked': message(l, 'freshness.checked'),
    'freshness.behind': message(l, 'freshness.behind'),
  };
  // The moment this answer is rendered: how old a live list's last change is (rule 4).
  const now = new Date().getTime();
  const ctx = { page, locale, timeZone, now, freshnessWords };

  return (
    <main data-mode="data" className="pb-16" data-testid="competition-page" data-tab={tab}>
      <JsonLd data={competitionJsonLd(locale, page)} />
      <CompetitionBand
        page={page}
        locale={locale}
        timeZone={timeZone}
        tab={tab}
        tabs={tabs}
        minMinutes={minMinutes}
        matchweek={matchweek}
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
      <div className="page-frame flex flex-col gap-5 pt-6">
        {tab === 'overview' && (
          <Overview
            {...ctx}
            matchweek={matchweek}
            forecasts={forecasts}
            founder={founder?.ok === true ? founder.data.analyses : []}
            news={news?.ok === true ? news.data : null}
          />
        )}
        {tab === 'table' && <TableTab {...ctx} />}
        {tab === 'fixtures' && (
          <RoundsPanel
            testId="fixtures"
            title={<Translated locale={locale} message="competitionPage.fixtures" />}
            groups={roundGroups(locale, page.fixtures)}
            empty={<Translated locale={locale} message="competitionPage.noFixtures" />}
            locale={locale}
            timeZone={timeZone}
            freshness={
              <LiveFreshness
                fixtures={page.fixtures}
                checkedAt={page.last_updated_at}
                now={now}
                locale={locale}
                words={freshnessWords}
              />
            }
          />
        )}
        {tab === 'results' && (
          <RoundsPanel
            testId="results"
            title={<Translated locale={locale} message="competitionPage.results" />}
            groups={roundGroups(locale, page.results)}
            empty={<Translated locale={locale} message="competitionPage.noResults" />}
            locale={locale}
            timeZone={timeZone}
          />
        )}
        {tab === 'players' && <PlayersTab page={page} locale={locale} timeZone={timeZone} />}
        {tab === 'stats' && (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            <LeagueNumbersPanel numbers={leagueNumbers(page.results)} locale={locale} />
            <CoveragePanel page={page} locale={locale} timeZone={timeZone} />
          </div>
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
 * The Overview (T-1385): the table's summary first (or, for a cup with no
 * table, the sentence that says so), then this round, the top scorers and
 * the season in figures beside it, and the news and the founder's analysis
 * under it. On a phone it is one column in that order.
 */
function Overview({
  page,
  locale,
  timeZone,
  now,
  freshnessWords,
  matchweek,
  forecasts,
  founder,
  news,
}: TabProps & {
  matchweek: Matchweek | null;
  forecasts: Record<string, CardForecast>;
  founder: Parameters<typeof FounderAnalysisFeed>[0]['analyses'];
  news: Parameters<typeof EntityNews>[0]['news'];
}) {
  const c = page.competition;
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
      <div className="flex min-w-0 flex-col gap-5">
        {hasTable(page) ? (
          <TableModules page={page} locale={locale} timeZone={timeZone} summary />
        ) : (
          <NoTableNote locale={locale} />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-5 lg:row-span-2">
        <MatchweekPanel
          matchweek={matchweek}
          page={page}
          locale={locale}
          timeZone={timeZone}
          forecasts={forecasts}
          forecastWords={forecastBarWords(locale)}
          freshness={
            <LiveFreshness
              fixtures={matchweek?.fixtures ?? []}
              checkedAt={page.last_updated_at}
              now={now}
              locale={locale}
              words={freshnessWords}
            />
          }
        />
        <CoveredPanel
          locale={locale}
          timeZone={timeZone}
          title={<Translated locale={locale} message="competitionPage.topScorers" />}
          module={page.leaders}
          testId="leaders"
          empty={
            page.leaders_filter.min_minutes !== null && page.leaders.data !== null ? (
              <Translated locale={locale} message="competition.leaders.noneReach" />
            ) : undefined
          }
          intro={<QualifyingNote results={page.results} locale={locale} />}
          footer={
            (page.leaders.data ?? []).length > 0 ? (
              <MoreLink href={tabHref(locale, c.id, page.season, 'players')}>
                <Translated locale={locale} message="competitionPage.allPlayers" />
              </MoreLink>
            ) : undefined
          }
        >
          {(leaders) => <ScorerList leaders={leaders} locale={locale} limit={OVERVIEW_SCORERS} />}
        </CoveredPanel>
        <LeagueNumbersPanel numbers={leagueNumbers(page.results)} locale={locale} />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        {/* The news module's own heading, set in the panels' style. */}
        <div className="rounded-card border border-default bg-surface p-4 sm:p-5 [&_h2]:text-sm [&_h2]:font-extrabold [&_h2]:uppercase ltr:[&_h2]:tracking-wider">
          <EntityNews locale={locale} timeZone={timeZone} news={news} />
        </div>
        {founder.length > 0 && (
          <div className="rounded-card border border-default border-t-3 border-t-founder bg-surface p-4 sm:p-5 [&_h2]:text-sm [&_h2]:font-extrabold">
            <FounderAnalysisFeed
              analyses={founder}
              locale={locale}
              timeZone={timeZone}
              heading={say(locale, 'competitionPage.founderHeading', { name: c.name })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The season's tables (T-1336): the league table when it has rows or no
 * group stage, every group's table when there is one. `summary` is the
 * Overview's: the ranking columns and a link to the whole.
 */
function TableModules({
  page,
  locale,
  timeZone,
  summary = false,
}: {
  page: Page;
  locale: string;
  timeZone: string;
  summary?: boolean;
}) {
  const c = page.competition;
  // The model's season projection is a league's: a planned slot, never a figure (D-203).
  const projection = c.kind === 'league';
  const full = tabHref(locale, c.id, page.season, 'table');
  return (
    <>
      {showsLeagueTable(page) && (
        <CoveredPanel
          locale={locale}
          timeZone={timeZone}
          title={
            <Translated
              locale={locale}
              message={summary ? 'competitionPage.tableSummary' : 'competitionPage.table'}
            />
          }
          module={page.table}
          testId="table"
          footer={
            <>
              {!summary && <ZoneLegend locale={locale} zones={page.zones} />}
              {(page.table.data ?? []).length > 0 && (
                <p className="text-xs text-muted" data-testid="form-order">
                  <Translated locale={locale} message="competitionPage.formOrder" />
                </p>
              )}
              {projection && <ProjectionNote locale={locale} />}
              {summary && (page.table.data ?? []).length > 0 && (
                <MoreLink href={full}>
                  <Translated locale={locale} message="competitionPage.fullTable" />
                </MoreLink>
              )}
            </>
          }
        >
          {(rows) => (
            <StandingsTable
              rows={rows}
              locale={locale}
              zones={page.zones}
              summary={summary}
              projection={projection}
            />
          )}
        </CoveredPanel>
      )}
      {page.group_tables !== null && (
        <CoveredPanel
          locale={locale}
          timeZone={timeZone}
          title={<Translated locale={locale} message="competitionPage.groupTables" />}
          module={page.group_tables}
          testId="group-tables"
          footer={
            summary ? (
              <MoreLink href={full}>
                <Translated locale={locale} message="competitionPage.fullTable" />
              </MoreLink>
            ) : undefined
          }
        >
          {(groups) => <GroupTables groups={groups} locale={locale} summary={summary} />}
        </CoveredPanel>
      )}
    </>
  );
}

/** The Table tab: every table, then the knockout rounds of a cup that plays them (T-630). */
function TableTab({ page, locale, timeZone }: TabProps) {
  return (
    <>
      {hasTable(page) && <TableModules page={page} locale={locale} timeZone={timeZone} />}
      {page.bracket !== null && (
        <div className="rounded-card border border-default bg-surface p-4 sm:p-5 [&_h2]:text-sm [&_h2]:font-extrabold [&_h2]:uppercase ltr:[&_h2]:tracking-wider">
          <KnockoutBracket bracket={page.bracket} locale={locale} timeZone={timeZone} />
        </div>
      )}
    </>
  );
}

/** The Players tab: the scorers under the minutes floor (T-824), then the other boards (T-943). */
function PlayersTab({ page, locale, timeZone }: { page: Page; locale: string; timeZone: string }) {
  const c = page.competition;
  const floor = page.leaders_filter.min_minutes;
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      {page.leaders_source === 'provider_totals' && <ProviderTotalsNote locale={locale} />}
      <CoveredPanel
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
      </CoveredPanel>
      {BOARDS.map((board) => {
        const boardModule = page.boards[board.key] as Covered<
          Parameters<typeof BoardList>[0]['rows']
        >;
        const unproven = page.boards.unproven[board.key];
        return (
          <CoveredPanel
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
          </CoveredPanel>
        );
      })}
    </div>
  );
}
