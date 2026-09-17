import type {
  FixtureEvaluationsResponse,
  ForecastListEntry,
  ForecastVersionsResponse,
} from '@fmip/contracts';
import Link from 'next/link';
import {
  FACTOR_LABEL,
  KIND_LABEL,
  UNAVAILABLE_LABEL,
  describeChange,
  framing,
  percentages,
  versionChanges,
} from '@/lib/forecast';
import { attribute } from '@/lib/forecast-diff';
import { COVERAGE_LABEL } from '@/lib/match';
import { formatKickoff } from '@/lib/scores';
import { Score, ltrIsolate } from '@/components/score';

/**
 * The model forecast on the match centre (T-065, blueprint 6.1–6.4): the
 * latest version's probabilities, expected goals and most likely scorelines,
 * its leading factors, data completeness and computation time; what changed
 * between versions and what may be blamed for it (T-121, T-122); and, after the
 * match, how the forecast did. It explains
 * and never asserts certainty: the wording is probabilities, and the version
 * and time are always on screen. An `unavailable` version is shown with its
 * reason, never as an empty panel (rule 3).
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
  const stamp = (iso: string): string =>
    `${iso.slice(0, 10)} ${formatKickoff(locale, iso, timeZone)}`;

  if (forecasts === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="forecast" data-coverage="unreachable">
        <h2 className="text-lg font-semibold">Model forecast</h2>
        <p role="alert" className="text-sm">
          The forecast service could not be reached, so no forecast can be shown.
        </p>
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
        Model forecast
        <span className="ms-2 text-xs font-normal uppercase opacity-60">
          {COVERAGE_LABEL[forecasts.coverage]}
        </span>
      </h2>

      {latest === null ? (
        <p className="text-sm opacity-70" data-testid="forecast-none">
          No forecast has been computed for this match yet.
        </p>
      ) : latest.probabilities === null ? (
        <div className="flex flex-col gap-1 text-sm" data-testid="forecast-unavailable">
          <p>
            {latest.unavailable_reason !== null
              ? UNAVAILABLE_LABEL[latest.unavailable_reason]
              : 'The model could not produce a forecast.'}
          </p>
          <p className="text-xs opacity-70">
            Version {latest.version_number} · {KIND_LABEL[latest.kind]} · computed{' '}
            <time dateTime={latest.computed_at}>{stamp(latest.computed_at)}</time>
          </p>
        </div>
      ) : (
        <Latest version={latest} home={home} away={away} stamp={stamp} />
      )}

      {forecasts.versions.length > 1 && (
        <div className="flex flex-col gap-1" data-testid="forecast-versions">
          <h3 className="text-sm font-medium">What changed between versions</h3>
          <ol className="flex flex-col gap-1 text-xs">
            {versionChanges(forecasts.versions).map((change, index) => {
              // The version before this one, for the attribution (T-121). The
              // probabilities say *what* moved; only the inputs say why, and
              // only as far as they honestly can.
              const previous = index === 0 ? null : (forecasts.versions[index - 1] ?? null);
              return (
                <li key={change.version.id} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap gap-x-2">
                    <span className="opacity-70">
                      v{change.version.version_number} ·{' '}
                      <time dateTime={change.version.computed_at}>
                        {stamp(change.version.computed_at)}
                      </time>
                    </span>
                    <span>
                      {change.version.probabilities === null
                        ? `${KIND_LABEL[change.version.kind]}: ${
                            change.version.unavailable_reason !== null
                              ? UNAVAILABLE_LABEL[change.version.unavailable_reason]
                              : 'unavailable'
                          }`
                        : (describeChange(change, home, away) ??
                          `${KIND_LABEL[change.version.kind]}: first available version.`)}
                    </span>
                  </div>
                  {previous !== null && (
                    <span className="opacity-60" data-testid="forecast-attribution">
                      {attribute(previous, change.version)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <Evaluation evaluations={evaluations} home={home} away={away} stamp={stamp} />
    </section>
  );
}

function Latest({
  version,
  home,
  away,
  stamp,
}: {
  version: NonNullable<ForecastVersionsResponse['latest']>;
  home: string;
  away: string;
  stamp: (iso: string) => string;
}) {
  const p = version.probabilities;
  if (p === null) return null;
  const pct = percentages(p);
  return (
    <div className="flex flex-col gap-2" data-testid="forecast-latest">
      <div className="grid grid-cols-3 gap-2 text-center" data-testid="probabilities">
        <Outcome label={home} value={pct.home} />
        <Outcome label="Draw" value={pct.draw} />
        <Outcome label={away} value={pct.away} />
      </div>
      <p className="text-sm" data-testid="forecast-framing">
        {framing(p, home, away)}
      </p>

      <ul className="flex flex-wrap gap-x-4 text-xs opacity-80">
        {version.expected_goals !== null && (
          <li>
            Expected goals {version.expected_goals.home.toFixed(2)} –{' '}
            {version.expected_goals.away.toFixed(2)}
          </li>
        )}
        {version.most_likely_scorelines !== null && version.most_likely_scorelines.length > 0 && (
          <li>
            Most likely scorelines:{' '}
            {version.most_likely_scorelines
              .slice(0, 3)
              .map(
                (s) =>
                  `${ltrIsolate(`${s.home}–${s.away}`)} (${(s.probability * 100).toFixed(1)}%)`,
              )
              .join(', ')}
          </li>
        )}
      </ul>

      {version.leading_factors !== null && version.leading_factors.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="leading-factors">
          <h3 className="text-sm font-medium">Leading factors</h3>
          <ul className="flex flex-col gap-1 text-xs">
            {version.leading_factors.map((factor, index) => (
              <li key={index}>
                <span className="font-medium">{FACTOR_LABEL[factor.factor]}</span>
                {' · favours '}
                {factor.favours === 'home'
                  ? home
                  : factor.favours === 'away'
                    ? away
                    : 'neither side'}
                {' · '}
                {factor.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs opacity-70" data-testid="forecast-meta">
        Version {version.version_number} · {KIND_LABEL[version.kind]} · computed{' '}
        <time dateTime={version.computed_at}>{stamp(version.computed_at)}</time> · model{' '}
        {version.model_version} · data{' '}
        {version.data_completeness === null ? 'unknown' : version.data_completeness}
      </p>
    </div>
  );
}

function Outcome({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col rounded border border-current/20 p-2">
      <span className="text-xl font-semibold tabular-nums">{value.toFixed(1)}%</span>
      <span className="truncate text-xs opacity-70">{label}</span>
    </div>
  );
}

function Evaluation({
  evaluations,
  home,
  away,
  stamp,
}: {
  evaluations: FixtureEvaluationsResponse | null;
  home: string;
  away: string;
  stamp: (iso: string) => string;
}) {
  if (evaluations === null || evaluations.evaluations.length === 0) return null;
  const last = evaluations.evaluations.at(-1);
  if (last === undefined) return null;
  const outcome = last.outcome === 'home' ? home : last.outcome === 'away' ? away : 'a draw';
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="forecast-evaluation">
      <h3 className="text-sm font-medium">Post-match evaluation</h3>
      <p>
        Result <Score home={last.actual.home} away={last.actual.away} />: {outcome}. Version{' '}
        {last.version_number} ({KIND_LABEL[last.kind]}) gave that outcome{' '}
        {(last.p_outcome * 100).toFixed(1)}%
        {last.correct ? ', its most probable outcome' : ', not its most probable outcome'}. Log loss{' '}
        {last.log_loss.toFixed(3)}, Brier {last.brier.toFixed(3)} (lower is better; knowing nothing
        scores 1.099 and 0.667).
        {last.pre_kickoff ? '' : ' Computed after kick-off, so excluded from performance figures.'}
      </p>
      <p className="opacity-70">
        Evaluated <time dateTime={last.evaluated_at}>{stamp(last.evaluated_at)}</time>
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
  const withForecast = entries.filter(
    (entry) => entry.latest !== null && entry.latest.probabilities !== null,
  );
  const without = entries.length - withForecast.length;

  return (
    <section className="flex flex-col gap-2" data-testid="predictions-model">
      <h2 className="text-lg font-semibold">Model forecasts</h2>
      <p className="text-xs opacity-60">
        The statistical model. Not the founder&rsquo;s view, and not the community&rsquo;s.
      </p>
      {withForecast.length === 0 ? (
        <p className="text-sm opacity-70">The model has no forecast for these matches.</p>
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
                  {teams === undefined ? 'Match' : `${teams.home} v ${teams.away}`}
                </Link>
                <p className="text-sm">
                  {teams?.home ?? 'Home'} {pct.home.toFixed(1)}%, draw {pct.draw.toFixed(1)}%,{' '}
                  {teams?.away ?? 'Away'} {pct.away.toFixed(1)}%
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {without > 0 && (
        <p className="text-xs opacity-60" data-testid="model-missing">
          {without} of these {entries.length} matches {without === 1 ? 'has' : 'have'} no model
          forecast.
        </p>
      )}
    </section>
  );
}
