import type { ActivityReport, ActivitySeries } from '@fmip/contracts';
import { Notice } from '@/components/ui';
import {
  GROUP_WORDS,
  METRIC_WORDS,
  bySection,
  dayLabel,
  lastDays,
  nothingRecorded,
} from '@/lib/activity';
import { sparkBars } from '@/lib/system';

/**
 * The Activity page's body (T-807): per section, one row per count with a
 * bar per UTC day (inline SVG, no chart library) and the figures for today,
 * yesterday, seven days and the whole window; under each section the same
 * counts day by day. Aggregates only, and the page says so.
 */

const cell = 'py-1 pe-3 align-top tabular-nums';
const head = 'py-1 pe-3 text-start font-medium';
const BARS = { width: 150, height: 24 };

function Bars({
  series,
  direction,
  days,
}: {
  series: ActivitySeries;
  direction: 'ltr' | 'rtl';
  days: number;
}) {
  const bars = sparkBars(series.counts, BARS.width, BARS.height, direction);
  const label = `${METRIC_WORDS[series.metric].label} per day over ${String(days)} days, peak ${String(
    Math.max(0, ...series.counts),
  )}`;
  return (
    <svg
      viewBox={`0 0 ${String(BARS.width)} ${String(BARS.height)}`}
      className="h-6 w-36 text-accent"
      role="img"
      aria-label={label}
      data-testid="activity-bars"
    >
      <line
        x1={0}
        x2={BARS.width}
        y1={BARS.height - 0.5}
        y2={BARS.height - 0.5}
        stroke="currentColor"
        strokeOpacity={0.2}
      />
      {bars.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          fill="currentColor"
        >
          <title>{String(bar.count)}</title>
        </rect>
      ))}
    </svg>
  );
}

export function ActivitySections({
  report,
  direction,
}: {
  report: ActivityReport | null;
  direction: 'ltr' | 'rtl';
}) {
  if (report === null) {
    return (
      <Notice tone="danger" data-testid="activity-unavailable">
        The activity counts cannot be shown: the API did not answer. This is not the same as nothing
        having happened.
      </Notice>
    );
  }
  const days = report.days.length;
  const first = report.days[0];
  const last = report.days.at(-1);
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted" data-testid="activity-window">
        {first !== undefined && last !== undefined
          ? `${dayLabel(first)} to ${dayLabel(last)} (UTC days; today is still running).`
          : null}
      </p>
      {nothingRecorded(report) ? (
        <p className="text-sm" data-testid="activity-none">
          Nothing was recorded in these {days} days: no registrations, predictions, messages or
          notifications at all.
        </p>
      ) : null}
      {bySection(report).map(({ group, series }) => (
        <section key={group} className="flex flex-col gap-2" data-testid={`activity-${group}`}>
          <h2 className="text-lg font-semibold">{GROUP_WORDS[group]}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default">
                  <th scope="col" className={head}>
                    Count
                  </th>
                  <th scope="col" className={head}>
                    Per day
                  </th>
                  <th scope="col" className={head}>
                    Today
                  </th>
                  <th scope="col" className={head}>
                    Yesterday
                  </th>
                  <th scope="col" className={head}>
                    7 days
                  </th>
                  <th scope="col" className={head}>
                    {days} days
                  </th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => (
                  <tr
                    key={s.metric}
                    className="border-b border-default"
                    data-testid={`activity-row-${s.metric}`}
                  >
                    <th scope="row" className={`${head} font-normal`}>
                      {METRIC_WORDS[s.metric].label}
                      <span className="block text-xs text-muted">
                        {METRIC_WORDS[s.metric].counts}
                      </span>
                    </th>
                    <td className={cell}>
                      <Bars series={s} direction={direction} days={days} />
                    </td>
                    <td className={cell}>{s.counts.at(-1) ?? 0}</td>
                    <td className={cell}>{s.counts.at(-2) ?? 0}</td>
                    <td className={cell}>{lastDays(s.counts, 7)}</td>
                    <td className={`${cell} font-semibold`}>{s.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer">Day by day</summary>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-sm" data-testid={`activity-days-${group}`}>
                <thead>
                  <tr className="border-b border-default">
                    <th scope="col" className={head}>
                      Day (UTC)
                    </th>
                    {series.map((s) => (
                      <th key={s.metric} scope="col" className={head}>
                        {METRIC_WORDS[s.metric].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.days
                    .map((day, index) => ({ day, index }))
                    .reverse()
                    .map(({ day, index }) => (
                      <tr key={day} className="border-b border-default">
                        <th scope="row" className={`${head} font-normal`}>
                          <time dateTime={day}>{dayLabel(day)}</time>
                        </th>
                        {series.map((s) => (
                          <td key={s.metric} className={cell}>
                            {s.counts[index] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      ))}
    </div>
  );
}
