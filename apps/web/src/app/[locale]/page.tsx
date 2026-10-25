import type { Metadata } from 'next';
import type { ScoreCard } from '@fmip/contracts';
import { BreakingStrip } from '@/components/breaking-strip';
import { FirstRunOffer } from '@/components/first-run-offer';
import {
  HomeDateline,
  KeyMatches,
  LeadMatchCard,
  LeadStory,
  RuleHeading,
  ThreeForecasts,
} from '@/components/home-front';
import {
  AccuracyCard,
  Broadcasts,
  ColumnAndPicks,
  GuestWelcome,
  MyTeams,
  NewsGrid,
  TableTopFive,
} from '@/components/home-rail';
import {
  FriendPredictionsSection,
  GroupDiscussionsSection,
  PanelsSection,
} from '@/components/home-member';
import { JsonLd } from '@/components/json-ld';
import { LinkedSentence } from '@/components/linked-sentence';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { message, t } from '@/i18n/messages';
import {
  fetchBreakingNews,
  fetchCompetitionTable,
  fetchConsensus,
  fetchFeaturedMatches,
  fetchFirstRun,
  fetchFollowing,
  fetchForecastSummaries,
  fetchFounderAnalysis,
  fetchFounderFeed,
  fetchFriendPredictions,
  fetchGroupDiscussions,
  fetchMe,
  fetchModelAccuracy,
  fetchNewsSection,
  fetchOwnPrediction,
  fetchPanelLatest,
  fetchScores,
  fetchTeam,
  fetchViewingBatch,
} from '@/lib/api';
import {
  HOME_DAYS,
  HOME_MY_TEAMS,
  HOME_STORIES,
  accuracyFigure,
  allCards,
  competitionsOn,
  featuredNotes,
  homeBroadcasts,
  homePanels,
  keyDay,
  keyMatchGroups,
  leadMatch,
  leadStory,
  tableCompetition,
  tableRowOf,
  todayFixtureIds,
} from '@/lib/home';
import { stageName } from '@/lib/competition';
import { rootTitle } from '@/lib/demonstration';
import { readGuestChoices } from '@/lib/first-run-cookie';
import { feedsStale } from '@/lib/news';
import { isLocked } from '@/lib/prediction-form';
import { type CardForecast, batches, cardForecast } from '@/lib/score-card-products';
import { dateIn, shiftDate } from '@/lib/scores';
import { pageMetadata, websiteJsonLd } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { territoryName } from '@/lib/territory';
import { readerTimeZone } from '@/lib/reader-time-zone';

// The API is queried per request, so a build never depends on it being up.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '',
    // The only page in the layout's own segment, so the layout's title
    // template does not reach it and it carries the marker itself (T-087).
    title: rootTitle('Stadiomind', locale),
    description: t(isLocale(locale) ? locale : DEFAULT_LOCALE, 'shell.meta.description'),
  });
}

/** The model's pre-kick-off summary per match, one request per 50 (T-940), in parallel. */
async function loadForecasts(ids: string[]): Promise<Map<string, CardForecast>> {
  const out = new Map<string, CardForecast>();
  await Promise.all(
    batches(ids).map(async (group) => {
      const answer = await fetchForecastSummaries(group);
      const found = new Map(
        answer.ok ? answer.data.fixtures.map((e) => [e.fixture_id, e.pre_kickoff]) : [],
      );
      for (const id of group) {
        out.set(id, answer.ok ? cardForecast(found.get(id) ?? null) : { state: 'unreachable' });
      }
    }),
  );
  return out;
}

/**
 * The homepage in the Hybrid design (T-1382, D-200; boards h1 and h9): an
 * editorial front page on paper whatever the theme. The lead story, else the
 * day's biggest match; the three forecasts kept apart for that match; the
 * day's key matches by competition; beside them the league's top five, the
 * model's accuracy, today's broadcasts and the member's teams; then the news.
 *
 * Three rounds of requests, each in parallel (D-115, D-200): what needs no
 * zone, then the scores in the reader's zone, then what the scores choose.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const cookie = await sessionCookieHeader();
  const session = cookie !== undefined;

  // Round 1: everything that does not depend on the reader's zone.
  const [
    me,
    following,
    guestChoices,
    firstRun,
    news,
    breaking,
    featured,
    founderFeed,
    accuracy,
    friendCalls,
    groupTalk,
  ] = await Promise.all([
    fetchMe(cookie),
    // The member's teams: "Your teams" first, the lead match, "My teams".
    fetchFollowing(cookie),
    readGuestChoices(),
    session ? fetchFirstRun(cookie) : null,
    // T-1457: only what the page shows -- one more, as the breaking lead
    // may be among them -- not a whole page of the section.
    fetchNewsSection(`?limit=${HOME_STORIES + 1}`, locale, cookie),
    // T-1004 (D-125): read at render, so an expired mark is gone now.
    fetchBreakingNews(locale),
    // T-1161 (D-153): the matches an editor features now.
    fetchFeaturedMatches(),
    // The founder's analysis of what is coming (T-132).
    fetchFounderFeed({ limit: 3 }),
    // T-1369 (D-187): the public accuracy figures.
    fetchModelAccuracy('week'),
    session ? fetchFriendPredictions(cookie) : null,
    session ? fetchGroupDiscussions(cookie) : null,
  ]);
  const member = me !== null;

  // The first run (T-620): offered once to a member, and to a guest until they
  // finish it or say not now; a guest's confirmed zone is used for their times.
  const guest = member ? null : guestChoices;
  const offerFirstRun =
    guest !== null
      ? guest.done !== true && guest.dismissed !== true
      : firstRun?.state === 'pending';

  // Times are the member's zone, else the zone a guest chose, else the
  // locale's default (UK time on /en, D-207), and say which.
  const timeZone = readerTimeZone(locale, me, guest);
  const now = new Date();
  const today = dateIn(timeZone, now);

  // Round 2: the scores, asked without the session (D-200) so the groups come
  // in the competitions' stated order (D-154); the member's teams are lifted
  // here from what they follow.
  const scores = await fetchScores(
    new URLSearchParams({
      from: today,
      to: shiftDate(today, HOME_DAYS - 1),
      tz: timeZone,
    }).toString(),
    undefined,
  );
  const followedTeams = new Set(
    member ? (following ?? []).filter((e) => e.entity_type === 'team').map((e) => e.entity_id) : [],
  );
  const notes = featuredNotes(featured.ok ? featured.data.features : null);
  const day = scores.ok ? keyDay(scores.data, today, timeZone) : null;
  const groups =
    scores.ok && day !== null ? keyMatchGroups(scores.data, day, timeZone, followedTeams) : [];
  const lead = scores.ok
    ? leadMatch(scores.data, today, timeZone, followedTeams, new Set(notes.keys()))
    : null;
  const tableId = scores.ok ? tableCompetition(scores.data) : null;
  const todayIds = scores.ok ? todayFixtureIds(scores.data, today, timeZone) : [];
  const todayCards = scores.ok
    ? allCards(scores.data).filter((card) => todayIds.includes(card.id))
    : [];
  const territory = guest?.territory;
  const askViewing = todayIds.length > 0 && (member || territory !== undefined);
  const myTeams = member
    ? (following ?? []).filter((e) => e.entity_type === 'team').slice(0, HOME_MY_TEAMS)
    : [];
  const forecastIds = [
    ...new Set([
      ...(lead === null ? [] : [lead.id]),
      ...groups.flatMap((g) => g.cards.map((c) => c.id)),
    ]),
  ];

  // Round 3: what the scores chose, in parallel.
  const [
    forecasts,
    table,
    leadTable,
    founder,
    consensus,
    ownPick,
    panelsLatest,
    viewing,
    teamPages,
  ] = await Promise.all([
    loadForecasts(forecastIds),
    // T-1460: the tables alone, not the whole competition pages.
    tableId !== null ? fetchCompetitionTable(tableId, locale) : null,
    lead !== null && lead.competition.id !== tableId
      ? fetchCompetitionTable(lead.competition.id, locale)
      : null,
    lead !== null ? fetchFounderAnalysis(lead.id) : null,
    lead !== null ? fetchConsensus(lead.id) : null,
    lead !== null && member ? fetchOwnPrediction(lead.id, cookie) : null,
    todayIds.length > 0 ? fetchPanelLatest(todayIds) : null,
    askViewing ? fetchViewingBatch(todayIds, member ? undefined : territory, cookie) : null,
    Promise.all(myTeams.map((team) => fetchTeam(team.entity_id, locale))),
  ]);

  const { lead: story, rest: breakingRest } = leadStory(
    breaking.ok ? breaking.data.stories.data : null,
  );
  const leadTablePage = lead === null ? null : lead.competition.id === tableId ? table : leadTable;
  const leadRows =
    leadTablePage !== null && leadTablePage.ok ? leadTablePage.data.table.data : null;
  const leadForecast: CardForecast =
    lead === null ? { state: 'none' } : (forecasts.get(lead.id) ?? { state: 'unreachable' });
  const panels =
    panelsLatest === null ? [] : panelsLatest.ok ? homePanels(panelsLatest.data.panels) : null;
  const cardsById = new Map<string, ScoreCard>(
    scores.ok ? allCards(scores.data).map((card) => [card.id, card] as const) : [],
  );
  const stories = news.ok
    ? (news.data.stories.data ?? [])
        .filter((s) => s.story_id !== story?.story_id)
        .slice(0, HOME_STORIES)
    : [];
  const context =
    lead === null
      ? null
      : [
          lead.competition.short_name ?? lead.competition.name,
          lead.round === null ? null : stageName(locale, lead.round),
        ]
          .filter((part) => part !== null)
          .join(' · ');

  return (
    <main data-mode="editorial" className="pb-12">
      <JsonLd data={websiteJsonLd(locale)} />
      <div className="page-frame">
        <HomeDateline locale={lang} timeZone={timeZone} now={now.toISOString()} context={context} />
      </div>
      <div className="page-frame flex flex-col gap-8 pt-6">
        {breakingRest.length > 0 && <BreakingStrip locale={locale} stories={breakingRest} />}
        {offerFirstRun && <FirstRunOffer locale={locale} />}

        <div className="flex flex-wrap gap-x-12 gap-y-10">
          <div className="flex min-w-0 flex-[999_1_40rem] flex-col gap-8">
            {story !== null && <LeadStory story={story} locale={lang} timeZone={timeZone} />}
            {lead !== null && (
              <LeadMatchCard
                card={lead}
                forecast={leadForecast}
                homeRow={tableRowOf(leadRows, lead.home.id)}
                awayRow={tableRowOf(leadRows, lead.away.id)}
                tableSize={leadRows?.length ?? 0}
                note={notes.get(lead.id) ?? null}
                today={today}
                locale={lang}
                timeZone={timeZone}
              />
            )}
            {lead !== null && (
              <ThreeForecasts
                card={lead}
                forecast={leadForecast}
                founder={founder !== null && founder.ok ? founder.data : null}
                consensus={consensus !== null && consensus.ok ? consensus.data : null}
                revealed={
                  ownPick != null || lead.status !== 'scheduled' || isLocked(lead.kickoff_at)
                }
                locale={lang}
                timeZone={timeZone}
              />
            )}
            {!scores.ok || day === null ? (
              <section aria-labelledby="home-key" data-testid="home-matches-none">
                <RuleHeading
                  id="home-key"
                  title={<Translated locale={lang} message="home.key.title" />}
                />
                <p className="text-sm text-muted">
                  <Translated
                    locale={lang}
                    message={scores.ok ? 'home.key.empty' : 'home.key.unreachable'}
                  />
                </p>
              </section>
            ) : (
              <KeyMatches
                groups={groups}
                isToday={day === today}
                day={day}
                forecasts={forecasts}
                notes={notes}
                competitions={competitionsOn(scores.data, day, timeZone)}
                scoresHref={`/${locale}/scores${day === today ? '' : `?date=${day}`}`}
                signedIn={member}
                locale={lang}
                timeZone={timeZone}
              />
            )}
            {member && (
              <FriendPredictionsSection
                locale={locale}
                timeZone={timeZone}
                result={friendCalls?.ok === true ? friendCalls.data.predictions : null}
              />
            )}
            {member && (
              <GroupDiscussionsSection
                locale={locale}
                viewer={me.username}
                result={groupTalk?.ok === true ? groupTalk.data.discussions : null}
              />
            )}
            {todayIds.length > 0 && (
              <PanelsSection locale={locale} panels={panels} cards={cardsById} />
            )}
            <ColumnAndPicks
              analyses={founderFeed.ok ? founderFeed.data.analyses : null}
              locale={lang}
            />
          </div>

          <aside className="flex min-w-0 flex-[1_1_21rem] flex-col gap-8 xl:max-w-[26.25rem]">
            {table !== null && table.ok && <TableTopFive page={table.data} locale={lang} />}
            <AccuracyCard
              figure={accuracy.ok ? accuracyFigure(accuracy.data) : null}
              reachable={accuracy.ok}
              locale={lang}
              timeZone={timeZone}
            />
            {viewing !== null && (
              <Broadcasts
                broadcasts={homeBroadcasts(
                  todayCards,
                  viewing.ok ? viewing.data.fixtures : null,
                  (code) => territoryName(lang, code),
                )}
                locale={lang}
                timeZone={timeZone}
              />
            )}
            {member && (
              <MyTeams
                teams={
                  following === null
                    ? null
                    : myTeams.map((team, index) => {
                        const page = teamPages[index];
                        return {
                          id: team.entity_id,
                          name: team.name,
                          page: page !== undefined && page.ok ? page.data : null,
                        };
                      })
                }
                followsNone={following !== null && myTeams.length === 0}
                locale={lang}
                timeZone={timeZone}
              />
            )}
            {member && (
              <p className="text-sm">
                <LinkedSentence
                  sentence={message(lang, 'home.feed')}
                  link={message(lang, 'home.feed.link')}
                  href={`/${locale}/following`}
                />
              </p>
            )}
            {!member && (
              <GuestWelcome locale={lang}>
                <p data-testid="first-visit">
                  <LinkedSentence
                    sentence={message(lang, 'home.firstVisit')}
                    link={message(lang, 'home.firstVisit.link')}
                    href={`/${locale}/about`}
                  />
                </p>
                <p data-testid="guest-invite">
                  <LinkedSentence
                    sentence={message(lang, 'home.guestInvite')}
                    link={message(lang, 'home.guestInvite.link')}
                    href={`/${locale}/register`}
                  />
                </p>
              </GuestWelcome>
            )}
          </aside>
        </div>

        {stories.length > 0 && (
          <NewsGrid
            stories={stories}
            stale={news.ok && feedsStale(news.data.stories.last_updated_at, now)}
            locale={lang}
            timeZone={timeZone}
          />
        )}
      </div>
    </main>
  );
}
