import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import {
  MAX_CONSENSUS_FIXTURES,
  type ConsensusListEntry,
  type ForecastVersion,
  type Prediction,
} from '@fmip/contracts';
import { CommunityConsensusList, CommunitySplit } from '@/components/community-consensus';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import { ForecastList } from '@/components/forecast-panel';
import { MemberName } from '@/components/member-name';
import { ModelAccuracyRecent } from '@/components/model-accuracy';
import { InlinePick } from '@/components/prediction-section';
import {
  CommunityLane,
  FounderLane,
  ModelLane,
  ThreeProductsNote,
} from '@/components/product-lanes';
import {
  fetchConsensusList,
  fetchForecastList,
  fetchForecasts,
  fetchFounderFeed,
  fetchLeaderboard,
  fetchMe,
  fetchModelAccuracy,
  fetchMyPredictions,
  fetchOwnPrediction,
  fetchScores,
} from '@/lib/api';
import { isLocked } from '@/lib/prediction-form';
import {
  HISTORY_LOOKUPS,
  PREDICTION_DAYS,
  ownPredictions,
  predictionDays,
} from '@/lib/predictions-days';
import { readScoresQuery, shiftDate } from '@/lib/scores';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Icon, Notice } from '@/components/ui';
import { Translated } from '@/components/translated';
import { interpolate, t } from '@/i18n/messages';
import { asLocale, plainNumber, ratingText } from '@/lib/prediction-text';
import { pageTimeZone } from '@/lib/reader-time-zone-server';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l = asLocale(locale);
  return pageMetadata({
    locale,
    path: '/predictions',
    title: t(l, 'predictions.page.title'),
    description: t(l, 'predictions.page.description'),
  });
}

/**
 * The Predictions page (blueprint 2.1, T-137), in the Hybrid design's
 * editorial mode (T-1383, D-201): on paper whatever the theme, a serif
 * display, rules rather than boxes.
 *
 * Blueprint 2.1 names four things under Predictions: "model forecasts, founder
 * analysis, community consensus and prediction leaderboards". This is the one
 * page in the product where all three prediction products appear together,
 * which makes it the page rule 6 was written for.
 *
 * **So they are four sections, not one list.** There is no combined feed, no
 * shared row component and no "prediction" with a source beside it. Each
 * section is rendered by a component that belongs to that product and can
 * render nothing else, from an endpoint that serves only that product. The
 * model's list carries, in each match's row, a slot the page fills with the
 * community's own pick control: two products side by side in their own
 * colours, never one figure (the scores card's rule, T-940).
 *
 * The matches come from the scores boundary, today and the next days, asked
 * without the session so the competitions keep D-154's order; a competition
 * filter narrows them. The member's picks come from one page of their own
 * history, with a per-match read only where that page cannot answer.
 */
export default async function PredictionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const l = asLocale(locale);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const q = readScoresQuery(query, (await pageTimeZone(locale, me)).timeZone);
  const competition = q.filters?.competition ?? null;

  const to = shiftDate(q.date, PREDICTION_DAYS - 1);
  const scoresQuery = new URLSearchParams({ from: q.date, to, tz: q.timezone }).toString();
  const [scores, founder, leaderboard, accuracy] = await Promise.all([
    // Without the session: the order is `display_order` (D-154), not the
    // member's follows, as the live strip asks (D-199).
    fetchScores(scoresQuery, undefined),
    fetchFounderFeed({ limit: 5 }),
    fetchLeaderboard('limit=10'),
    fetchModelAccuracy(),
  ]);

  const list = scores.ok
    ? predictionDays(scores.data, {
        from: q.date,
        timeZone: q.timezone,
        competition,
        // The endpoints cap at this; asking for more would be a 400 rather
        // than a longer page.
        limit: MAX_CONSENSUS_FIXTURES,
      })
    : null;
  const shown = list?.shown ?? [];
  const fixtureIds = shown.map((card) => card.id);
  const names = new Map(
    shown.map((card) => [card.id, { home: card.home.name, away: card.away.name }]),
  );

  const [forecasts, consensus, mine] = await Promise.all([
    fixtureIds.length === 0 ? Promise.resolve(null) : fetchForecastList(fixtureIds),
    fixtureIds.length === 0 ? Promise.resolve(null) : fetchConsensusList(fixtureIds),
    me === null || cookie === undefined || fixtureIds.length === 0
      ? Promise.resolve(null)
      : fetchMyPredictions(cookie, MAX_CONSENSUS_FIXTURES),
  ]);
  const latest = forecasts !== null && forecasts.ok ? forecasts.data.fixtures : null;

  // The version history, only where there is more than the latest version,
  // and for the first few such matches in page order (D-201).
  const recomputed = (latest ?? [])
    .filter((entry) => entry.latest !== null && entry.latest.version_number > 1)
    .map((entry) => entry.fixture_id)
    .slice(0, HISTORY_LOOKUPS);

  // The member's own picks: one page of their history, then a read per match
  // only for a match that page could not answer for.
  const own =
    mine !== null && mine.ok && mine.data.kind === 'visible'
      ? ownPredictions(mine.data.items, mine.data.items.length >= MAX_CONSENSUS_FIXTURES, shown)
      : { found: new Map<string, Prediction>(), missing: me === null ? [] : fixtureIds };

  const [historyResults, lookedUp] = await Promise.all([
    Promise.all(recomputed.map((id) => fetchForecasts(id))),
    Promise.all(own.missing.map((id) => fetchOwnPrediction(id, cookie))),
  ]);
  const histories: Record<string, ForecastVersion[] | null> = {};
  recomputed.forEach((id, i) => {
    const result = historyResults[i];
    histories[id] = result !== undefined && result.ok ? result.data.versions : null;
  });
  own.missing.forEach((id, i) => {
    const prediction = lookedUp[i];
    if (prediction !== undefined && prediction !== null) own.found.set(id, prediction);
  });

  const consensusById = new Map<string, ConsensusListEntry['consensus']>(
    consensus !== null && consensus.ok
      ? consensus.data.fixtures.map((entry) => [entry.fixture_id, entry.consensus])
      : [],
  );
  // A spread is shown once the reader has picked the match, or kick-off has
  // locked every pick (D-206).
  const revealed = new Set(
    shown
      .filter((card) => own.found.has(card.id) || isLocked(card.kickoff_at))
      .map((card) => card.id),
  );
  const picks: Record<string, ReactNode> = {};
  for (const card of shown) {
    picks[card.id] = (
      <InlinePick
        locale={locale}
        fixture={{
          id: card.id,
          kickoff_at: card.kickoff_at,
          home: card.home.name,
          away: card.away.name,
        }}
        me={me}
        current={own.found.get(card.id) ?? null}
        split={
          revealed.has(card.id) || me !== null ? (
            <CommunitySplit
              consensus={
                consensus !== null && consensus.ok ? (consensusById.get(card.id) ?? null) : null
              }
              home={card.home.name}
              away={card.away.name}
              locale={locale}
            />
          ) : undefined
        }
      />
    );
  }

  const filterHref = (id: string | null): string => {
    const p = new URLSearchParams();
    if (q.date !== q.today) p.set('date', q.date);
    if (q.explicitTimezone) p.set('tz', q.timezone);
    if (id !== null) p.set('competition', id);
    const s = p.toString();
    return `/${locale}/predictions${s === '' ? '' : `?${s}`}#model`;
  };
  const pill =
    'inline-flex min-h-touch items-center rounded-pill border px-3.5 text-sm whitespace-nowrap';
  const filter =
    list !== null && list.competitions.length > 1 ? (
      <nav
        aria-label={t(l, 'predictions.filter.label')}
        className="flex flex-wrap items-center gap-2"
        data-testid="predictions-filter"
      >
        <span className="me-1 text-xs font-bold tracking-wide text-muted uppercase">
          <Translated locale={l} message="predictions.filter.title" />
        </span>
        {[{ id: null, name: null }, ...list.competitions].map((option) => {
          const current = option.id === null ? competition === null : option.id === competition;
          return (
            <Link
              key={option.id ?? 'all'}
              href={filterHref(option.id)}
              aria-current={current ? 'true' : undefined}
              className={
                current
                  ? `${pill} border-fg bg-fg font-bold text-canvas`
                  : `${pill} border-strong bg-surface font-semibold`
              }
            >
              {option.name === null ? (
                <Translated locale={l} message="predictions.filter.all" />
              ) : (
                option.name
              )}
            </Link>
          );
        })}
      </nav>
    ) : null;

  return (
    <main data-mode="editorial" className="bg-canvas text-fg">
      <div className="page-frame flex flex-col gap-10 py-8 md:py-10">
        <header className="flex max-w-measure flex-col gap-3">
          <p className="text-xs font-bold tracking-widest text-accent uppercase">
            <Translated locale={l} message="predictions.page.kicker" />
          </p>
          <h1
            className="font-serif text-display-2 font-semibold md:text-display-4"
            data-testid="title"
          >
            <Translated locale={l} message="nav.predictions" />
          </h1>
          <p className="font-article text-article text-muted">
            <Translated locale={l} message="predictions.page.intro" />
          </p>
          {/* The three products, each by its own name and colour, to its own section. */}
          <nav
            aria-label={t(l, 'predictions.page.jump')}
            className="flex flex-wrap gap-x-5 gap-y-1"
            data-testid="predictions-jump"
          >
            <a
              href="#model"
              className="inline-flex min-h-touch items-center gap-1.5 font-semibold text-model"
            >
              <Icon name="model" size={16} />
              <Translated locale={l} message="lanes.model.title" />
            </a>
            <a
              href="#analysis"
              className="inline-flex min-h-touch items-center gap-1.5 font-semibold text-founder"
            >
              <Icon name="founder" size={16} />
              <Translated locale={l} message="lanes.founder.title" />
            </a>
            <a
              href="#community"
              className="inline-flex min-h-touch items-center gap-1.5 font-semibold text-community"
            >
              <Icon name="community" size={16} />
              <Translated locale={l} message="lanes.community.title" />
            </a>
          </nav>
          <p className="text-sm text-caption">
            <Link href={`/${locale}/scores`} className="underline">
              <Translated locale={l} message="predictions.page.allScores" />
            </Link>
            {' · '}
            <Link
              href={`/${locale}/leaderboard`}
              className="underline"
              data-testid="predictions-leaderboard-link"
            >
              <Translated locale={l} message="predictions.page.fullLeaderboard" />
            </Link>
          </p>
        </header>

        {list === null ? (
          <Notice tone="danger" data-testid="predictions-unreachable">
            <Translated locale={l} message="predictions.page.unreachable" />
          </Notice>
        ) : list.days.length === 0 ? (
          <section id="model" className="flex flex-col gap-3" data-testid="predictions-model">
            <h2 className="border-t-2 border-fg pt-2.5 font-serif text-display-1 font-semibold">
              <Translated locale={l} message="forecast.list.title" />
            </h2>
            {filter}
            <p className="text-sm text-muted" data-testid="predictions-empty">
              {interpolate(t(l, 'predictions.page.emptyDays'), {
                count: plainNumber(l, PREDICTION_DAYS),
              })}
            </p>
          </section>
        ) : (
          <ForecastList
            days={list.days}
            entries={latest}
            histories={histories}
            picks={picks}
            filter={filter}
            omitted={list.omitted}
            today={q.today}
            timeZone={q.timezone}
            locale={locale}
          />
        )}

        <ModelLane locale={locale}>
          <ModelAccuracyRecent locale={locale} report={accuracy.ok ? accuracy.data : null} />
        </ModelLane>

        <div className="grid gap-6 lg:grid-cols-2">
          {/*
            The feed component renders nothing when it is empty, which is right
            on the homepage and wrong here: this page promises four things, and
            a section that silently disappears leaves a reader unable to tell
            whether the founder has written nothing or the site forgot to ask.
            So the absence is stated. The header's Analysis leads here (T-1381,
            D-199): the founder's analysis has no page of its own yet. Published
            before kick-off, as blueprint 6.5 says, never sealed (D-206).
          */}
          <div id="analysis" className="scroll-mt-4">
            <FounderLane locale={locale} className="h-full">
              {founder.ok && founder.data.analyses.length > 0 ? (
                <FounderAnalysisFeed
                  analyses={founder.data.analyses}
                  locale={locale}
                  timeZone={q.timezone}
                  heading={<Translated locale={l} message="analysis.founder.title" />}
                />
              ) : (
                <section className="flex flex-col gap-2" data-testid="predictions-founder">
                  <h2 className="font-serif text-2xl font-semibold">
                    <Translated locale={l} message="analysis.founder.title" />
                  </h2>
                  <p className="text-sm text-muted">
                    <Translated
                      locale={l}
                      message={
                        founder.ok
                          ? 'predictions.page.founderNone'
                          : 'predictions.page.founderUnreachable'
                      }
                    />
                  </p>
                </section>
              )}
            </FounderLane>
          </div>
          <div id="community" className="scroll-mt-4">
            <CommunityLane locale={locale} className="h-full">
              {consensus !== null && !consensus.ok ? (
                <section className="flex flex-col gap-2" data-testid="predictions-consensus">
                  <h2 className="font-serif text-2xl font-semibold">
                    <Translated locale={l} message="matchCentre.community.listTitle" />
                  </h2>
                  <p className="text-sm text-muted">
                    <Translated locale={l} message="matchCentre.community.unreachable" />
                  </p>
                </section>
              ) : (
                <CommunityConsensusList
                  entries={consensus !== null && consensus.ok ? consensus.data.fixtures : []}
                  fixtures={names}
                  revealed={revealed}
                  locale={locale}
                />
              )}
            </CommunityLane>
          </div>
        </div>
        <ThreeProductsNote locale={locale} />

        <section className="flex flex-col gap-3" data-testid="predictions-leaderboard">
          <h2 className="border-t-2 border-fg pt-2.5 font-serif text-display-1 font-semibold">
            <Translated locale={l} message="predictions.page.leaderboardTitle" />
          </h2>
          <p className="text-sm text-muted">
            <Translated locale={l} message="predictions.page.leaderboardNote" />
          </p>
          {!leaderboard.ok ? (
            <p className="text-sm text-muted">
              <Translated locale={l} message="predictions.page.leaderboardUnreachable" />
            </p>
          ) : leaderboard.data.entries.length === 0 ? (
            <p className="text-sm text-muted">
              <Translated locale={l} message="predictions.page.leaderboardEmpty" />
            </p>
          ) : (
            <ol className="flex flex-col">
              {leaderboard.data.entries.map((entry) => (
                <li
                  key={entry.username}
                  className="flex flex-wrap items-baseline gap-x-3 border-b border-default py-2 text-sm"
                >
                  <span className="w-8 font-sans text-lg font-black font-stretch-condensed tabular-nums text-caption">
                    {plainNumber(l, entry.rank)}
                  </span>
                  <MemberName
                    locale={locale}
                    member={entry}
                    link
                    className="font-semibold underline"
                  />
                  <span className="text-muted">
                    <Translated
                      locale={l}
                      message={
                        entry.provisional
                          ? 'predictions.page.entryProvisional'
                          : 'predictions.page.entry'
                      }
                      count={entry.settled_count}
                      params={{ rating: ratingText(l, entry.rating) }}
                    />
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Link
            href={`/${locale}/leaderboard`}
            className="inline-flex min-h-touch items-center gap-1.5 font-bold text-accent"
          >
            <Translated locale={l} message="predictions.page.fullLeaderboard" />
            <Icon name="forward" size={16} />
          </Link>
        </section>
      </div>
    </main>
  );
}
