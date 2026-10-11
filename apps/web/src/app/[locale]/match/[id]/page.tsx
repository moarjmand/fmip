import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import { ForecastPanel, ModelVerdict } from '@/components/forecast-panel';
import { CommunityAnalysisPanel } from '@/components/community-analysis-panel';
import { CompetitionContextPanel } from '@/components/competition-context';
import {
  CommunityForecastPanel,
  CommunitySplit,
  CommunityVerdict,
} from '@/components/community-consensus';
import { CommunityLane, ThreeProductsNote } from '@/components/product-lanes';
import { isLocked } from '@/lib/prediction-form';
import { FounderAnalysisPanel, FounderVerdict } from '@/components/founder-analysis';
import { JsonLd } from '@/components/json-ld';
import { KeyPlayersPanel } from '@/components/key-players';
import { LiveMatch } from '@/components/live-match';
import { DataCard, VerdictCard } from '@/components/match-centre-cards';
import { Coverage, HeadToHead, MatchForm } from '@/components/match-record';
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
import { HighlightsLink, ViewingPanel, WatchLine } from '@/components/viewing-panel';
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
import { pageTimeZone } from '@/lib/reader-time-zone-server';
import { zoneWords } from '@/lib/reader-time-zone';

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
  // The reader's zone (D-207): a `tz` on the link, else the member's or a
  // guest's choice, else the locale's default (UK time on /en).
  const timeZone =
    tzParam !== undefined && isTimeZone(tzParam)
      ? tzParam
      : (await pageTimeZone(locale, me)).timeZone;

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

  // The final score, once there is one: what the three products are set against.
  const fixture = result.ok ? result.data.fixture : null;
  const final =
    fixture !== null && fixture.status === 'finished'
      ? (fixture.scores.full_time ?? fixture.scores.current)
      : null;
  const viewingData = viewing !== null && viewing.ok ? viewing.data : null;
  const words = matchWords(locale);
  const now = new Date().getTime();

  return (
    // A data page (D-198): the stage, following Day and Night; the header and
    // the live strip above it are the layout's and stay as they are (T-1384).
    <main className="min-h-dvh bg-stage pb-8">
      <div className="page-frame flex flex-col gap-4 pt-2 md:gap-5 md:pt-4">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Link href={`/${locale}/scores`} className="inline-flex min-h-11 items-center underline">
            <Translated locale={locale} message="matchCentre.back" />
          </Link>
          <span className="text-muted" data-testid="timezone">
            <FilledMessage
              message={message(resolved, 'scores.timesIn')}
              params={{ zone: timeZone, zoneName: zoneWords(locale, timeZone) }}
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
              words={words}
              hero={{
                // The broadcasters under the score, each a link-out (T-1384);
                // the Watch section keeps the full list for the territory.
                watch: <WatchLine locale={locale} viewing={viewingData} />,
                // After full time the official highlight comes first.
                highlights:
                  final !== null ? <HighlightsLink locale={locale} viewing={viewingData} /> : null,
              }}
              slots={{
                // What does not move in play, drawn here so its code stays out
                // of the page's client bundle (T-1384).
                form: (
                  <MatchForm
                    centre={result.data}
                    timeZone={timeZone}
                    locale={locale}
                    words={words}
                  />
                ),
                headToHead: (
                  <HeadToHead
                    centre={result.data}
                    timeZone={timeZone}
                    locale={locale}
                    words={words}
                  />
                ),
                coverage: <Coverage centre={result.data} words={words} />,
                // Each product in its own section with its own name: the model, the
                // founder and the community are never one panel (rule 6, T-605).
                // The machine-written summary exists only after full time; no
                // empty card before it (rule 3).
                summary:
                  final !== null ? (
                    <DataCard>
                      <MatchSummaryPanel
                        locale={locale}
                        timeZone={timeZone}
                        fixtureId={result.data.fixture.id}
                        status={result.data.fixture.status}
                        summary={summary !== null && summary.ok ? summary.data : null}
                        editor={editor}
                      />
                    </DataCard>
                  ) : null,
                // After full time: what each product said against what happened,
                // three lanes from three components (rule 6, T-1384).
                verdict:
                  final !== null ? (
                    <VerdictCard
                      title={<Translated locale={locale} message="matchCentre.verdict.title" />}
                      note={<ThreeProductsNote locale={locale} />}
                    >
                      <ModelVerdict
                        forecasts={forecasts !== null && forecasts.ok ? forecasts.data : null}
                        evaluations={
                          evaluations !== null && evaluations.ok ? evaluations.data : null
                        }
                        kickoffAt={result.data.fixture.kickoff_at}
                        result={final}
                        home={result.data.fixture.home.name}
                        away={result.data.fixture.away.name}
                        timeZone={timeZone}
                        locale={locale}
                      />
                      <FounderVerdict
                        analysis={founder !== null && founder.ok ? founder.data : null}
                        result={final}
                        home={result.data.fixture.home.name}
                        away={result.data.fixture.away.name}
                        timeZone={timeZone}
                        locale={locale}
                      />
                      <CommunityLane locale={locale}>
                        <CommunityVerdict
                          consensus={consensus !== null && consensus.ok ? consensus.data : null}
                          result={final}
                          home={result.data.fixture.home.name}
                          away={result.data.fixture.away.name}
                          locale={locale}
                        />
                      </CommunityLane>
                    </VerdictCard>
                  ) : null,
                context: (
                  <DataCard>
                    <CompetitionContextPanel
                      context={await competitionContext.then((r) =>
                        r !== null && r.ok ? r.data : null,
                      )}
                      locale={locale}
                      timeZone={timeZone}
                    />
                  </DataCard>
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
                    <DataCard>
                      <PowerIndexPanel
                        power={power !== null && power.ok ? power.data : null}
                        timeZone={timeZone}
                        locale={locale}
                      />
                    </DataCard>
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
                    {/* The community picks lane (T-1388): the reader's own pick and
                    the members' spread, which opens only once they have picked or
                    kick-off has locked every pick, so it cannot anchor a pick. */}
                    <CommunityLane locale={locale}>
                      <PredictionSection
                        locale={locale}
                        fixture={result.data.fixture}
                        me={me}
                        current={prediction}
                        split={
                          <CommunitySplit
                            consensus={consensus !== null && consensus.ok ? consensus.data : null}
                            home={result.data.fixture.home.name}
                            away={result.data.fixture.away.name}
                            locale={locale}
                          />
                        }
                      />
                      <CommunityForecastPanel
                        consensus={consensus !== null && consensus.ok ? consensus.data : null}
                        home={result.data.fixture.home.name}
                        away={result.data.fixture.away.name}
                        timeZone={timeZone}
                        locale={locale}
                        revealed={prediction !== null || isLocked(result.data.fixture.kickoff_at)}
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
                    </CommunityLane>
                    {/* Where the three meet on one page, said once (T-1388). */}
                    <ThreeProductsNote locale={locale} />
                    {/* Below the founder's analysis and visibly not it: a fourth
                    signed opinion, named as one (rule 6, T-263). */}
                    <DataCard>
                      <CommunityAnalysisPanel
                        locale={locale}
                        analyses={
                          communityAnalyses !== null && communityAnalyses.ok
                            ? communityAnalyses.data
                            : null
                        }
                        reachable={communityAnalyses !== null && communityAnalyses.ok}
                      />
                    </DataCard>
                  </>
                ),
                discussion: (
                  <>
                    {/* Outside any `me !== null` guard, and deliberately: reading
                    the public discussion is open to everybody, and a guard here
                    would have made it private without anybody deciding to. */}
                    <DataCard>
                      <MatchPanel
                        locale={locale}
                        fixtureId={result.data.fixture.id}
                        deletedMemberLabel={t(resolved, 'account.deletedMember')}
                        page={panel !== null && panel.ok ? panel.data : null}
                        permission={
                          panelPermission !== null && panelPermission.ok
                            ? panelPermission.data
                            : null
                        }
                        reachable={panel !== null && panel.ok}
                        // What a post may link to (T-1030): this match's own
                        // incidents, line-ups and statistics, and the member's call.
                        linkChoices={linkChoices(result.data, prediction !== null, locale)}
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
                    </DataCard>
                    {me !== null && (
                      <DataCard>
                        <MatchThreads
                          locale={locale}
                          groups={groups !== null && groups.ok ? groups.data.groups : []}
                          reachable={groups !== null && groups.ok}
                          fixtureId={result.data.fixture.id}
                        />
                      </DataCard>
                    )}
                  </>
                ),
                watch: (
                  <>
                    <DataCard>
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
                    </DataCard>
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
                  <DataCard>
                    <RelatedNews
                      locale={locale}
                      timeZone={timeZone}
                      news={news !== null && news.ok ? news.data : null}
                    />
                  </DataCard>
                ),
                players: (
                  <DataCard>
                    <KeyPlayersPanel
                      players={await keyPlayers.then((r) => (r.ok ? r.data : null))}
                      home={result.data.fixture.home.name}
                      away={result.data.fixture.away.name}
                      locale={locale}
                      timeZone={timeZone}
                      now={now}
                    />
                  </DataCard>
                ),
              }}
            />
          </>
        )}
      </div>
    </main>
  );
}
