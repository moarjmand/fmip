import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import { ForecastPanel } from '@/components/forecast-panel';
import { CommunityAnalysisPanel } from '@/components/community-analysis-panel';
import { CompetitionContextPanel } from '@/components/competition-context';
import { CommunityForecastPanel } from '@/components/community-consensus';
import { FounderAnalysisPanel } from '@/components/founder-analysis';
import { JsonLd } from '@/components/json-ld';
import { KeyPlayersPanel } from '@/components/key-players';
import { LiveMatch } from '@/components/live-match';
import { MatchFollow } from '@/components/match-follow';
import { MatchPanel } from '@/components/match-panel';
import { linkChoices } from '@/lib/panel-link';
import { MatchSummaryPanel } from '@/components/match-summary';
import { PowerIndexPanel } from '@/components/power-index-panel';
import { ShareLink } from '@/components/share-link';
import { MatchThreads } from '@/components/match-threads';
import { PredictionSection } from '@/components/prediction-section';
import { RelatedNews } from '@/components/related-news';
import { ViewingDesk } from '@/components/viewing-desk';
import { ViewingPanel } from '@/components/viewing-panel';
import {
  fetchBroadcasters,
  fetchCompetitionContext,
  fetchEvaluations,
  fetchFixtureNews,
  fetchFollowedMembers,
  fetchFollowing,
  fetchForecasts,
  fetchKeyPlayers,
  fetchMatchCentre,
  fetchMatchPanel,
  fetchMatchSummary,
  fetchMatchViewing,
  fetchMe,
  fetchMyGroups,
  fetchCommunityAnalyses,
  fetchConsensus,
  fetchFounderAnalysis,
  fetchOwnPrediction,
  fetchPanelPermission,
  fetchPowerIndex,
  fetchTerritories,
} from '@/lib/api';
import { isTimeZone } from '@/lib/scores';
import { canonicalUrl, matchJsonLd, pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { readTerritoryQuery } from '@/lib/viewing';
import { matchWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const title = `${t(resolved, 'matchCentre.title')} · FMIP`;
  if (!UUID.test(id)) return { title, robots: { index: false, follow: false } };
  const result = await fetchMatchCentre(id);
  if (!result.ok) return pageMetadata({ locale, path: `/match/${id}`, title });
  const f = result.data.fixture;
  const teams = { home: f.home.name, away: f.away.name };
  return pageMetadata({
    locale,
    path: `/match/${f.id}`,
    title: `${interpolate(t(resolved, 'matchCentre.fixtureTitle'), teams)} · FMIP`,
    description: interpolate(t(resolved, 'matchCentre.metaDescription'), {
      ...teams,
      competition: f.competition.name,
      season: f.season.label,
      kickoff: f.kickoff_at,
    }),
  });
}

/**
 * The match centre page (blueprint 4.2, T-034). Works before, during and
 * after a match because every module comes with its coverage state and the
 * page renders whatever is there: a scheduled match shows the header, form
 * and head-to-head; a live one adds the timeline and clock and stays current
 * over SSE; a finished one shows the full record. An unknown id is a 404; an
 * unreachable API is said out loud.
 */
export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  // The key players (T-841): asked at once, beside everything below, and
  // awaited where their section is placed. An unknown match 404s below.
  const keyPlayers = fetchKeyPlayers(id);

  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const tzParam = typeof query.tz === 'string' ? query.tz : undefined;
  const territory = readTerritoryQuery(query);
  const timeZone =
    tzParam !== undefined && isTimeZone(tzParam)
      ? tzParam
      : me !== null && isTimeZone(me.timezone)
        ? me.timezone
        : 'UTC';

  // The editorial desk answers an editor and nobody else (T-313): its list is
  // both the probe for the role and the services a listing can name.
  const desk = me === null ? null : await fetchBroadcasters(cookie);
  const editor = desk !== null && desk.ok;
  // Only for a signed-in member: a match thread happens inside a group, and a
  // guest is in none. The same is true of whom they follow — a guest follows
  // nobody, and one request here saves a follow-status call per contributor on
  // the panel below (T-252).
  // The member's follows, for the follow control on the match itself (T-945).
  const [groups, followed, following] =
    me === null
      ? [null, null, null]
      : await Promise.all([
          fetchMyGroups(cookie),
          fetchFollowedMembers(cookie),
          fetchFollowing(cookie),
        ]);

  const result = await fetchMatchCentre(id);
  if (!result.ok && result.status === 404) notFound();
  // The competition context (T-840): asked now, beside the panels below, and
  // awaited where its section is placed.
  const competitionContext = result.ok ? fetchCompetitionContext(id) : Promise.resolve(null);
  // The forecast (T-065), the Power Index (T-114) and, once the match is over,
  // its evaluation (T-066).
  const [
    forecasts,
    evaluations,
    prediction,
    power,
    founder,
    consensus,
    panel,
    panelPermission,
    communityAnalyses,
    viewing,
    territories,
    news,
    summary,
  ] = result.ok
    ? await Promise.all([
        fetchForecasts(id),
        result.data.fixture.status === 'finished' ? fetchEvaluations(id) : Promise.resolve(null),
        fetchOwnPrediction(id, cookie),
        fetchPowerIndex(id),
        fetchFounderAnalysis(id),
        fetchConsensus(id),
        // No cookie: the discussion is the same document for everybody, and a
        // session here would make a public read viewer-specific for nothing
        // (T-251). The permission beside it is the only viewer-specific half.
        fetchMatchPanel(id),
        fetchPanelPermission(id, cookie),
        // No cookie: a published analysis is meant to be read (T-263).
        fetchCommunityAnalyses(id),
        // Where to watch (T-314): the member's stored territory, or the one a
        // guest chose on this page; a guest also needs the list to choose from.
        fetchMatchViewing(id, territory, cookie),
        me === null ? fetchTerritories() : Promise.resolve(null),
        // Related news (T-145): the news page's cards, for this match and its sides.
        fetchFixtureNews(id, locale),
        // The match summary (E41): a stored row, never a model call on this request.
        fetchMatchSummary(id),
      ])
    : [null, null, null, null, null, null, null, null, null, null, null, null, null];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4 sm:gap-6 sm:p-8">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Link href={`/${locale}/scores`} className="inline-flex min-h-11 items-center underline">
          <Translated locale={locale} message="matchCentre.back" />
        </Link>
        <span className="text-muted" data-testid="timezone">
          <FilledMessage
            message={message(resolved, 'scores.timesIn')}
            params={{ zone: timeZone }}
          />
        </span>
        {result.ok && (
          <span>
            <ShareLink
              url={canonicalUrl(locale, `/match/${result.data.fixture.id}`)}
              title={interpolate(t(resolved, 'matchCentre.fixtureTitle'), {
                home: result.data.fixture.home.name,
                away: result.data.fixture.away.name,
              })}
              label={<Translated locale={locale} message="share.label" />}
              messages={{
                copied: message(resolved, 'share.copied'),
                manual: message(resolved, 'share.manual'),
              }}
            />
          </span>
        )}
      </p>
      {!result.ok ? (
        <>
          <h1 className="text-2xl font-semibold" data-testid="title">
            <Translated locale={locale} message="matchCentre.title" />
          </h1>
          <Notice tone="danger" data-testid="match-unreachable">
            <Translated locale={locale} message="matchCentre.unreachable" />
          </Notice>
        </>
      ) : (
        <>
          <JsonLd data={matchJsonLd(locale, result.data.fixture)} />
          <MatchFollow
            locale={locale}
            fixtureId={result.data.fixture.id}
            status={result.data.fixture.status}
            signedIn={me !== null}
            following={following}
          />
          <LiveMatch
            initial={result.data}
            timeZone={timeZone}
            locale={locale}
            words={matchWords(locale)}
            slots={{
              // Each product in its own section with its own name: the model, the
              // founder and the community are never one panel (rule 6, T-605).
              summary: (
                <MatchSummaryPanel
                  locale={locale}
                  timeZone={timeZone}
                  fixtureId={result.data.fixture.id}
                  status={result.data.fixture.status}
                  summary={summary !== null && summary.ok ? summary.data : null}
                  editor={editor}
                />
              ),
              context: (
                <CompetitionContextPanel
                  context={await competitionContext.then((r) =>
                    r !== null && r.ok ? r.data : null,
                  )}
                  locale={locale}
                  timeZone={timeZone}
                />
              ),
              forecast: (
                <>
                  <ForecastPanel
                    forecasts={forecasts !== null && forecasts.ok ? forecasts.data : null}
                    evaluations={evaluations !== null && evaluations.ok ? evaluations.data : null}
                    home={result.data.fixture.home.name}
                    away={result.data.fixture.away.name}
                    timeZone={timeZone}
                    locale={locale}
                  />
                  <PowerIndexPanel
                    power={power !== null && power.ok ? power.data : null}
                    timeZone={timeZone}
                    locale={locale}
                  />
                </>
              ),
              analysis: (
                <FounderAnalysisPanel
                  analysis={founder !== null && founder.ok ? founder.data : null}
                  home={result.data.fixture.home.name}
                  away={result.data.fixture.away.name}
                  timeZone={timeZone}
                  locale={locale}
                />
              ),
              community: (
                <>
                  <PredictionSection
                    locale={locale}
                    fixture={result.data.fixture}
                    me={me}
                    current={prediction}
                  />
                  <CommunityForecastPanel
                    consensus={consensus !== null && consensus.ok ? consensus.data : null}
                    home={result.data.fixture.home.name}
                    away={result.data.fixture.away.name}
                    timeZone={timeZone}
                    locale={locale}
                    // Three numbers, pulled out here so the community panel never
                    // holds a forecast (rule 6). The comparison blueprint 4.2 asks
                    // for is a difference between two labelled answers, never a
                    // blend of them.
                    model={
                      forecasts !== null && forecasts.ok
                        ? (forecasts.data.latest?.probabilities ?? null)
                        : null
                    }
                  />
                  {/* Below the founder's analysis and visibly not it: a fourth
                    signed opinion, named as one (rule 6, T-263). */}
                  <CommunityAnalysisPanel
                    locale={locale}
                    analyses={
                      communityAnalyses !== null && communityAnalyses.ok
                        ? communityAnalyses.data
                        : null
                    }
                    reachable={communityAnalyses !== null && communityAnalyses.ok}
                  />
                </>
              ),
              discussion: (
                <>
                  {/* Outside any `me !== null` guard, and deliberately: reading
                    the public discussion is open to everybody, and a guard here
                    would have made it private without anybody deciding to. */}
                  <MatchPanel
                    locale={locale}
                    fixtureId={result.data.fixture.id}
                    deletedMemberLabel={t(resolved, 'account.deletedMember')}
                    page={panel !== null && panel.ok ? panel.data : null}
                    permission={
                      panelPermission !== null && panelPermission.ok ? panelPermission.data : null
                    }
                    reachable={panel !== null && panel.ok}
                    // What a post may link to (T-1030): this match's own
                    // incidents, line-ups and statistics, and the member's call.
                    linkChoices={linkChoices(result.data, prediction !== null)}
                    names={{
                      home: result.data.fixture.home.name,
                      away: result.data.fixture.away.name,
                    }}
                    me={me?.username ?? null}
                    followed={
                      followed !== null && followed.ok
                        ? followed.data.following.map((f) => f.username)
                        : []
                    }
                  />
                  {me !== null && (
                    <MatchThreads
                      locale={locale}
                      groups={groups !== null && groups.ok ? groups.data.groups : []}
                      reachable={groups !== null && groups.ok}
                      fixtureId={result.data.fixture.id}
                    />
                  )}
                </>
              ),
              watch: (
                <>
                  <ViewingPanel
                    locale={locale}
                    timeZone={timeZone}
                    viewing={viewing !== null && viewing.ok ? viewing.data : null}
                    kickoffAt={result.data.fixture.kickoff_at}
                    status={result.data.fixture.status}
                    variant="panel"
                    signedIn={me !== null}
                    href={`/${locale}/match/${result.data.fixture.id}`}
                    hidden={tzParam === undefined ? {} : { tz: tzParam }}
                    territories={territories}
                  />
                  {editor && desk !== null && desk.ok && (
                    <ViewingDesk
                      locale={locale}
                      fixtureId={result.data.fixture.id}
                      seasonId={result.data.fixture.season.id}
                      seasonLabel={result.data.fixture.season.label}
                      viewing={viewing !== null && viewing.ok ? viewing.data : null}
                      broadcasters={desk.data.broadcasters}
                    />
                  )}
                </>
              ),
              news: (
                <RelatedNews
                  locale={locale}
                  timeZone={timeZone}
                  news={news !== null && news.ok ? news.data : null}
                />
              ),
              players: (
                <KeyPlayersPanel
                  players={await keyPlayers.then((r) => (r.ok ? r.data : null))}
                  home={result.data.fixture.home.name}
                  away={result.data.fixture.away.name}
                  locale={locale}
                  timeZone={timeZone}
                />
              ),
            }}
          />
        </>
      )}
    </main>
  );
}
