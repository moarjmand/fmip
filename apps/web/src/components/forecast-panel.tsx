import type { FixtureEvaluationsResponse, ForecastVersionsResponse } from '@fmip/contracts';
import {
  FACTOR_LABEL,
  KIND_LABEL,
  UNAVAILABLE_LABEL,
  describeChange,
  framing,
  percentages,
  versionChanges,
} from '@/lib/forecast';
import { COVERAGE_LABEL } from '@/lib/match';
import { formatKickoff } from '@/lib/scores';

/**
 * The model forecast on the match centre (T-065, blueprint 6.1–6.4): the
 * latest version's probabilities, expected goals and most likely scorelines,
 * its leading factors, data completeness and computation time; what changed
 * between versions; and, after the match, how the forecast did. It explains
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
}: {
  forecasts: ForecastVersionsResponse | null;
  evaluations: FixtureEvaluationsResponse | null;
  home: string;
  away: string;
  timeZone: string;
}) {
  const stamp = (iso: string): string => `${iso.slice(0, 10)} ${formatKickoff(iso, timeZone)}`;

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
            {versionChanges(forecasts.versions).map((change) => (
              <li key={change.version.id} className="flex flex-wrap gap-x-2">
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
              </li>
            ))}
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

      <dl className="flex flex-wrap gap-x-4 text-xs opacity-80">
        {version.expected_goals !== null && (
          <div>
            Expected goals {version.expected_goals.home.toFixed(2)} –{' '}
            {version.expected_goals.away.toFixed(2)}
          </div>
        )}
        {version.most_likely_scorelines !== null && version.most_likely_scorelines.length > 0 && (
          <div>
            Most likely scorelines:{' '}
            {version.most_likely_scorelines
              .slice(0, 3)
              .map((s) => `${s.home}–${s.away} (${(s.probability * 100).toFixed(1)}%)`)
              .join(', ')}
          </div>
        )}
      </dl>

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
        Result {last.actual.home}–{last.actual.away}: {outcome}. Version {last.version_number} (
        {KIND_LABEL[last.kind]}) gave that outcome {(last.p_outcome * 100).toFixed(1)}%
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
