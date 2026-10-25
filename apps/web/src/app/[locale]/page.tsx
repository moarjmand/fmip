import type { Metadata } from 'next';
import type { ScoreCard } from '@fmip/contracts';
import { BreakingStrip } from '@/components/breaking-strip';
import { FirstRunOffer } from '@/components/first-run-offer';
import {
  BigMatch,
  HomeDateline,
  LiveNow,
  RuleHeading,
  TodayByCompetition,
} from '@/components/home-front';
import {
  Broadcasts,
  ColumnAndPicks,
  GuestWelcome,
  MonthFigures,
  MyTeams,
  NewsGrid,
  TableExcerpt,
  UpsetCard,
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
  fetchForecasts,
  fetchFounderAnalysis,
  fetchFounderFeed,
  fetchFriendPredictions,
  fetchGroupDiscussions,
  fetchMe,
  fetchModelAccuracy,
  fetchModelUpset,
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
  LIVE_STRIP,
  accuracyFigure,
  allCards,
  featuredNotes,
  heroMatch,
  heroVersion,
  homeBroadcasts,
  homePanels,
  keyDay,
  keyMatchGroups,
  liveCards,
  liveCheckedAt,
  matchesOn,
  tableCompetition,
  tableRowOf,
  todayFixtureIds,
} from '@/lib/home';
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
 * The home page in the Stadiomind design (T-1495, D-263, D-270; the canvas
 * boards Home and HomePhone): the day's heading, the matches in play, the big
 * match with the model's forecast and the other two voices kept apart, and
 * today by competition; beside them the league's table, the model's figures,
 * today's broadcasts and the member's teams; then the member's sections and
 * the news (blueprint 2.3).
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
    // The member's teams: their own card in "today", the hero, "My teams".
    fetchFollowing(cookie),
    readGuestChoices(),
    session ? fetchFirstRun(cookie) : null,
    // T-1457: only what the page shows, not a whole page of the section.
    fetchNewsSection(`?limit=${HOME_STORIES}`, locale, cookie),
    // T-1004 (D-125): read at render, so an expired mark is gone now.
    fetchBreakingNews(locale),
    // T-1161 (D-153): the matches an editor features now.
    fetchFeaturedMatches(),
    // The founder's analysis of what is coming (T-132).
    fetchFounderFeed({ limit: 3 }),
    // T-1369 (D-187): the public accuracy figures, by month (T-1516, D-270).
    fetchModelAccuracy('month'),
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
  const [scores, upset] = await Promise.all([
    fetchScores(
      new URLSearchParams({
        from: today,
        to: shiftDate(today, HOME_DAYS - 1),
        tz: timeZone,
      }).toString(),
      undefined,
    ),
    // T-1507 (D-265): the day's biggest miss, on the day the scores call today.
    fetchModelUpset({ date: today, tz: timeZone }),
  ]);
  const upsetAnswer = upset.ok ? upset.data : null;
  const followedTeams = new Set(
    member ? (following ?? []).filter((e) => e.entity_type === 'team').map((e) => e.entity_id) : [],
  );
  const notes = featuredNotes(featured.ok ? featured.data.features : null);
  const day = scores.ok ? keyDay(scores.data, today, timeZone) : null;
  const groups =
    scores.ok && day !== null ? keyMatchGroups(scores.data, day, timeZone, followedTeams) : [];
  const hero = scores.ok
    ? heroMatch(scores.data, today, timeZone, followedTeams, new Set(notes.keys()))
    : null;
  const lead = hero?.card ?? null;
  const live = scores.ok ? liveCards(scores.data) : [];
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

  // Round 3: what the scores chose, in parallel.
  const [
    forecasts,
    versions,
    table,
    leadTable,
    founder,
    consensus,
    ownPick,
    panelsLatest,
    viewing,
    teamPages,
  ] = await Promise.all([
    loadForecasts(lead === null ? [] : [lead.id]),
    // The hero's versions, for what the bar's version stored (T-1495).
    lead !== null ? fetchForecasts(lead.id) : null,
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

  // Every story still marked breaking, the newest mark first (D-125).
  const marked = (breaking.ok ? (breaking.data.stories.data ?? []) : [])
    .filter((story) => story.breaking !== null)
    .sort((a, b) => (b.breaking?.marked_at ?? '').localeCompare(a.breaking?.marked_at ?? ''));
  const leadTablePage = lead === null ? null : lead.competition.id === tableId ? table : leadTable;
  const leadRows =
    leadTablePage !== null && leadTablePage.ok ? leadTablePage.data.table.data : null;
  const leadVersion =
    lead !== null && versions !== null && versions.ok
      ? heroVersion(versions.data.versions, lead.kickoff_at)
      : null;
  // The bar is of the version the figures come from when it could be read,
  // else the pre-kick-off summary, so the two never disagree.
  const leadForecast: CardForecast =
    lead === null
      ? { state: 'none' }
      : leadVersion !== null
        ? cardForecast(leadVersion)
        : (forecasts.get(lead.id) ?? { state: 'unreachable' });
  const panels =
    panelsLatest === null ? [] : panelsLatest.ok ? homePanels(panelsLatest.data.panels) : null;
  const cardsById = new Map<string, ScoreCard>(
    scores.ok ? allCards(scores.data).map((card) => [card.id, card] as const) : [],
  );
  const stories = news.ok ? (news.data.stories.data ?? []).slice(0, HOME_STORIES) : [];
  const scoresHref = `/${locale}/scores`;

  return (
    <main className="pb-12">
      <JsonLd data={websiteJsonLd(locale)} />
      <div className="page-frame flex flex-col gap-6 pt-6">
        {marked.length > 0 && <BreakingStrip locale={locale} stories={marked} />}
        {offerFirstRun && <FirstRunOffer locale={locale} />}
        <HomeDateline locale={lang} timeZone={timeZone} now={now.toISOString()} />

        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[999_1_40rem] flex-col gap-6">
            {live.length > 0 && (
              <LiveNow
                cards={live.slice(0, LIVE_STRIP)}
                total={live.length}
                checkedAt={liveCheckedAt(live)}
                scoresHref={scoresHref}
                locale={lang}
                timeZone={timeZone}
              />
            )}
            {hero !== null && (
              <BigMatch
                hero={hero}
                forecast={leadForecast}
                version={leadVersion}
                homeRow={tableRowOf(leadRows, hero.card.home.id)}
                awayRow={tableRowOf(leadRows, hero.card.away.id)}
                tableSize={leadRows?.length ?? 0}
                note={notes.get(hero.card.id) ?? null}
                founder={founder !== null && founder.ok ? founder.data : null}
                consensus={consensus !== null && consensus.ok ? consensus.data : null}
                revealed={
                  ownPick != null ||
                  hero.card.status !== 'scheduled' ||
                  isLocked(hero.card.kickoff_at)
                }
                locale={lang}
                timeZone={timeZone}
              />
            )}
            {/* After the hero on a phone, as HomePhone has it; in the side column on a desktop. */}
            <UpsetCard answer={upsetAnswer} placement="main" locale={lang} timeZone={timeZone} />
            {!scores.ok || day === null ? (
              <section aria-labelledby="home-today" data-testid="home-matches-none">
                <RuleHeading
                  id="home-today"
                  title={<Translated locale={lang} message="home.today.title" />}
                />
                <p className="text-sm text-muted">
                  <Translated
                    locale={lang}
                    message={scores.ok ? 'home.key.empty' : 'home.key.unreachable'}
                  />
                </p>
              </section>
            ) : (
              <TodayByCompetition
                groups={groups}
                isToday={day === today}
                day={day}
                total={matchesOn(scores.data, day, timeZone)}
                scoresHref={`${scoresHref}${day === today ? '' : `?date=${day}`}`}
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
              timeZone={timeZone}
            />
          </div>

          <aside className="flex min-w-0 flex-[1_1_21rem] flex-col gap-6 xl:max-w-[26.25rem]">
            <UpsetCard answer={upsetAnswer} placement="side" locale={lang} timeZone={timeZone} />
            {table !== null && table.ok && (
              <TableExcerpt page={table.data} locale={lang} timeZone={timeZone} />
            )}
            <MonthFigures
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
