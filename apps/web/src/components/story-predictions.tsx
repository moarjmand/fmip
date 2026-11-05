import type { CoverageState, MatchHeader } from '@fmip/contracts';
import { MIN_CONSENSUS_SAMPLE } from '@fmip/contracts';
import type { ReactNode } from 'react';
import Link from '@/components/ui/link';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import { ForecastBar } from '@/components/forecast-bar';
import { ModelBox } from '@/components/model-box';
import { PickLink } from '@/components/pick-link';
import { Translated } from '@/components/translated';
import { CoverageBadge } from '@/components/ui';
import { formatDate, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { type MessageKey, message } from '@/i18n/messages';
import { COVERAGE_KEY } from '@/lib/competition';
import { pickCardPath, pickOpen } from '@/lib/pick';
import { zoneWords } from '@/lib/reader-time-zone';
import type { CardForecast } from '@/lib/score-card-products';
import { formatKickoff } from '@/lib/scores';
import { forecastBarWords } from '@/lib/words-server';

/**
 * "Predictions for this match" on the story page (T-1741, D-362; it replaces
 * T-941's three links, which showed nothing): when the story is linked to a
 * match that has not kicked off, the two sides, the kick-off in the reader's
 * zone, the statistical model's bar in the `ModelBox` with its version and
 * time, and "Make your pick on the match page", a link to that page's pick
 * card. The card holds no pick buttons.
 *
 * The three products stay three (rule 6). Only the model's figures are
 * drawn, in the model's box. The founder's analysis and the community
 * consensus are each one sentence of their own, under their own names,
 * saying whether there is one -- a link to its section of the match page
 * when there is, "none published yet" or "not yet" when there is not -- and
 * the card is never handed their words or figures: it takes a state for
 * each, so it cannot draw them, let alone beside the model's.
 *
 * Nothing is drawn as if it were there (rule 3). A story linked to no match,
 * a match that could not be read, and a match with no forecast are each one
 * line with the coverage badge that names the state; a match already under
 * way says picks are closed and sends the reader to the match page. A server
 * component: links and markup, no client code.
 */

/** The match a story is about, as much of the match centre's header as the card draws. */
export type StoryMatch = Pick<
  MatchHeader,
  'id' | 'kickoff_at' | 'status' | 'competition' | 'home' | 'away'
>;

/** Whether the founder has published an analysis of the match: a fact, never his words. */
export type StoryFounder = 'published' | 'none' | 'unreachable';

/** Whether the community's consensus is published (the floor of D-052 met): a fact, never a figure. */
export type StoryCommunity = 'published' | 'below_floor' | 'unreachable';

export type StoryPredictionsAbout =
  /** The story links no match. */
  | { state: 'no_match' }
  /** It links one, and the match could not be read. */
  | { state: 'unreachable'; fixtureId: string }
  | {
      state: 'match';
      match: StoryMatch;
      forecast: CardForecast;
      founder: StoryFounder;
      community: StoryCommunity;
    };

/**
 * What the card shows: `forecast` (the full card), `no_forecast` (the match
 * and the pick, with the model's missing forecast said), `started` (the
 * match is under way or over: picks are closed), `unreachable`, `no_match`.
 */
export type StoryPredictionsState =
  'forecast' | 'no_forecast' | 'started' | 'unreachable' | 'no_match';

export function storyPredictionsState(
  about: StoryPredictionsAbout,
  now: number,
): StoryPredictionsState {
  if (about.state !== 'match') return about.state;
  if (!pickOpen(about.match, now)) return 'started';
  return about.forecast.state === 'available' ? 'forecast' : 'no_forecast';
}

/**
 * The coverage a missing forecast is said with: `delayed` when the service
 * did not answer (it may yet), `not_supplied` when there is none to show.
 */
export function forecastCoverage(forecast: CardForecast): CoverageState {
  if (forecast.state === 'available') return 'available';
  return forecast.state === 'unreachable' ? 'delayed' : 'not_supplied';
}

const FOUNDER_KEY: Record<StoryFounder, MessageKey> = {
  published: 'story.predictions.founderPublished',
  none: 'story.predictions.founderNone',
  unreachable: 'story.predictions.founderUnknown',
};

const COMMUNITY_KEY: Record<StoryCommunity, MessageKey> = {
  published: 'story.predictions.communityIn',
  below_floor: 'story.predictions.communityNotYet',
  unreachable: 'story.predictions.communityUnknown',
};

const LINK = 'inline-flex min-h-touch items-center font-bold text-accent underline';

export function StoryPredictions({
  about,
  locale,
  timeZone,
  now,
}: {
  about: StoryPredictionsAbout;
  locale: string;
  timeZone: string;
  /** The moment the page was rendered: a kick-off already past offers no pick. */
  now: number;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const state = storyPredictionsState(about, now);
  return (
    <section
      aria-labelledby="story-predictions"
      className="flex flex-col gap-3 text-sm"
      data-testid="story-predictions"
      data-state={state}
    >
      <h2 id="story-predictions" className="text-sm font-extrabold">
        <Translated locale={l} message="story.predictions.title" />
      </h2>
      {about.state === 'no_match' ? (
        <Missing locale={l} coverage="not_supplied" message="story.predictions.noMatch" />
      ) : about.state === 'unreachable' ? (
        <>
          <Missing locale={l} coverage="delayed" message="story.predictions.matchUnreachable" />
          <MatchLink locale={l} fixtureId={about.fixtureId} />
        </>
      ) : (
        <Match about={about} state={state} locale={l} timeZone={timeZone} />
      )}
    </section>
  );
}

/** One line in place of what is not there, led by the badge that names the state (rule 3). */
function Missing({
  locale,
  coverage,
  message: key,
}: {
  locale: Locale;
  coverage: CoverageState;
  message: MessageKey;
}) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted"
      data-testid="story-predictions-missing"
      data-coverage={coverage}
    >
      <CoverageBadge
        state={coverage}
        label={<Translated locale={locale} message={COVERAGE_KEY[coverage]} />}
      />
      <Translated locale={locale} message={key} />
    </p>
  );
}

function MatchLink({ locale, fixtureId }: { locale: Locale; fixtureId: string }) {
  return (
    <p>
      <Link
        href={`/${locale}/match/${encodeURIComponent(fixtureId)}`}
        className={LINK}
        data-testid="story-predictions-match"
      >
        <Translated locale={locale} message="story.matchCentre" />
      </Link>
    </p>
  );
}

function Match({
  about,
  state,
  locale,
  timeZone,
}: {
  about: Extract<StoryPredictionsAbout, { state: 'match' }>;
  state: StoryPredictionsState;
  locale: Locale;
  timeZone: string;
}) {
  const { match, forecast } = about;
  const zone = zoneWords(locale, timeZone);
  const day = formatDate(locale, match.kickoff_at, timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return (
    <>
      <p
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-extrabold"
        data-testid="story-predictions-teams"
      >
        <Side team={match.home} />
        <span className="font-medium text-caption">
          <Translated locale={locale} message="scores.preview.versus" />
        </span>
        <Side team={match.away} />
      </p>
      <p className="text-muted" data-testid="story-predictions-when">
        <bdi>{match.competition.short_name ?? match.competition.name}</bdi>
        {' · '}
        {day}
        {' · '}
        <time dateTime={match.kickoff_at}>
          {formatKickoff(locale, match.kickoff_at, timeZone)}
        </time>{' '}
        {zone}
      </p>

      {state === 'started' ? (
        <>
          <p className="text-muted" data-testid="story-predictions-started">
            <Translated locale={locale} message="story.predictions.started" />
          </p>
          <MatchLink locale={locale} fixtureId={match.id} />
        </>
      ) : (
        <>
          {/* The model's product, in the model's box and nowhere else on the card. */}
          <ModelBox locale={locale} testId="story-model">
            {forecast.state !== 'available' && (
              <CoverageBadge
                state={forecastCoverage(forecast)}
                label={
                  <Translated locale={locale} message={COVERAGE_KEY[forecastCoverage(forecast)]} />
                }
                className="self-start"
              />
            )}
            <ForecastBar
              forecast={forecast}
              home={match.home.name}
              away={match.away.name}
              locale={locale}
              timeZone={timeZone}
              zone={zone}
              words={forecastBarWords(locale)}
            />
          </ModelBox>
          <PickLink
            href={pickCardPath(locale, match.id)}
            testId="story-pick"
            className="sm:self-start"
          >
            <Translated locale={locale} message="story.predictions.pick" />
          </PickLink>
        </>
      )}

      {/* Two more products, each its own sentence under its own name (rule 6). */}
      <div className="flex flex-col gap-1.5 text-muted">
        <ProductLine
          testId="story-product-analysis"
          state={about.founder}
          message={message(locale, FOUNDER_KEY[about.founder])}
          params={{
            founder: <Name locale={locale} message="story.predictions.founder" />,
            link: (
              <Link href={`/${locale}/match/${match.id}#analysis`} className={LINK}>
                <Translated locale={locale} message="story.predictions.founderRead" />
              </Link>
            ),
          }}
        />
        <ProductLine
          testId="story-product-community"
          state={about.community}
          message={message(locale, COMMUNITY_KEY[about.community])}
          params={{
            community: <Name locale={locale} message="story.predictions.community" />,
            floor: formatNumber(locale, MIN_CONSENSUS_SAMPLE),
            link: (
              <Link href={`/${locale}/match/${match.id}#community`} className={LINK}>
                <Translated locale={locale} message="story.predictions.communitySee" />
              </Link>
            ),
          }}
        />
      </div>
    </>
  );
}

function Side({ team }: { team: StoryMatch['home'] }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <EntityImage media={team.crest} kind="crest" name={team.name} size={22} />
      <bdi className="[overflow-wrap:anywhere]">{team.name}</bdi>
    </span>
  );
}

function Name({ locale, message: key }: { locale: Locale; message: MessageKey }) {
  return (
    <b className="font-bold text-fg">
      <Translated locale={locale} message={key} />
    </b>
  );
}

function ProductLine({
  testId,
  state,
  message: sentence,
  params,
}: {
  testId: string;
  state: string;
  message: Parameters<typeof FilledMessage>[0]['message'];
  params: Record<string, ReactNode>;
}) {
  return (
    <p data-testid={testId} data-state={state}>
      <FilledMessage message={sentence} params={params} />
    </p>
  );
}
