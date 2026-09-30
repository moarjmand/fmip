import type { Metadata } from 'next';
import Link from 'next/link';
import { BreakingStrip } from '@/components/breaking-strip';
import { FirstRunOffer } from '@/components/first-run-offer';
import { JsonLd } from '@/components/json-ld';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import {
  FriendPredictionsSection,
  GroupDiscussionsSection,
  PanelsSection,
} from '@/components/home-member';
import { LinkedSentence } from '@/components/linked-sentence';
import { LtrNumeric } from '@/components/score';
import { CardViewingLine } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type Message, type MessageKey, attribute, interpolate, message, t } from '@/i18n/messages';
import { MessageText } from '@/components/message-text';
import {
  fetchBreakingNews,
  fetchCompetition,
  fetchFeaturedMatches,
  fetchFirstRun,
  fetchForecastList,
  fetchFounderFeed,
  fetchFriendPredictions,
  fetchGroupDiscussions,
  fetchMe,
  fetchNewsSection,
  fetchPanelLatest,
  fetchScores,
  fetchViewingBatch,
} from '@/lib/api';
import {
  HOME_DAYS,
  HOME_MATCHES,
  HOME_TABLE_ROWS,
  featuredNotes,
  homeForecasts,
  homeMatches,
  homePanels,
  homeViewing,
  shortDay,
  tableCompetition,
  todayFixtureIds,
} from '@/lib/home';
import { dateIn, formatKickoff, shiftDate, statusLabel } from '@/lib/scores';
import { rootTitle } from '@/lib/demonstration';
import { readGuestChoices } from '@/lib/first-run-cookie';
import { pageMetadata, websiteJsonLd } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

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
    title: rootTitle('FMIP'),
    description: t(isLocale(locale) ? locale : DEFAULT_LOCALE, 'shell.meta.description'),
  });
}

/** A list of rows in one bordered box, a hairline between rows (T-1201). */
const LIST = 'flex flex-col divide-y divide-default rounded border border-default bg-surface';
/** A row's own link: the row is the target, so the underline waits for a pointer or focus. */
const ROW_LINK = 'font-medium hover:underline focus-visible:underline';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const num = (value: number) => formatNumber(lang, value);
  /** A sentence with its `{placeholders}` filled, keeping where its words came from. */
  const filled = (key: MessageKey, values: Record<string, string>): Message => {
    const said = message(lang, key);
    return { ...said, text: interpolate(said.text, values) };
  };
  const cookie = await sessionCookieHeader();
  // The API's uptime and the locale code were printed at the foot of this
  // page since Phase 0; they are the System page's business (T-804), not a
  // reader's, and went in the design pass (T-1201).
  const [founder, me] = await Promise.all([
    // The blueprint puts the founder's analysis on the homepage "for selected
    // matches"; the feed is upcoming matches only, so there is nothing to
    // select — what exists is what is coming (T-132).
    fetchFounderFeed({ limit: 3 }),
    // Only to offer the first-visit page to someone who is not signed in (T-523).
    fetchMe(cookie),
  ]);

  // The first run (T-620): offered once to a member, and to a guest until they
  // finish it or say not now; a guest's confirmed zone is used for their times.
  const guest = me === null ? await readGuestChoices() : null;
  const firstRun = me === null ? null : await fetchFirstRun(cookie);
  const offerFirstRun =
    guest !== null
      ? guest.done !== true && guest.dismissed !== true
      : firstRun?.state === 'pending';

  // Blueprint 2.3 (T-526): the homepage is made of answers the product already
  // gives, each block shown only when it has something real in it (rule 3).
  // Times are the member's zone, else the zone a guest chose, else UTC, and say which.
  const timeZone = me?.timezone ?? guest?.timezone ?? 'UTC';
  const today = dateIn(timeZone, new Date());
  const [scores, news, breaking, featured] = await Promise.all([
    fetchScores(
      new URLSearchParams({
        from: today,
        to: shiftDate(today, HOME_DAYS - 1),
        tz: timeZone,
      }).toString(),
      cookie,
    ),
    fetchNewsSection('', locale, cookie),
    // T-1004 (D-125): the strip, read at render, so an expired mark is gone now.
    fetchBreakingNews(locale),
    // T-1161 (D-153): the matches an editor features now, read at render, so
    // an expired feature is gone now. Unreachable reads as nothing featured.
    fetchFeaturedMatches(),
  ]);
  const notes = featuredNotes(featured.ok ? featured.data.features : null);
  const matches = scores.ok ? homeMatches(scores.data, HOME_MATCHES, new Set(notes.keys())) : [];
  const tableId = scores.ok ? tableCompetition(scores.data) : null;
  // T-942 (D-115): every section below is one request for the whole page,
  // all in parallel with the forecasts and the table. The member sections and
  // the viewing lines are asked for a member only: a guest has no friends,
  // groups or stored territory, and is not told those sections are empty.
  const todayIds = scores.ok ? todayFixtureIds(scores.data, today, timeZone) : [];
  const member = me !== null;
  const [forecasts, table, friendCalls, groupTalk, panelsLatest, viewing] = await Promise.all([
    matches.length > 0 ? fetchForecastList(matches.map((card) => card.id)) : null,
    tableId !== null ? fetchCompetition(tableId, '', locale) : null,
    member ? fetchFriendPredictions(cookie) : null,
    member ? fetchGroupDiscussions(cookie) : null,
    todayIds.length > 0 ? fetchPanelLatest(todayIds) : null,
    member && matches.length > 0
      ? fetchViewingBatch(
          matches.map((card) => card.id),
          undefined,
          cookie,
        )
      : null,
  ]);
  const watch =
    viewing === null ? null : homeViewing(matches, viewing.ok ? viewing.data.fixtures : null);
  const panels =
    panelsLatest === null ? [] : panelsLatest.ok ? homePanels(panelsLatest.data.panels) : null;
  const cardsById = new Map(
    scores.ok
      ? [...scores.data.pinned, ...scores.data.groups.flatMap((group) => group.fixtures)].map(
          (card) => [card.id, card] as const,
        )
      : [],
  );
  const modelView =
    forecasts !== null && forecasts.ok ? homeForecasts(matches, forecasts.data.fixtures) : [];
  const tableRows =
    table !== null && table.ok ? (table.data.table.data ?? []).slice(0, HOME_TABLE_ROWS) : [];
  const stories = news.ok ? (news.data.stories.data ?? []).slice(0, 5) : [];
  const played = attribute(lang, 'home.table.played');
  const points = attribute(lang, 'home.table.points');

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:p-8">
      <JsonLd data={websiteJsonLd(locale)} />
      {/*
        The accent bar is deliberately asymmetric and deliberately logical:
        `border-s` and `ps` sit on the inline start, so they move to the right
        edge under `dir="rtl"`. The Playwright check in tests/e2e asserts exactly
        that, which makes this element the canary for a physical-property
        regression that slipped past lint.
      */}
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        FMIP
      </h1>
      <p>
        <LinkedSentence
          sentence={message(lang, 'home.tagline')}
          link={message(lang, 'home.tagline.link')}
          href={`/${locale}/scores`}
        />
      </p>
      {breaking.ok && breaking.data.stories.data !== null && (
        <BreakingStrip locale={locale} stories={breaking.data.stories.data} />
      )}
      {offerFirstRun && <FirstRunOffer locale={locale} />}
      {me === null && (
        <p data-testid="first-visit">
          <LinkedSentence
            sentence={message(lang, 'home.firstVisit')}
            link={message(lang, 'home.firstVisit.link')}
            href={`/${locale}/about`}
          />
        </p>
      )}
      {me === null && (
        <p className="text-sm" data-testid="guest-invite">
          <LinkedSentence
            sentence={message(lang, 'home.guestInvite')}
            link={message(lang, 'home.guestInvite.link')}
            href={`/${locale}/register`}
          />
        </p>
      )}
      {me !== null && (
        <p className="text-sm">
          <LinkedSentence
            sentence={message(lang, 'home.feed')}
            link={message(lang, 'home.feed.link')}
            href={`/${locale}/following`}
          />
        </p>
      )}

      {matches.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="home-matches">
          <h2 className="text-lg font-semibold">
            <Translated locale={lang} message="home.matches.title" />
          </h2>
          {/*
            A fixed time column and the match beside it, so every row lines up
            however long the names are (the design pass, T-1201).
          */}
          <ul className={LIST}>
            {matches.map((card) => (
              <li key={card.id} className="grid grid-cols-[6.5rem_1fr] gap-x-3 px-3 py-2">
                <span className="text-sm text-muted tabular-nums">
                  {card.status === 'scheduled'
                    ? `${shortDay(locale, card.kickoff_at, timeZone)} ${formatKickoff(locale, card.kickoff_at, timeZone)}`
                    : statusLabel(card, locale, timeZone)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <Link href={`/${locale}/match/${card.id}`} className={ROW_LINK}>
                    {card.home.name}{' '}
                    {card.scores.current !== null ? (
                      <LtrNumeric>
                        {num(card.scores.current.home)}–{num(card.scores.current.away)}
                      </LtrNumeric>
                    ) : (
                      <Translated locale={lang} message="home.versus" />
                    )}{' '}
                    {card.away.name}
                  </Link>
                  <span className="text-xs text-muted">
                    {card.competition.short_name ?? card.competition.name}
                  </span>
                  {notes.has(card.id) && (
                    // The editor's placement, in their words; it says nothing
                    // about who will win (rule 6).
                    <span className="text-xs" data-testid="home-featured-note">
                      <span className="font-semibold">
                        <Translated locale={lang} message="home.featured" />
                      </span>
                      : {notes.get(card.id)}
                    </span>
                  )}
                  {watch?.state === 'lines' && (
                    <span className="text-xs">
                      <CardViewingLine viewing={watch.byFixture.get(card.id)} locale={locale} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {watch?.state === 'ask' && (
            // Once for the list, not the same question on every line (D-115).
            <p className="text-sm" data-testid="home-viewing-ask">
              <LinkedSentence
                sentence={message(lang, 'home.watch.ask')}
                link={message(lang, 'viewing.choose')}
                href={`/${locale}/watch`}
              />
            </p>
          )}
          {watch?.state === 'unreachable' && (
            <p className="text-sm text-muted" data-testid="home-viewing-unreachable">
              <Translated locale={lang} message="home.watch.unreachable" />
            </p>
          )}
          <p className="text-sm">
            <Link href={`/${locale}/scores`} className="underline">
              <Translated locale={lang} message="home.allScores" />
            </Link>{' '}
            <MessageText
              className="text-muted"
              message={filled('home.timesIn', { zone: timeZone })}
            />
          </p>
        </section>
      )}

      {modelView.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="home-forecasts">
          <h2 className="text-lg font-semibold">
            <Translated locale={lang} message="home.model.title" />
          </h2>
          <ul className={LIST}>
            {modelView.map(({ card, percent }) => (
              <li key={card.id} className="flex flex-col px-3 py-2">
                <Link href={`/${locale}/match/${card.id}`} className={ROW_LINK}>
                  <MessageText
                    message={filled('home.fixture', {
                      home: card.home.name,
                      away: card.away.name,
                    })}
                  />
                </Link>
                <MessageText
                  className="text-sm text-muted tabular-nums"
                  message={filled('home.model.line', {
                    home: card.home.short_name ?? card.home.name,
                    homePercent: num(percent.home),
                    draw: num(percent.draw),
                    away: card.away.short_name ?? card.away.name,
                    awayPercent: num(percent.away),
                  })}
                />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            <MessageText
              message={filled('home.model.note', { version: modelView[0]?.modelVersion ?? '' })}
            />
          </p>
        </section>
      )}

      {me !== null && (
        <FriendPredictionsSection
          locale={locale}
          timeZone={timeZone}
          result={friendCalls?.ok === true ? friendCalls.data.predictions : null}
        />
      )}

      {me !== null && (
        <GroupDiscussionsSection
          locale={locale}
          viewer={me.username}
          result={groupTalk?.ok === true ? groupTalk.data.discussions : null}
        />
      )}

      {todayIds.length > 0 && <PanelsSection locale={locale} panels={panels} cards={cardsById} />}

      {founder.ok && (
        <FounderAnalysisFeed
          analyses={founder.data.analyses}
          locale={locale}
          timeZone="UTC"
          heading={t(lang, 'home.founder.heading')}
        />
      )}

      {table !== null && table.ok && tableRows.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="home-table">
          <h2 className="text-lg font-semibold">
            <Link
              href={`/${locale}/competition/${table.data.competition.id}`}
              className="underline"
            >
              {table.data.competition.name}
            </Link>
          </h2>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-default text-xs text-muted">
                <th scope="col" className="w-8 py-1 text-start font-normal">
                  #
                </th>
                <th scope="col" className="py-1 text-start font-normal">
                  <Translated locale={lang} message="home.table.team" />
                </th>
                <th scope="col" className="w-10 py-1 text-end font-normal">
                  <abbr title={played.text} lang={played.lang}>
                    <Translated locale={lang} message="home.table.playedShort" />
                  </abbr>
                </th>
                <th scope="col" className="w-12 py-1 text-end font-normal">
                  <abbr title={points.text} lang={points.lang}>
                    <Translated locale={lang} message="home.table.pointsShort" />
                  </abbr>
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.team.id} className="border-b border-default last:border-b-0">
                  <td className="py-1.5 text-muted">{num(row.position)}</td>
                  <td className="py-1.5">{row.team.name}</td>
                  <td className="py-1.5 text-end text-muted">{num(row.played)}</td>
                  <td className="py-1.5 text-end font-semibold">{num(row.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {stories.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="home-news">
          <h2 className="text-lg font-semibold">
            <Translated locale={lang} message="home.news.title" />
          </h2>
          <ul className={LIST}>
            {stories.map((story) => (
              <li key={story.story_id} className="px-3 py-2">
                <Link href={`/${locale}/news/story/${story.story_id}`} className={ROW_LINK}>
                  {story.headline}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
