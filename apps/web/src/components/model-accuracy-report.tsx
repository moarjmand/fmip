import Link from 'next/link';
import type {
  AccuracyMetrics,
  AccuracyPeriod,
  AccuracyPoint,
  AdminAccuracySeries,
  AdminModelAccuracyResponse,
} from '@fmip/contracts';
import { Card } from '@/components/ui';

/**
 * Accuracy over time, for the console (T-1369, D-187): every model version in
 * each role it was stored under (published and shadow), overall and per
 * competition, by ISO week or month of kick-off (UTC), from the pre-kick-off
 * evaluations only (D-031). Each row beside what a forecast that knows
 * nothing scores. Read-only, and it names no winner: comparing a candidate
 * with the published version is the candidates page's, and promotion is a
 * decision entry (D-082). English only, like the rest of the console (D-175).
 */

const figure = (value: number | null, digits = 4): string =>
  value === null ? '—' : value.toFixed(digits);
const percent = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(1)}%`;

const SPARK = { width: 240, height: 48, pad: 4 } as const;

/**
 * The RPS line and the uniform forecast's RPS line on one scale, oldest
 * first; null with fewer than two periods, where a line would say nothing.
 */
export function sparkline(
  points: readonly AccuracyPoint[],
): { rps: string; uniform: string; max: number } | null {
  const usable = points.filter((p) => p.rps !== null && p.uniform_rps !== null);
  if (usable.length < 2) return null;
  const max = Math.max(...usable.flatMap((p) => [p.rps ?? 0, p.uniform_rps ?? 0]), 0.001);
  const step = (SPARK.width - SPARK.pad * 2) / (usable.length - 1);
  const y = (v: number) =>
    (SPARK.height - SPARK.pad - (v / max) * (SPARK.height - SPARK.pad * 2)).toFixed(1);
  const line = (pick: (p: AccuracyPoint) => number) =>
    usable
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${(SPARK.pad + i * step).toFixed(1)} ${y(pick(p))}`)
      .join(' ');
  return { rps: line((p) => p.rps ?? 0), uniform: line((p) => p.uniform_rps ?? 0), max };
}

function Sparkline({ points, label }: { points: readonly AccuracyPoint[]; label: string }) {
  const lines = sparkline(points);
  if (lines === null) return null;
  return (
    <figure className="flex flex-col gap-1" data-testid="accuracy-sparkline">
      <svg
        viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}
        className="h-12 w-60"
        role="img"
        aria-label={label}
      >
        <path
          d={lines.uniform}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeDasharray="4 4"
        />
        <path d={lines.rps} fill="none" stroke="currentColor" strokeWidth={2} />
      </svg>
      <figcaption className="text-xs text-muted">
        RPS per period (solid) and the uniform forecast&apos;s on the same matches (dashed); lower
        is better.
      </figcaption>
    </figure>
  );
}

function coverageNote(metrics: AccuracyMetrics, minimum: number): string {
  if (metrics.coverage === 'not_supplied') return 'not supplied';
  return metrics.coverage === 'limited' ? `limited (under ${minimum})` : 'available';
}

function Row({
  label,
  metrics,
  minimum,
  total = false,
}: {
  label: string;
  metrics: AccuracyMetrics;
  minimum: number;
  total?: boolean;
}) {
  const cell = 'py-1 pe-3 text-end tabular-nums';
  return (
    <tr
      className={`border-b border-default ${total ? 'font-semibold' : ''}`}
      data-testid={total ? 'accuracy-total' : 'accuracy-point'}
      data-coverage={metrics.coverage}
    >
      <th scope="row" className="py-1 pe-3 text-start font-normal">
        {label}
      </th>
      <td className={cell}>{metrics.matches}</td>
      <td className={cell}>{metrics.forecasts}</td>
      <td className={cell}>{figure(metrics.log_loss)}</td>
      <td className={cell}>{figure(metrics.brier)}</td>
      <td className={cell}>{figure(metrics.rps)}</td>
      <td className={cell}>{figure(metrics.uniform_rps)}</td>
      <td className={cell}>{percent(metrics.accuracy)}</td>
      <td className="py-1 text-start text-muted">{coverageNote(metrics, minimum)}</td>
    </tr>
  );
}

function SeriesTable({
  series,
  minimum,
  period,
}: {
  series: AdminAccuracySeries;
  minimum: number;
  period: AccuracyPeriod;
}) {
  const head = 'py-1 pe-3 text-end font-semibold';
  return (
    <div className="flex flex-col gap-2">
      <Sparkline
        points={series.points}
        label={`RPS by ${period} for ${series.model_version}, against the uniform forecast`}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm" data-testid="accuracy-table">
          <thead>
            <tr className="border-b border-default">
              <th scope="col" className="py-1 pe-3 text-start font-semibold">
                {period === 'week' ? 'ISO week' : 'Month'}
              </th>
              <th scope="col" className={head}>
                Matches
              </th>
              <th scope="col" className={head}>
                Forecasts
              </th>
              <th scope="col" className={head}>
                Log loss
              </th>
              <th scope="col" className={head}>
                Brier
              </th>
              <th scope="col" className={head}>
                RPS
              </th>
              <th scope="col" className={head}>
                RPS, uniform
              </th>
              <th scope="col" className={head}>
                Correct
              </th>
              <th scope="col" className="py-1 text-start font-semibold">
                Coverage
              </th>
            </tr>
          </thead>
          <tbody>
            {series.points.map((point) => (
              <Row key={point.period} label={point.period} metrics={point} minimum={minimum} />
            ))}
            <Row label="All" metrics={series.total} minimum={minimum} total />
          </tbody>
        </table>
      </div>
    </div>
  );
}

const roleLabel = (role: AdminAccuracySeries['role']): string =>
  role === 'published' ? 'published' : 'shadow (shown to no member)';

export function ModelAccuracyReport({
  locale,
  report,
}: {
  locale: string;
  report: AdminModelAccuracyResponse;
}) {
  const { reference, minimum_matches: minimum, period } = report;
  // One card per model version and role: its overall series, then each competition folded.
  const groups: AdminAccuracySeries[][] = [];
  for (const series of report.series) {
    const last = groups.at(-1);
    if (series.competition === null || last === undefined) groups.push([series]);
    else last.push(series);
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Pre-kick-off forecasts only (D-031), by the {period === 'week' ? 'ISO week' : 'month'} of
        kick-off in UTC. For log loss, Brier and RPS lower is better; a forecast of one third each
        scores {reference.uniform_log_loss.toFixed(4)}, {reference.uniform_brier.toFixed(4)} and the
        &ldquo;RPS, uniform&rdquo; column, and gets {percent(reference.uniform_accuracy)} right.
        Below {minimum} matches a row is limited: a record, not a verdict.
      </p>
      <nav className="flex gap-4 text-sm" aria-label="Period">
        {(['week', 'month'] as const).map((p) =>
          p === period ? (
            <span key={p} className="font-semibold" aria-current="page">
              By {p}
            </span>
          ) : (
            <Link
              key={p}
              href={`/${locale}/admin/model-accuracy?period=${p}`}
              className="underline"
            >
              By {p}
            </Link>
          ),
        )}
      </nav>
      {groups.length === 0 ? (
        <p className="text-sm text-muted" data-testid="accuracy-none">
          No pre-kick-off forecast has been evaluated yet: there is no accuracy to show.
        </p>
      ) : (
        groups.map(([overall, ...competitions]) =>
          overall === undefined ? null : (
            <Card
              key={`${overall.role}-${overall.model_version}`}
              heading={`${overall.model_version}, ${roleLabel(overall.role)}`}
              headingLevel={2}
              data-testid="accuracy-series"
              data-role={overall.role}
              data-model-version={overall.model_version}
            >
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">All competitions</h3>
                <SeriesTable series={overall} minimum={minimum} period={period} />
                {competitions.map((series) => (
                  <details key={series.competition?.id} data-testid="accuracy-competition">
                    <summary className="cursor-pointer text-sm">
                      {series.competition?.name} ({series.total.matches} matches)
                    </summary>
                    <div className="pt-2">
                      <SeriesTable series={series} minimum={minimum} period={period} />
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          ),
        )
      )}
    </div>
  );
}
