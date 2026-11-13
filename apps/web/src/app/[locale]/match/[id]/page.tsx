import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import { ForecastPanel } from '@/components/forecast-panel';
import {
  ForecastDetails,
  ForecastReality,
  cardVersion,
  hasForecast,
  isUpcoming,
} from './forecast-reality';
import { MatchPickCard, PickBar } from './match-pick';
import { CommunityAnalysisPanel } from '@/components/community-analysis-panel';
import { CompetitionContextPanel } from '@/components/competition-context';
import {
  CommunityForecastPanel,
  CommunityPicksRow,
  CommunitySplit,
} from '@/components/community-consensus';
import { CommunityVoice, ThreeProductsNote } from '@/components/voices';
import { isLocked } from '@/lib/prediction-form';
import { FounderAnalysisPanel } from '@/components/founder-analysis';
import { JsonLd } from '@/components/json-ld';
import { KeyPlayersPanel } from '@/components/key-players';
import { LiveMatch } from '@/components/live-match';
import { DataCard } from '@/components/match-centre-cards';
import { MatchAvailability } from '@/components/match-availability';
import { Coverage, HeadToHead, MatchForm } from '@/components/match-record';
import { FinishedLineups } from '@/components/match-stats-panels';
import { MatchFollow } from '@/components/match-follow';
import { MatchToolsRow } from '@/components/match-tools-row';
import { MatchPanel } from '@/components/match-panel';
import { linkChoices } from '@/lib/panel-link';
import { MatchSummaryPanel } from '@/components/match-summary';
import { shootoutHero } from '@/components/match-key-events';
import { liveSlots } from '@/components/match-live-slots';
import { PowerIndexPanel } from '@/components/power-index-panel';
import { MatchThreads } from '@/components/match-threads';
import { RelatedNews } from '@/components/related-news';
import { VenueCard } from '@/components/venue-card';
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
  fetchPendingPick,
  fetchPanelPermission,
  fetchPowerIndex,
  fetchTerritories,
} from '@/lib/api';
import { readPick } from '@/lib/pick';
import { retryUnreachable } from '@/lib/live-modules';
import { isTimeZone } from '@/lib/scores';
import { canonicalUrl, matchJsonLd, pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { readTerritoryQuery } from '@/lib/viewing';
import { matchWords } from '@/lib/words-server';
import { stageAndRoundLabels } from '@/lib/stage-label';
import { Translated } from '@/components/translated';
import { scoreDisputeHero } from '@/components/score-dispute';
import { Notice } from '@/components/ui';
import { pageTimeZone } from '@/lib/reader-time-zone-server';
import { zoneWords } from '@/lib/reader-time-zone';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The match, asked once per request: the metadata and the page share the
 * answer (T-1536). Each API call carries its own request id, so `fetch` would
 * not merge the two by itself.
 */
const matchCentre = cache((id: string) =>
  // Asked twice before the page says it is unreachable (finding
  // arc-2026-11-13-01): a status change's or a panel event's refresh that
  // drew that notice would put it in place of the live view.
  retryUnreachable(() => fetchMatchCentre(id)),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const title = `${t(resolved, 'matchCentre.title')} · Stadiomind`;
  if (!UUID.test(id)) return { title, robots: { index: false, follow: false } };
  const result = await matchCentre(id);
  if (!result.ok) return pageMetadata({ locale, path: `/match/${id}`, title });
  const f = result.data.fixture;
  const teams = { home: f.home.name, away: f.away.name };
  return pageMetadata({
    locale,
    path: `/match/${f.id}`,
    title: `${interpolate(t(resolved, 'matchCentre.fixtureTitle'), teams)} · Stadiomind`,
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
  const territory = readTerritoryQuery(query);
  // The match and every read that needs only the match and the reader's
  // cookie (T-1536): asked together, so the page waits for the slowest answer
  // instead of the member, then the match, then the rest. An unknown match
  // 404s below, and these answers are then dropped.
  const centre = matchCentre(id);
  const reads = Promise.all([
    fetchForecasts(id),
    centre.then((r) =>
      r.ok && r.data.fixture.status === 'finished' ? fetchEvaluations(id) : null,
    ),
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
    // guest chose on this page.
    fetchMatchViewing(id, territory, cookie),
    // Related news (T-145): the news page's cards, for this match and its sides.
    fetchFixtureNews(id, locale),
    // The match summary (E41): a stored row, never a model call on this request.
    fetchMatchSummary(id),
  ]);
  // The competition context (T-840), awaited where its section is placed.
  const context = fetchCompetitionContext(id);

  const me = await fetchMe(cookie);
  // The pick the reader saved before their email address was confirmed
  // (T-1740, D-361), asked beside the rest and only where one can stand: a
  // member not confirmed yet, or any member once the match has kicked off
  // ("saved, not counted"). A read; nothing is written on a page load.
  const pendingRead =
    me === null
      ? Promise.resolve(null)
      : centre.then((r) =>
          r.ok && (!me.email_verified || isLocked(r.data.fixture.kickoff_at))
            ? fetchPendingPick(id, cookie)
            : null,
        );
  const tzParam = typeof query.tz === 'string' ? query.tz : undefined;
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

  const result = await centre;
  if (!result.ok && result.status === 404) notFound();
  const competitionContext = result.ok ? context : Promise.resolve(null);
  // The forecast (T-065), the Power Index (T-114) and, once the match is over,
  // its evaluation (T-066); a guest also needs the territories to choose from.
  const [
    [
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
      news,
      summary,
    ],
    territories,
  ] = result.ok
    ? await Promise.all([reads, me === null ? fetchTerritories() : Promise.resolve(null)])
    : [[null, null, null, null, null, null, null, null, null, null, null, null], null];
  const pendingPick = result.ok ? await pendingRead : null;

  // The final score, once there is one: what the three products are set against.
  const fixture = result.ok ? result.data.fixture : null;
  const final =
    fixture !== null && fixture.status === 'finished'
      ? (fixture.scores.full_time ?? fixture.scores.current)
      : null;
  // The model's versions and their evaluations, and the version the Summary's
  // card is about (T-1744): the lower section explains that same version.
  const forecastData = forecasts !== null && forecasts.ok ? forecasts.data : null;
  const evaluationData = evaluations !== null && evaluations.ok ? evaluations.data : null;
  const about =
    fixture === null || forecastData === null
      ? null
      : cardVersion(
          forecastData,
          evaluationData,
          fixture.status,
          fixture.kickoff_at,
          !isUpcoming(fixture),
        );
  const consensusData = consensus !== null && consensus.ok ? consensus.data : null;
  // "No forecast" is said once, by the Summary's card (T-1746, D-367), and
  // only when no stored version gave probabilities. When the match then has
  // no Power Index either, the card says both and the Power Index block is
  // not drawn to say it again. An index, a service that did not answer, or
  // an earlier version with numbers keeps its block.
  const powerData = power !== null && power.ok ? power.data : null;
  const noPowerIndex =
    forecastData !== null &&
    !hasForecast(forecastData) &&
    powerData !== null &&
    powerData.index === null;
  const viewingData = viewing !== null && viewing.ok ? viewing.data : null;
  // The match's own expected goals, for the Summary's "expected and scored".
  const xgRow =
    result.ok && result.data.statistics.data !== null
      ? result.data.statistics.data.find((row) => row.metric === 'expected_goals')
      : undefined;
  const matchXg =
    xgRow !== undefined && xgRow.home !== null && xgRow.away !== null
      ? { home: xgRow.home, away: xgRow.away }
      : null;
  const words = matchWords(locale);
  const now = new Date().getTime();
  // "Everton v Coventry": the share sheet's title and the push offer's name.
  const fixtureTitle =
    fixture === null
      ? null
      : interpolate(t(resolved, 'matchCentre.fixtureTitle'), {
          home: fixture.home.name,
          away: fixture.away.name,
        });

  return (
    // A data page (D-198): the stage, following Day and Night; the header and
    // the live strip above it are the layout's and stay as they are (T-1384).
    <main className="min-h-dvh bg-stage pb-8">
      {/* On a phone the tools row, the band and the tabs follow each other
          with no gap (T-1743, D-364): the first screen is for the forecast
          and the pick. */}
      <div className="page-frame flex flex-col md:gap-5 md:pt-4">
        {/* One row: back, the zone, Share and Follow (T-1743). */}
        <MatchToolsRow
          locale={locale}
          timeZone={timeZone}
          share={
            fixtureTitle === null || fixture === null
              ? null
              : { url: canonicalUrl(locale, `/match/${fixture.id}`), title: fixtureTitle }
          }
        >
          {fixture !== null && fixtureTitle !== null && (
            <MatchFollow
              locale={locale}
              fixtureId={fixture.id}
              name={fixtureTitle}
              status={fixture.status}
              signedIn={me !== null}
              following={following}
            />
          )}
        </MatchToolsRow>
        {!result.ok ? (
          <div className="flex flex-col gap-4 max-md:pt-2 md:gap-5">
            <h1 className="text-2xl font-semibold" data-testid="title">
              <Translated locale={locale} message="matchCentre.title" />
            </h1>
            <Notice tone="danger" data-testid="match-unreachable">
              <Translated locale={locale} message="matchCentre.unreachable" />
            </Notice>
          </div>
        ) : (
          <>
            <JsonLd data={matchJsonLd(locale, result.data.fixture)} />
            <LiveMatch
              initial={result.data}
              timeZone={timeZone}
              locale={locale}
              words={words}
              hero={{
                // The zone in words, beside the full kick-off in the phone's
                // details (T-1743): resolved here, off the client.
                zone: zoneWords(locale, timeZone),
                stage: stageAndRoundLabels(
                  result.data.fixture.stage?.name,
                  result.data.fixture.round,
                  (key) => words.m[key].text,
                  locale,
                )
                  .map((label) => ` · ${label}`)
                  .join(''),
                // The broadcasters under the score, each a link-out (T-1384);
                // the Watch section keeps the full list for the territory.
                watch: <WatchLine locale={locale} viewing={viewingData} />,
                // After full time the official highlight comes first.
                highlights:
                  final !== null ? <HighlightsLink locale={locale} viewing={viewingData} /> : null,
                // Still scheduled long after its kick-off (T-1708, D-343): the
                // API's derived state, said here so its words stay off the client.
                awaiting:
                  result.data.fixture.freshness === 'awaiting_update' ? (
                    <p
                      role="status"
                      className="text-center text-sm font-medium text-warning"
                      data-testid="awaiting-update"
                    >
                      <Translated locale={locale} message="matchCentre.awaitingUpdate" />
                    </p>
                  ) : undefined,
                // The recorded goals disagree with the result (T-1717, D-347):
                // the API's derived word, said here so its words stay off the client.
                disputed: scoreDisputeHero(locale, result.data.fixture),
                // Who won on penalties (T-1798, D-396): said here, off the client.
                penalties: shootoutHero(locale, result.data.fixture),
              }}
              slots={{
                // The moving modules (D-409), drawn here in every state so none
                // of them is in the page's JavaScript; in play `LiveMatch` has
                // them drawn again by `refreshLiveModules` when the stream says
                // they changed. Before kick-off the coming card stands where it
                // names them. The same cards the function draws (`liveSlots`).
                ...liveSlots({ centre: result.data, locale, timeZone, words }),
                // The Summary opens with what the model forecast and, after
                // full time, what happened (T-1497): the model's card alone,
                // drawn on the server, and the one place the forecast is
                // drawn on this page (T-1744, D-365). Before kick-off it is
                // the headline, so the pick can stand directly under it.
                outcome: (
                  <ForecastReality
                    forecasts={forecastData}
                    evaluations={evaluationData}
                    fixture={result.data.fixture}
                    final={final}
                    matchXg={matchXg}
                    timeZone={timeZone}
                    locale={locale}
                    noPowerIndex={noPowerIndex}
                  />
                ),
                // The reader's own pick, directly under the model's headline
                // (T-1739, D-360): the pick control in the section `#pick`,
                // with the outcome a guest's link brought back in `?pick=`
                // marked and never stored. The community's split opens in it
                // only once they have picked (D-206), so it cannot anchor a
                // pick. From kick-off on it is one locked row (T-1744).
                pick: (
                  <MatchPickCard
                    locale={locale}
                    fixture={result.data.fixture}
                    timeZone={timeZone}
                    me={me}
                    current={prediction}
                    pending={pendingPick}
                    chosen={readPick(query.pick)}
                    split={
                      <CommunitySplit
                        consensus={consensusData}
                        home={result.data.fixture.home.name}
                        away={result.data.fixture.away.name}
                        locale={locale}
                      />
                    }
                  />
                ),
                // Before kick-off, the rest of the model's card after the
                // pick (decision 4 of package 2): expected goals, likeliest
                // scores, every version and the receipt. Only the order
                // changed; from kick-off on the card above is whole.
                details:
                  isUpcoming(result.data.fixture) &&
                  forecastData !== null &&
                  forecastData.versions.some((v) => v.probabilities !== null) ? (
                    <ForecastDetails
                      forecasts={forecastData}
                      evaluations={evaluationData}
                      fixture={result.data.fixture}
                      matchXg={matchXg}
                      timeZone={timeZone}
                      locale={locale}
                    />
                  ) : null,
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
                coverage: <Coverage centre={result.data} words={words} locale={locale} />,
                // Who will miss the match (T-1810, D-409): a pre-match answer,
                // so drawn here and off the client like the form above.
                availability: (
                  <MatchAvailability
                    centre={result.data}
                    locale={locale}
                    timeZone={timeZone}
                    now={now}
                    words={words}
                  />
                ),
                // A finished match's line-ups (T-1801): drawn here and off the
                // client; in play the view draws them from the stream. The
                // statistics are `liveSlots`' since T-1813.
                ...(result.data.fixture.status === 'finished' && {
                  matchLineups: (
                    <FinishedLineups centre={result.data} locale={locale} words={words} />
                  ),
                }),
                venue: (
                  <VenueCard venue={result.data.fixture.venue} locale={locale} words={words} />
                ),
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
                // The lower Predictions section (T-1744, D-365): how the
                // model's forecast was reached -- the factors, what moved
                // between versions, the evaluation -- and the Power Index.
                // The forecast itself is the Summary's card and is not drawn
                // a second time here. With no forecast and no Power Index
                // there is no section: the card has said both (T-1746).
                forecast: noPowerIndex ? null : (
                  <>
                    <ForecastPanel
                      forecasts={forecastData}
                      evaluations={evaluationData}
                      about={about}
                      home={result.data.fixture.home.name}
                      away={result.data.fixture.away.name}
                      timeZone={timeZone}
                      locale={locale}
                    />
                    <DataCard>
                      <PowerIndexPanel power={powerData} timeZone={timeZone} locale={locale} />
                    </DataCard>
                  </>
                ),
                // The other predictions of this match, once each, directly
                // after the pick (T-1744, D-365). Each in its own section
                // with its own name and its own component: the model, the
                // founder and the community are never one panel (rule 6,
                // T-605). One with nothing to show is one compact row that
                // says why; one with content is its full card.
                analysis: (
                  <>
                    {/* A label over the group, not a heading: the founder's
                        analysis, the community and the contributors below
                        are headings of the same level, and a heading here
                        would contain none of them. */}
                    <p
                      className="text-xs font-extrabold tracking-wider text-muted uppercase [:root:is(:lang(fa),:lang(ar))_&]:normal-case"
                      data-testid="other-predictions"
                    >
                      <Translated locale={locale} message="lanes.others" />
                    </p>
                    {/* After full time the analysis also says whether the
                        published call matched the result. */}
                    <FounderAnalysisPanel
                      analysis={founder !== null && founder.ok ? founder.data : null}
                      result={final}
                      home={result.data.fixture.home.name}
                      away={result.data.fixture.away.name}
                      timeZone={timeZone}
                      locale={locale}
                    />
                  </>
                ),
                community: (
                  <>
                    {/* The community picks (T-1388): the members' spread,
                    which opens only once the reader has picked or kick-off has
                    locked every pick, so it cannot anchor a pick; after full
                    time, the share that picked what happened. With no
                    consensus, one row that says so. The reader's own pick is
                    the card under the model's headline (T-1739), once. */}
                    {consensusData === null || consensusData.data === null ? (
                      <CommunityPicksRow consensus={consensusData} locale={locale} />
                    ) : (
                      <CommunityVoice locale={locale}>
                        <CommunityForecastPanel
                          consensus={consensusData}
                          home={result.data.fixture.home.name}
                          away={result.data.fixture.away.name}
                          timeZone={timeZone}
                          locale={locale}
                          revealed={prediction !== null || isLocked(result.data.fixture.kickoff_at)}
                          result={final}
                          // Three numbers, pulled out here so the community panel never
                          // holds a forecast (rule 6). The comparison blueprint 4.2 asks
                          // for is a difference between two labelled answers, never a
                          // blend of them.
                          model={forecastData?.latest?.probabilities ?? null}
                        />
                      </CommunityVoice>
                    )}
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
                    {/* Where the three meet on one page, said once (T-1388). */}
                    <ThreeProductsNote locale={locale} />
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
      {/* On a phone, until kick-off: the call to pick, fixed above the tab
          bar, a link to the card (T-1739, D-360). */}
      {result.ok && (
        <PickBar
          locale={locale}
          fixture={result.data.fixture}
          timeZone={timeZone}
          current={prediction}
          pending={pendingPick}
        />
      )}
    </main>
  );
}
