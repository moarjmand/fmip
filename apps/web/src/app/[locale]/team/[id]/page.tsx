import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { MatchViewing, TeamPageFixture } from '@fmip/contracts';
import {
  ClubBand,
  FixturesPanel,
  MatchesPanel,
  NoNextMatch,
  ResultsPanel,
  SeasonPanels,
  SplitsPanels,
  SquadPanel,
  TablePanels,
} from '@/components/club-page';
import { EntityFollow, LiveFreshness } from '@/components/competition-page';
import type { FreshnessWords } from '@/components/freshness-stamp';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import { JsonLd } from '@/components/json-ld';
import { NextMatchCard } from '@/components/next-match-card';
import { EntityNews } from '@/components/related-news';
import { Stamp } from '@/components/stamp';
import { TeamSeasonStatsPanel } from '@/components/team-season-stats';
import { TeamTransfersPanel } from '@/components/transfers';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { message } from '@/i18n/messages';
import {
  fetchEntityNews,
  fetchFollowing,
  fetchForecastSummaries,
  fetchFounderFeed,
  fetchMe,
  fetchTeam,
  fetchTeamSeasonStats,
  fetchTeamTransfers,
  fetchViewingBatch,
} from '@/lib/api';
import { pageLocale, say } from '@/lib/competition';
import { type CardForecast, cardForecast } from '@/lib/score-card-products';
import { pageMetadata, teamJsonLd } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { OVERVIEW_MATCHES, type TeamTab, readTeamTab, seasonFigures } from '@/lib/team';
import { readStatsSeason } from '@/lib/team-season-stats';
import { readTerritoryQuery } from '@/lib/viewing';
import { pageTimeZone } from '@/lib/reader-time-zone-server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const fallback = `${say(locale, 'teamPage.title')} · Stadiomind`;
  if (!UUID.test(id)) return { title: fallback, robots: { index: false, follow: false } };
  const result = await fetchTeam(id, locale);
  if (!result.ok) return pageMetadata({ locale, path: `/team/${id}`, title: fallback });
  const t = result.data.team;
  // The reader's name in the title; the canonical one in the description, so
  // both are on the page and neither pretends to be the other (T-303).
  return pageMetadata({
    locale,
    path: `/team/${t.id}`,
    title: `${t.localised_name ?? t.name} · Stadiomind`,
    description: say(locale, 'teamPage.metaDescription', { name: t.name }),
  });
}

/** The model's latest pre-kick-off forecast for the next match; `unreachable` when nobody answered. */
async function nextForecast(fixture: TeamPageFixture | null): Promise<CardForecast> {
  if (fixture === null) return { state: 'none' };
  const answer = await fetchForecastSummaries([fixture.id]);
  if (!answer.ok) return { state: 'unreachable' };
  const entry = answer.data.fixtures.find((e) => e.fixture_id === fixture.id);
  return cardForecast(entry?.pre_kickoff ?? null);
}

/**
 * The team page (blueprint 5.2, T-036), in the Hybrid design's data mode
 * (T-1386, D-204): on the stage, following Day and Night, under a band in
 * the brand's colours (no club colour is in our data) with follow, and in
 * tabs. It opens on the Overview -- the next match with the model's
 * forecast and its version and who broadcasts it, the season in tiles,
 * the latest fixtures and results, the squad, where the club stands, the
 * news and the founder's analysis -- and the other tabs hold what the page
 * always had: every fixture with where to watch it, every result, the squad
 * by position with minutes, and home and away. An unreachable API is said
 * out loud. Its words come from the catalogue (T-1304).
 */
export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const tab: TeamTab = readTeamTab(query);
  const overview = tab === 'overview';
  const cookie = await sessionCookieHeader();
  const [result, me, following, founder, news, seasonStats, transfers] = await Promise.all([
    fetchTeam(id, locale),
    fetchMe(cookie),
    fetchFollowing(cookie),
    // The Overview's own modules; the other tabs do not ask for them.
    overview ? fetchFounderFeed({ team: id, limit: 3 }) : null,
    overview ? fetchEntityNews('team', id, locale) : null,
    // The provider's season statistics (T-1437): the Stats tab only.
    tab === 'stats' ? fetchTeamSeasonStats(id, readStatsSeason(query)) : null,
    // The provider's arrivals and departures (T-1440): the Squad tab only.
    tab === 'squad' ? fetchTeamTransfers(id, locale) : null,
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main data-mode="data" className="pb-16">
        <div className="page-frame flex flex-col gap-4 pt-8">
          <h1 className="text-2xl font-semibold">
            <Translated locale={locale} message="teamPage.title" />
          </h1>
          <Notice tone="danger" data-testid="team-unreachable">
            <Translated locale={locale} message="teamPage.unreachable" />
          </Notice>
        </div>
      </main>
    );
  }
  const page = result.data;
  const t = page.team;
  const { timeZone } = await pageTimeZone(locale, me);
  // Where each match can be watched (T-314): in the member's stored territory
  // or the one a guest carried here on the link. The Overview asks for the
  // next match only (its card); the Fixtures tab for the whole list, at once.
  const territory = readTerritoryQuery(query);
  const guestTerritory = me === null ? territory : undefined;
  const watchIds =
    tab === 'fixtures'
      ? page.fixtures.slice(0, 100).map((f) => f.id)
      : overview && page.next_match !== null
        ? [page.next_match.id]
        : [];
  const [viewing, forecast] = await Promise.all([
    watchIds.length > 0 ? fetchViewingBatch(watchIds, territory, cookie) : null,
    overview ? nextForecast(page.next_match) : null,
  ]);
  const answers = new Map<string, MatchViewing>(
    viewing !== null && viewing.ok ? viewing.data.fixtures.map((v) => [v.fixture_id, v]) : [],
  );
  const l = pageLocale(locale);
  const freshnessWords: FreshnessWords = {
    'freshness.checked': message(l, 'freshness.checked'),
    'freshness.behind': message(l, 'freshness.behind'),
  };
  // The moment this answer is rendered: how old a live list's last change is (rule 4).
  const now = new Date().getTime();
  const liveFreshness = (fixtures: readonly TeamPageFixture[]) => (
    <LiveFreshness
      fixtures={fixtures}
      checkedAt={page.last_updated_at}
      now={now}
      locale={locale}
      words={freshnessWords}
    />
  );

  return (
    <main data-mode="data" className="pb-16" data-testid="team-page" data-tab={tab}>
      <JsonLd data={teamJsonLd(locale, t)} />
      <ClubBand
        page={page}
        locale={locale}
        timeZone={timeZone}
        tab={tab}
        territory={guestTerritory}
        follow={
          <EntityFollow
            locale={locale}
            entityType="team"
            entityId={t.id}
            name={t.localised_name ?? t.name}
            signedIn={me !== null}
            following={following}
            followingKey="teamPage.follow.following"
            unreachableKey="teamPage.follow.unreachable"
          />
        }
      />
      <div className="page-frame flex flex-col gap-5 pt-6">
        {overview && (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              {page.next_match === null ? (
                <NoNextMatch locale={locale} />
              ) : (
                <NextMatchCard
                  fixture={page.next_match}
                  forecast={forecast ?? { state: 'none' }}
                  viewing={
                    viewing !== null && viewing.ok
                      ? (answers.get(page.next_match.id) ?? null)
                      : null
                  }
                  locale={locale}
                  timeZone={timeZone}
                />
              )}
              <SeasonPanels
                figures={seasonFigures(page.competitions, page.splits)}
                locale={locale}
              />
              <MatchesPanel
                page={page}
                locale={locale}
                timeZone={timeZone}
                limit={OVERVIEW_MATCHES}
                territory={guestTerritory}
                freshness={liveFreshness(
                  page.next_match === null ? page.fixtures : [page.next_match, ...page.fixtures],
                )}
              />
              <SquadPanel page={page} locale={locale} full={false} />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <TablePanels page={page} locale={locale} />
              {/* The news module's own heading, set in the panels' style. */}
              <div className="rounded-card border border-default bg-surface p-4 sm:p-5 [&_h2]:text-sm [&_h2]:font-extrabold [&_h2]:uppercase ltr:[&_h2]:tracking-wider">
                <EntityNews
                  locale={locale}
                  timeZone={timeZone}
                  news={news?.ok === true ? news.data : null}
                />
              </div>
              {founder?.ok === true && founder.data.analyses.length > 0 && (
                <div className="rounded-card border border-default border-t-3 border-t-founder bg-surface p-4 sm:p-5 [&_h2]:text-sm [&_h2]:font-extrabold">
                  <FounderAnalysisFeed
                    analyses={founder.data.analyses}
                    locale={locale}
                    timeZone={timeZone}
                    heading={say(locale, 'teamPage.founderHeading', { name: t.name })}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        {tab === 'fixtures' && (
          <FixturesPanel
            page={page}
            locale={locale}
            timeZone={timeZone}
            viewing={answers}
            signedIn={me !== null}
            territory={guestTerritory}
            freshness={liveFreshness(page.fixtures)}
          />
        )}
        {tab === 'results' && <ResultsPanel page={page} locale={locale} timeZone={timeZone} />}
        {tab === 'squad' && <SquadPanel page={page} locale={locale} full />}
        {tab === 'squad' && transfers?.ok === true && (
          <TeamTransfersPanel data={transfers.data} locale={locale} timeZone={timeZone} />
        )}
        {tab === 'stats' && (
          <>
            <SplitsPanels page={page} locale={locale} />
            {seasonStats?.ok === true && (
              <TeamSeasonStatsPanel
                data={seasonStats.data}
                teamId={t.id}
                locale={locale}
                timeZone={timeZone}
              />
            )}
          </>
        )}
        <p className="text-xs text-muted" data-testid="team-updated">
          {page.last_updated_at === null ? (
            <Translated locale={locale} message="competitionPage.noData" />
          ) : (
            <>
              <Translated locale={locale} message="competitionPage.lastUpdate" />{' '}
              <Stamp iso={page.last_updated_at} locale={locale} timeZone={timeZone} />
            </>
          )}
        </p>
      </div>
    </main>
  );
}
