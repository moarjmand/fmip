import type {
  FixtureEvaluationsResponse,
  ForecastEvaluation,
  ForecastSummary,
  ForecastVersion,
  ForecastVersionsResponse,
} from '@fmip/contracts';
import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { formatVersionStamp } from '@/i18n/format';
import { interpolate, message, t } from '@/i18n/messages';
import {
  describeChange,
  factorLabel,
  factorNote,
  framing,
  kindLabel,
  priorNote,
  unavailableLabel,
  versionChanges,
} from '@/lib/forecast';
import { attribute } from '@/lib/forecast-diff';
import { type CardForecast, cardForecast } from '@/lib/score-card-products';
import { formatFixed, formatPercent } from '@/lib/words';
import { forecastBarWords } from '@/lib/words-server';
import { zoneWords } from '@/lib/reader-time-zone';
import { FilledMessage } from '@/components/filled-message';
import { ForecastBar } from '@/components/forecast-bar';
import { ModelVoice } from '@/components/voices';
import { COVERAGE_KEY } from '@/components/score-card';
import { Score } from '@/components/score';
import { Translated } from '@/components/translated';
import { CoverageBadge } from '@/components/ui';

/**
 * "How the forecast was reached" on the match centre (T-065, blueprint
 * 6.1-6.4; T-1744, D-365). The forecast itself -- the bar, the percentages,
 * expected goals, likeliest scores and every version -- is the Summary's
 * opening card (`forecast-reality.tsx`) and is on the page once. This section
 * says only why: the framing sentence, the leading factors with who they
 * favour and why, what moved between versions and what may be blamed for it
 * (T-121, T-122), and after the match how the forecast scored, in plain
 * words; one line points back to the summary. It explains and never asserts
 * certainty. Presentation only: every version stays stored as it was computed
 * (rule 5), and nothing here re-draws one.
 *
 * `about` is the version the summary's card is about (the page's
 * `cardVersion`); without it, the latest. With no version that gave
 * probabilities there is nothing to explain, and the summary's card has
 * already said so once: the section is not rendered (rule 3: no empty panel).
 * Every word is the reader's (T-1303), every figure in their digits.
 */
export function ForecastPanel({
  forecasts,
  evaluations,
  about,
  home,
  away,
  timeZone,
  locale,
}: {
  forecasts: ForecastVersionsResponse | null;
  evaluations: FixtureEvaluationsResponse | null;
  /** The version the summary's card is about; the latest when left out. */
  about?: ForecastVersion | null;
  home: string;
  away: string;
  timeZone: string;
  locale: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const stamp = (iso: string) => computedStamp(locale, iso, timeZone);
  const version = about === undefined ? (forecasts?.latest ?? null) : about;
  if (forecasts === null || version === null || version.probabilities === null) return null;
  const prior = priorNote(version, l);
  const factors = version.leading_factors ?? [];

  return (
    // Its own lane, colour and name (T-1388, rule 6): the model's, and only the model's.
    <ModelVoice locale={locale}>
      <section
        className="flex flex-col gap-3"
        data-testid="forecast"
        data-coverage={forecasts.coverage}
      >
        <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold">
          <Translated locale={locale} message="forecast.how.title" />
          <CoverageBadge
            state={forecasts.coverage}
            label={<Translated locale={locale} message={COVERAGE_KEY[forecasts.coverage]} />}
          />
        </h2>
        {/* The one line that points to where the forecast is (T-1744). */}
        <p className="text-sm text-muted" data-testid="forecast-pointer">
          <FilledMessage
            message={message(l, 'forecast.how.pointer')}
            params={{
              summary: (
                <a href="#summary" className="font-bold text-fg underline">
                  <Translated locale={locale} message="forecast.how.summary" />
                </a>
              ),
            }}
          />
        </p>
        <p className="text-xs text-muted" data-testid="model-origin">
          <Translated locale={locale} message="lanes.model.origin" />
        </p>

        <p className="text-sm" data-testid="forecast-framing">
          {framing(version.probabilities, home, away, locale)}
        </p>

        {factors.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="leading-factors">
            <h3 className="text-sm font-medium">
              <Translated locale={locale} message="forecast.leadingFactors" />
            </h3>
            <ul className="flex flex-col gap-1 text-xs">
              {factors.map((factor, index) => (
                <li key={index}>
                  <span className="font-medium">{factorLabel(factor.factor, locale)}</span>
                  {' · '}
                  {interpolate(t(l, 'forecast.favours'), {
                    side:
                      factor.favours === 'home'
                        ? home
                        : factor.favours === 'away'
                          ? away
                          : t(l, 'forecast.neitherSide'),
                  })}
                  {' · '}
                  {factorNote(factor.factor, version, locale)}
                </li>
              ))}
              {prior !== null && (
                <li className="text-muted" data-testid="no-elo-prior">
                  {prior}
                </li>
              )}
            </ul>
          </div>
        )}

        {forecasts.versions.length > 1 && (
          <div className="flex flex-col gap-1" data-testid="forecast-versions">
            <h3 className="text-sm font-medium">
              <Translated locale={locale} message="forecast.versions" />
            </h3>
            <ol className="flex flex-col gap-1 text-xs">
              {versionChanges(forecasts.versions).map((change, index) => {
                // The version before this one, for the attribution (T-121). The
                // probabilities say *what* moved; only the inputs say why, and
                // only as far as they honestly can.
                const previous = index === 0 ? null : (forecasts.versions[index - 1] ?? null);
                const kind = kindLabel(change.version.kind, locale);
                return (
                  <li key={change.version.id} className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap gap-x-2">
                      <span className="text-muted">
                        <FilledMessage
                          message={message(l, 'forecast.versionShort')}
                          params={{
                            version: formatFixed(locale, change.version.version_number, 0),
                            time: stamp(change.version.computed_at),
                          }}
                        />
                      </span>
                      <span>
                        {change.version.probabilities === null
                          ? interpolate(t(l, 'forecast.kindReason'), {
                              kind,
                              reason:
                                change.version.unavailable_reason !== null
                                  ? unavailableLabel(change.version.unavailable_reason, locale)
                                  : t(l, 'forecast.unavailable'),
                            })
                          : (describeChange(change, home, away, locale) ??
                            interpolate(t(l, 'forecast.firstAvailable'), { kind }))}
                      </span>
                    </div>
                    {previous !== null && (
                      <span className="text-muted" data-testid="forecast-attribution">
                        {attribute(previous, change.version, locale)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <Evaluation evaluations={evaluations} home={home} away={away} stamp={stamp} locale={l} />
        <p className="text-sm">
          {/* The model's record over every match it forecast (T-1369). */}
          <Link
            href={`/${locale}/model-accuracy`}
            className="underline"
            data-testid="forecast-accuracy-link"
          >
            <Translated locale={locale} message="forecast.accuracyLink" />
          </Link>
        </p>
      </section>
    </ModelVoice>
  );
}

/** What knowing nothing scores on three outcomes: log loss ln 3, Brier 2/3. */
const UNIFORM = { logLoss: Math.log(3), brier: 2 / 3 } as const;

/**
 * The post-match evaluation, from the stored evaluation alone: the result,
 * what the scored version gave it, its two scores, and in plain words what
 * they measure and -- only where both agree -- whether this forecast did
 * better or worse than knowing nothing. Where the two scores disagree about
 * that, no verdict is written (rule 3).
 */
function Evaluation({
  evaluations,
  home,
  away,
  stamp,
  locale,
}: {
  evaluations: FixtureEvaluationsResponse | null;
  home: string;
  away: string;
  stamp: (iso: string) => React.ReactNode;
  locale: Locale;
}) {
  if (evaluations === null || evaluations.evaluations.length === 0) return null;
  const last = evaluations.evaluations.at(-1);
  if (last === undefined) return null;
  const outcome =
    last.outcome === 'home' ? home : last.outcome === 'away' ? away : t(locale, 'forecast.aDraw');
  const worse = last.log_loss > UNIFORM.logLoss && last.brier > UNIFORM.brier;
  const better = last.log_loss < UNIFORM.logLoss && last.brier < UNIFORM.brier;
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="forecast-evaluation">
      <h3 className="text-sm font-medium">
        <Translated locale={locale} message="forecast.evaluation.title" />
      </h3>
      <p>
        <FilledMessage
          message={message(locale, 'forecast.evaluation.result')}
          params={{
            score: <Score home={last.actual.home} away={last.actual.away} locale={locale} />,
            outcome,
          }}
        />{' '}
        {interpolate(
          t(locale, last.correct ? 'forecast.evaluation.correct' : 'forecast.evaluation.incorrect'),
          {
            version: formatFixed(locale, last.version_number, 0),
            kind: kindLabel(last.kind, locale),
            probability: formatPercent(locale, last.p_outcome * 100),
          },
        )}{' '}
        {interpolate(t(locale, 'forecast.evaluation.scores'), {
          logLoss: formatFixed(locale, last.log_loss, 3),
          brier: formatFixed(locale, last.brier, 3),
        })}
        {last.pre_kickoff ? '' : ` ${t(locale, 'forecast.evaluation.afterKickoff')}`}
      </p>
      <p
        data-testid="forecast-evaluation-plain"
        data-against-uniform={worse ? 'worse' : better ? 'better' : 'mixed'}
      >
        <Translated locale={locale} message="forecast.evaluation.plain" />
        {(worse || better) && (
          <>
            {' '}
            <Translated
              locale={locale}
              message={worse ? 'forecast.evaluation.worse' : 'forecast.evaluation.better'}
            />
          </>
        )}
      </p>
      <p className="text-muted">
        <FilledMessage
          message={message(locale, 'forecast.evaluation.evaluated')}
          params={{ time: stamp(last.evaluated_at) }}
        />
      </p>
    </div>
  );
}

/**
 * A stored moment as the bar writes it (T-1395): "11 Oct, 09:30 UK time", in
 * the page's zone and named, the one format for every forecast and version
 * stamp on the page.
 */
function computedStamp(locale: string, iso: string, timeZone: string): ReactNode {
  return (
    <time dateTime={iso}>
      {formatVersionStamp(locale, iso, timeZone)} {zoneWords(locale, timeZone)}
    </time>
  );
}

/**
 * "What the model expected" in a match report (T-1383, D-201): the model's
 * forecast as it stood before kick-off -- its version and computation time
 * always on screen -- beside the result and how that forecast scored. The
 * model only, in its own lane (rule 6); a story about the match never gets a
 * forecast written into its words. Every gap is a sentence (rule 3): no
 * forecast before kick-off, the service not answering, no result yet, a
 * result not yet scored. Its heading is in the interface face (T-1621,
 * D-291): beside a story's serif words, the serif is the founder's (D-263).
 */
export function ModelExpected({
  summary,
  evaluation,
  result,
  home,
  away,
  timeZone,
  locale,
}: {
  /** The latest version computed before kick-off; `null` none; `'unreachable'` no answer. */
  summary: ForecastSummary | null | 'unreachable';
  /** That version scored against the result, when it has been. */
  evaluation: ForecastEvaluation | null;
  /** The full-time score, when there is one. */
  result: { home: number; away: number } | null;
  home: string;
  away: string;
  timeZone: string;
  locale: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const forecast: CardForecast =
    summary === 'unreachable' ? { state: 'unreachable' } : cardForecast(summary);
  const score = result ?? evaluation?.actual ?? null;
  return (
    <ModelVoice locale={l}>
      <section className="flex flex-col gap-3" data-testid="story-model-expected">
        <h2 className="text-xl font-extrabold font-stretch-semi-expanded">
          <Translated locale={l} message="story.expected.title" />
        </h2>
        <p className="text-sm text-muted">
          <Translated locale={l} message="story.expected.intro" />
        </p>
        <ForecastBar
          forecast={forecast}
          home={home}
          away={away}
          started
          outcome={
            score === null
              ? null
              : score.home > score.away
                ? 'home'
                : score.home < score.away
                  ? 'away'
                  : 'draw'
          }
          locale={l}
          timeZone={timeZone}
          zone={zoneWords(l, timeZone)}
          words={forecastBarWords(l)}
        />
        <p className="text-sm" data-testid="story-model-result">
          {score === null ? (
            <Translated locale={l} message="story.expected.noResult" />
          ) : (
            <FilledMessage
              message={message(l, 'story.expected.result')}
              params={{
                home: <bdi>{home}</bdi>,
                score: (
                  <Score home={score.home} away={score.away} locale={l} className="font-bold" />
                ),
                away: <bdi>{away}</bdi>,
              }}
            />
          )}{' '}
          {evaluation !== null ? (
            <span data-testid="story-model-rps">
              {interpolate(t(l, 'story.expected.rps'), { rps: formatFixed(l, evaluation.rps, 3) })}
            </span>
          ) : score !== null && forecast.state === 'available' ? (
            <Translated locale={l} message="story.expected.notScored" />
          ) : null}
        </p>
        <p className="text-sm">
          <Link href={`/${l}/model-accuracy`} className="underline">
            <Translated locale={l} message="forecast.accuracyLink" />
          </Link>
        </p>
      </section>
    </ModelVoice>
  );
}
