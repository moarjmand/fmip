import type {
  FixtureEvaluationsResponse,
  ForecastEvaluation,
  ForecastSummary,
  ForecastVersionsResponse,
  MatchOutcome,
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
  percentages,
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
import { Score, nameIsolate, pairIsolate } from '@/components/score';
import { Translated } from '@/components/translated';
import { CoverageBadge, Notice } from '@/components/ui';
import { ModelVersion } from '@/components/model-version';

/**
 * The model forecast on the match centre (T-065, blueprint 6.1–6.4): the
 * latest version's probabilities, expected goals and most likely scorelines,
 * its leading factors, data completeness and computation time; what changed
 * between versions and what may be blamed for it (T-121, T-122); and, after the
 * match, how the forecast did. It explains
 * and never asserts certainty: the wording is probabilities, and the version
 * and time are always on screen. An `unavailable` version is shown with its
 * reason, never as an empty panel (rule 3). Every word is the reader's
 * (T-1303), every figure in their digits.
 */
export function ForecastPanel({
  forecasts,
  evaluations,
  home,
  away,
  timeZone,
  locale,
}: {
  forecasts: ForecastVersionsResponse | null;
  evaluations: FixtureEvaluationsResponse | null;
  home: string;
  away: string;
  timeZone: string;
  locale: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const stamp = (iso: string) => computedStamp(locale, iso, timeZone);

  if (forecasts === null) {
    return (
      <ModelVoice locale={locale}>
        <section className="flex flex-col gap-2" data-testid="forecast" data-coverage="unreachable">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="forecast.title" />
          </h2>
          <Notice tone="danger">
            <Translated locale={locale} message="forecast.unreachable" />
          </Notice>
        </section>
      </ModelVoice>
    );
  }

  const latest = forecasts.latest;
  return (
    // Its own lane, colour and name (T-1388, rule 6): the model's, and only the model's.
    <ModelVoice locale={locale}>
      <ForecastSection
        forecasts={forecasts}
        evaluations={evaluations}
        latest={latest}
        home={home}
        away={away}
        timeZone={timeZone}
        stamp={stamp}
        locale={l}
      />
    </ModelVoice>
  );
}

function ForecastSection({
  forecasts,
  evaluations,
  latest,
  home,
  away,
  timeZone,
  stamp,
  locale: l,
}: {
  forecasts: ForecastVersionsResponse;
  evaluations: FixtureEvaluationsResponse | null;
  latest: ForecastVersionsResponse['latest'];
  home: string;
  away: string;
  timeZone: string;
  stamp: (iso: string) => React.ReactNode;
  locale: Locale;
}) {
  const locale: string = l;
  return (
    <section
      className="flex flex-col gap-3"
      data-testid="forecast"
      data-coverage={forecasts.coverage}
    >
      <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold">
        <Translated locale={locale} message="forecast.title" />
        <CoverageBadge
          state={forecasts.coverage}
          label={<Translated locale={locale} message={COVERAGE_KEY[forecasts.coverage]} />}
        />
      </h2>
      <p className="text-xs text-muted" data-testid="model-origin">
        <Translated locale={locale} message="lanes.model.origin" />
      </p>

      {latest === null ? (
        <p className="text-sm text-muted" data-testid="forecast-none">
          <Translated locale={locale} message="forecast.none" />
        </p>
      ) : latest.probabilities === null ? (
        <div className="flex flex-col gap-1 text-sm" data-testid="forecast-unavailable">
          <p>
            {latest.unavailable_reason !== null ? (
              unavailableLabel(latest.unavailable_reason, locale)
            ) : (
              <Translated locale={locale} message="forecast.couldNotProduce" />
            )}
          </p>
          <p className="text-xs text-muted">
            <FilledMessage
              message={message(l, 'forecast.versionLine')}
              params={{
                version: formatFixed(locale, latest.version_number, 0),
                kind: kindLabel(latest.kind, locale),
                time: stamp(latest.computed_at),
              }}
            />
          </p>
        </div>
      ) : (
        <Latest
          version={latest}
          home={home}
          away={away}
          stamp={stamp}
          timeZone={timeZone}
          locale={l}
        />
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
  );
}

function Latest({
  version,
  home,
  away,
  stamp,
  timeZone,
  locale,
}: {
  version: NonNullable<ForecastVersionsResponse['latest']>;
  home: string;
  away: string;
  stamp: (iso: string) => React.ReactNode;
  timeZone: string;
  locale: Locale;
}) {
  const p = version.probabilities;
  if (p === null) return null;
  const prior = priorNote(version, locale);
  return (
    <div className="flex flex-col gap-2" data-testid="forecast-latest">
      {/* The bar (T-1388): one hue, three steps, the model id and time under it. */}
      <div data-testid="probabilities">
        <ForecastBar
          forecast={cardForecast(version)}
          home={home}
          away={away}
          locale={locale}
          timeZone={timeZone}
          zone={zoneWords(locale, timeZone)}
          words={forecastBarWords(locale)}
        />
      </div>
      <p className="text-sm" data-testid="forecast-framing">
        {framing(p, home, away, locale)}
      </p>

      <ul className="flex flex-wrap gap-x-4 text-xs text-muted">
        {version.expected_goals !== null && (
          <li>
            <FilledMessage
              message={message(locale, 'forecast.expectedGoals')}
              params={{
                home: <span dir="ltr">{formatFixed(locale, version.expected_goals.home, 2)}</span>,
                away: <span dir="ltr">{formatFixed(locale, version.expected_goals.away, 2)}</span>,
              }}
            />
          </li>
        )}
        {version.most_likely_scorelines !== null && version.most_likely_scorelines.length > 0 && (
          <li>
            {interpolate(t(locale, 'forecast.scorelines'), {
              list: version.most_likely_scorelines
                .slice(0, 3)
                .map((s) =>
                  interpolate(t(locale, 'forecast.scoreline'), {
                    score: pairIsolate(
                      locale,
                      `${formatFixed(locale, s.home, 0)}–${formatFixed(locale, s.away, 0)}`,
                    ),
                    probability: formatPercent(locale, s.probability * 100),
                  }),
                )
                .join(t(locale, 'forecast.listSeparator')),
            })}
          </li>
        )}
      </ul>

      {version.leading_factors !== null && version.leading_factors.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="leading-factors">
          <h3 className="text-sm font-medium">
            <Translated locale={locale} message="forecast.leadingFactors" />
          </h3>
          <ul className="flex flex-col gap-1 text-xs">
            {version.leading_factors.map((factor, index) => (
              <li key={index}>
                <span className="font-medium">{factorLabel(factor.factor, locale)}</span>
                {' · '}
                {interpolate(t(locale, 'forecast.favours'), {
                  side:
                    factor.favours === 'home'
                      ? home
                      : factor.favours === 'away'
                        ? away
                        : t(locale, 'forecast.neitherSide'),
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

      <p className="text-xs text-muted" data-testid="forecast-meta">
        <FilledMessage
          message={message(locale, 'forecast.meta')}
          params={{
            version: formatFixed(locale, version.version_number, 0),
            kind: kindLabel(version.kind, locale),
            time: stamp(version.computed_at),
            model: <ModelVersion version={version.model_version} />,
            completeness:
              version.data_completeness === null
                ? t(locale, 'forecast.unknown')
                : t(locale, COVERAGE_KEY[version.data_completeness]),
          }}
        />
      </p>
    </div>
  );
}

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
 * The model's lane in "What was forecast, and what happened" (T-1384, D-202):
 * after full time, the version the model published before kick-off -- the
 * one its evaluation scored, else the last computed before kick-off --
 * against the result, and the ranked probability score of that one match
 * when the evaluation exists (T-1369's RPS, computed when read). The model
 * only: this takes the model's versions and evaluations and nothing else
 * (rule 6); the founder's and the community's lanes are their own files'.
 * No version before kick-off is a sentence, never an empty bar (rule 3).
 */
export function ModelVerdict({
  forecasts,
  evaluations,
  kickoffAt,
  result,
  home,
  away,
  timeZone,
  locale,
}: {
  forecasts: ForecastVersionsResponse | null;
  evaluations: FixtureEvaluationsResponse | null;
  kickoffAt: string;
  /** The full-time score. */
  result: { home: number; away: number };
  home: string;
  away: string;
  timeZone: string;
  locale: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const scored =
    evaluations?.evaluations.filter((evaluation) => evaluation.pre_kickoff).at(-1) ?? null;
  const kickoff = Date.parse(kickoffAt);
  const version =
    forecasts === null
      ? null
      : scored !== null
        ? (forecasts.versions.find((v) => v.version_number === scored.version_number) ?? null)
        : (forecasts.versions.filter((v) => Date.parse(v.computed_at) <= kickoff).at(-1) ?? null);
  const outcome: MatchOutcome =
    result.home > result.away ? 'home' : result.home < result.away ? 'away' : 'draw';
  const outcomeName =
    outcome === 'draw'
      ? t(l, 'forecast.aDraw')
      : interpolate(t(l, 'predictions.outcome.teamWin'), {
          team: nameIsolate(outcome === 'home' ? home : away),
        });
  const p = version?.probabilities ?? null;
  return (
    <ModelVoice locale={l}>
      <div className="flex flex-col gap-3" data-testid="model-verdict">
        <p className="text-sm text-muted">
          <Translated locale={l} message="forecast.verdict.frozen" />
        </p>
        <ForecastBar
          forecast={
            forecasts === null
              ? { state: 'unreachable' }
              : cardForecast(version === null ? null : version)
          }
          home={home}
          away={away}
          started
          outcome={outcome}
          locale={l}
          timeZone={timeZone}
          zone={zoneWords(l, timeZone)}
          words={forecastBarWords(l)}
          compact
        />
        {p !== null && (
          <p className="text-sm font-semibold" data-testid="model-verdict-result">
            {interpolate(t(l, 'forecast.verdict.result'), {
              outcome: outcomeName,
              probability: formatPercent(l, percentages(p)[outcome]),
            })}
          </p>
        )}
        {scored !== null ? (
          <p
            className="flex items-baseline gap-2.5 border-t border-default pt-3"
            data-testid="model-verdict-rps"
          >
            <b className="font-sans text-display-2 leading-none font-black font-stretch-condensed tabular-nums">
              <span dir="ltr">{formatFixed(l, scored.rps, 3)}</span>
            </b>
            <span className="text-sm text-muted">
              <Translated locale={l} message="forecast.verdict.rps" />
            </span>
          </p>
        ) : (
          version !== null && (
            <p className="text-sm text-muted" data-testid="model-verdict-unscored">
              <Translated locale={l} message="forecast.verdict.unscored" />
            </p>
          )
        )}
        <Link
          href={`/${l}/model-accuracy`}
          className="inline-flex min-h-touch items-center text-sm font-bold text-model underline"
        >
          <Translated locale={l} message="forecast.verdict.accuracy" />
        </Link>
      </div>
    </ModelVoice>
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
 * result not yet scored.
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
        <h2 className="font-serif text-2xl font-semibold">
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
