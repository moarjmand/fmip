import type {
  FixtureEvaluationsResponse,
  ForecastListEntry,
  ForecastVersionsResponse,
} from '@fmip/contracts';
import Link from 'next/link';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, message, plural, t } from '@/i18n/messages';
import {
  describeChange,
  factorLabel,
  framing,
  kindLabel,
  percentages,
  priorNote,
  unavailableLabel,
  versionChanges,
} from '@/lib/forecast';
import { attribute } from '@/lib/forecast-diff';
import { formatKickoff } from '@/lib/scores';
import { formatFixed, formatPercent } from '@/lib/words';
import { FilledMessage } from '@/components/filled-message';
import { COVERAGE_KEY } from '@/components/score-card';
import { Score, ltrIsolate } from '@/components/score';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';

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
  const stamp = (iso: string) => (
    <time dateTime={iso}>
      {iso.slice(0, 10)} {formatKickoff(locale, iso, timeZone)}
    </time>
  );

  if (forecasts === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="forecast" data-coverage="unreachable">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="forecast.title" />
        </h2>
        <Notice tone="danger">
          <Translated locale={locale} message="forecast.unreachable" />
        </Notice>
      </section>
    );
  }

  const latest = forecasts.latest;
  return (
    <section
      className="flex flex-col gap-3"
      data-testid="forecast"
      data-coverage={forecasts.coverage}
    >
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="forecast.title" />
        <span className="ms-2 text-xs font-normal uppercase text-muted">
          <Translated locale={locale} message={COVERAGE_KEY[forecasts.coverage]} />
        </span>
      </h2>

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
        <Latest version={latest} home={home} away={away} stamp={stamp} locale={l} />
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
    </section>
  );
}

function Latest({
  version,
  home,
  away,
  stamp,
  locale,
}: {
  version: NonNullable<ForecastVersionsResponse['latest']>;
  home: string;
  away: string;
  stamp: (iso: string) => React.ReactNode;
  locale: Locale;
}) {
  const p = version.probabilities;
  if (p === null) return null;
  const pct = percentages(p);
  const prior = priorNote(version, locale);
  return (
    <div className="flex flex-col gap-2" data-testid="forecast-latest">
      <div className="grid grid-cols-3 gap-2 text-center" data-testid="probabilities">
        <Outcome label={home} value={pct.home} locale={locale} />
        <Outcome label={t(locale, 'forecast.draw')} value={pct.draw} locale={locale} />
        <Outcome label={away} value={pct.away} locale={locale} />
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
                    score: ltrIsolate(
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
                {factor.note}
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
            model: version.model_version,
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

function Outcome({ label, value, locale }: { label: string; value: number; locale: Locale }) {
  return (
    <div className="flex flex-col rounded border border-default p-2">
      <span className="text-xl font-semibold tabular-nums" dir="ltr">
        {formatPercent(locale, value)}
      </span>
      <span className="truncate text-xs text-muted">{label}</span>
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
 * The model's forecasts across several matches, for the Predictions page
 * (T-137, blueprint 2.1).
 *
 * In this file rather than a shared list component, for the same reason the
 * community's list is in its own: one file per product means nothing in the
 * codebase renders "a prediction", and there is nowhere for a `source` prop to
 * appear (rule 6).
 *
 * A fixture the model has no answer for is left out of the list rather than
 * shown as a row of blanks — but the count of those is stated, because a
 * shorter list with no explanation is how missing coverage starts looking like
 * coverage that does not exist (rule 3).
 */
export function ForecastList({
  entries,
  fixtures,
  locale,
}: {
  entries: ForecastListEntry[];
  /** Names for the fixtures, by id, so a row can say who is playing. */
  fixtures: Map<string, { home: string; away: string }>;
  locale: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const withForecast = entries.filter(
    (entry) => entry.latest !== null && entry.latest.probabilities !== null,
  );
  const without = entries.length - withForecast.length;

  return (
    <section className="flex flex-col gap-2" data-testid="predictions-model">
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="forecast.list.title" />
      </h2>
      <p className="text-xs text-muted">
        <Translated locale={locale} message="forecast.list.intro" />
      </p>
      {withForecast.length === 0 ? (
        <p className="text-sm text-muted">
          <Translated locale={locale} message="forecast.list.none" />
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {withForecast.map((entry) => {
            const probabilities = entry.latest?.probabilities;
            if (probabilities === undefined || probabilities === null) return null;
            const teams = fixtures.get(entry.fixture_id);
            const pct = percentages(probabilities);
            return (
              <li key={entry.fixture_id} className="flex flex-col gap-1">
                <Link href={`/${locale}/match/${entry.fixture_id}`} className="text-sm underline">
                  {teams === undefined
                    ? t(l, 'matchCentre.title')
                    : interpolate(t(l, 'matchCentre.fixtureTitle'), teams)}
                </Link>
                <p className="text-sm">
                  {interpolate(t(l, 'forecast.list.line'), {
                    home: teams?.home ?? t(l, 'matchCentre.home'),
                    homePct: formatPercent(l, pct.home),
                    drawPct: formatPercent(l, pct.draw),
                    away: teams?.away ?? t(l, 'matchCentre.away'),
                    awayPct: formatPercent(l, pct.away),
                  })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {without > 0 && (
        <p className="text-xs text-muted" data-testid="model-missing">
          {
            plural(l, 'forecast.list.missing', without, {
              total: formatFixed(l, entries.length, 0),
            }).text
          }
        </p>
      )}
    </section>
  );
}
