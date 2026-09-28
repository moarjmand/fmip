import type {
  AdminAlertsReport,
  FailureCountsReport,
  WatchdogCondition,
  WatchdogReport,
} from '@fmip/contracts';
import { Notice } from '@/components/ui';
import {
  EVENT_WORDS,
  LEVEL_TONE,
  LEVEL_WORDS,
  ago,
  channelLine,
  conditionName,
  formatMeasure,
  freshnessSentence,
  hourlySeries,
  sparkBars,
} from '@/lib/system';

/**
 * The sections of the System page (T-804). Each takes its report or `null`,
 * and `null` is "cannot be shown", said in a notice; an empty report is
 * "nothing recorded", said in a sentence. Never one for the other.
 */

const cell = 'py-1 pe-3 align-top';
const head = 'py-1 pe-3 text-start font-medium';

function Unavailable({ testId, what }: { testId: string; what: string }) {
  return (
    <Notice tone="danger" data-testid={testId}>
      {what} cannot be shown: the API did not answer. This is not the same as nothing being wrong.
    </Notice>
  );
}

function Level({ condition }: { condition: WatchdogCondition }) {
  return (
    <span className={`font-semibold ${LEVEL_TONE[condition.level]}`} data-level={condition.level}>
      {LEVEL_WORDS[condition.level]}
    </span>
  );
}

// --- the watchdog (T-801) ----------------------------------------------------

export function WatchdogSection({ report }: { report: WatchdogReport | null }) {
  if (report === null) {
    return (
      <section className="flex flex-col gap-3" data-testid="system-watchdog">
        <h2 className="text-lg font-semibold">Current conditions</h2>
        <Unavailable testId="system-watchdog-unavailable" what="The watchdog's conditions" />
      </section>
    );
  }
  const now = report.generated_at;
  const stale = freshnessSentence(report.freshness, report.checked_at, now);
  const open = report.conditions.filter((c) => c.incident !== null);
  return (
    <>
      <section className="flex flex-col gap-3" data-testid="system-watchdog">
        <h2 className="text-lg font-semibold">Current conditions</h2>
        {stale !== null && (
          <Notice
            tone={report.freshness === 'stale' ? 'danger' : 'warning'}
            data-testid={`system-watchdog-${report.freshness}`}
          >
            {stale}
          </Notice>
        )}
        {report.checked_at !== null && (
          <p className="text-sm text-muted">
            Checked {ago(report.checked_at, now)} ({report.checked_at}), every{' '}
            {String(report.interval_seconds)} s.
          </p>
        )}
        {report.conditions.length === 0 ? (
          <p className="text-sm text-muted" data-testid="system-conditions-none">
            No condition has been recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="system-conditions">
              <thead>
                <tr className="border-b border-default">
                  <th scope="col" className={head}>
                    Condition
                  </th>
                  <th scope="col" className={head}>
                    Level
                  </th>
                  <th scope="col" className={head}>
                    Since
                  </th>
                  <th scope="col" className={head}>
                    Measured
                  </th>
                  <th scope="col" className={head}>
                    Degraded at / failing at
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.conditions.map((condition) => (
                  <tr
                    key={condition.key}
                    className="border-b border-default"
                    data-testid="system-condition"
                    data-key={condition.key}
                  >
                    <td className={cell}>
                      {conditionName(condition.key)}
                      <span className="block text-xs text-muted">{condition.key}</span>
                      {condition.note !== null && (
                        <span className="block text-xs text-muted">{condition.note}</span>
                      )}
                    </td>
                    <td className={cell}>
                      <Level condition={condition} />
                      {condition.incident !== null && (
                        <span className="block text-xs">
                          incident #{String(condition.incident)}
                        </span>
                      )}
                    </td>
                    <td className={cell}>
                      <time dateTime={condition.since}>{ago(condition.since, now)}</time>
                    </td>
                    <td className={`${cell} tabular-nums`}>
                      {formatMeasure(condition.observed, condition.threshold.unit)}
                    </td>
                    <td className={`${cell} tabular-nums`}>
                      {formatMeasure(condition.threshold.degraded, condition.threshold.unit)} /{' '}
                      {formatMeasure(condition.threshold.failing, condition.threshold.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" data-testid="system-incidents">
        <h2 className="text-lg font-semibold">Open incidents</h2>
        {report.conditions.length === 0 ? (
          <p className="text-sm text-muted">
            No condition has been evaluated, so none can be open.
          </p>
        ) : open.length === 0 ? (
          <p className="text-sm text-muted" data-testid="system-incidents-none">
            No incident is open.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {open.map((condition) => (
              <li key={condition.key} data-testid="system-incident">
                #{String(condition.incident)} · {conditionName(condition.key)}:{' '}
                <Level condition={condition} /> for {ago(condition.since, now).replace(/ ago$/, '')}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" data-testid="system-events">
        <h2 className="text-lg font-semibold">Recent events</h2>
        {report.events.length === 0 ? (
          <p className="text-sm text-muted" data-testid="system-events-none">
            No change of level has been recorded.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-default text-sm">
            {report.events.map((event) => (
              <li key={event.id} className="py-1" data-testid="system-event" data-kind={event.kind}>
                <time dateTime={event.at}>{ago(event.at, now)}</time> ·{' '}
                {conditionName(event.condition)} {EVENT_WORDS[event.kind]} (
                {LEVEL_WORDS[event.from]} → {LEVEL_WORDS[event.to]}){event.alert ? ' · alert' : ''}
                {event.note !== null && (
                  <span className="block text-xs text-muted">{event.note}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

// --- alert delivery (T-802) --------------------------------------------------

export function AlertsSection({ report }: { report: AdminAlertsReport | null }) {
  if (report === null) {
    return (
      <section className="flex flex-col gap-3" data-testid="system-alerts">
        <h2 className="text-lg font-semibold">Alert delivery</h2>
        <Unavailable testId="system-alerts-unavailable" what="Where the alerts went" />
      </section>
    );
  }
  const { channels } = report;
  return (
    <section className="flex flex-col gap-3" data-testid="system-alerts">
      <h2 className="text-lg font-semibold">Alert delivery</h2>
      {channels.in_product_only ? (
        <Notice tone="warning" data-testid="system-alerts-inbox-only">
          Alerts reach the administrators&rsquo; inbox only: this deployment has no push and no
          e-mail channel, so nothing is sent to a device or an address.
        </Notice>
      ) : (
        <p className="text-sm" data-testid="system-alerts-channels">
          Inbox, and push {channels.push === 'configured' ? 'on' : 'not configured'}, e-mail{' '}
          {channels.email === 'configured' ? 'on' : 'not configured'}.
        </p>
      )}
      {report.administrators === 0 ? (
        <Notice tone="danger" data-testid="system-alerts-no-admin">
          No active account holds the admin role, so no alert is written for anybody.
        </Notice>
      ) : (
        <p className="text-sm text-muted">
          Written for {String(report.administrators)} administrator
          {report.administrators === 1 ? '' : 's'}. Delivered up to event #
          {String(report.cursor.last_event_id)}
          {report.cursor.advanced_at === null ? '' : `, last at ${report.cursor.advanced_at}`}.
        </p>
      )}
      {report.pending > 0 && (
        <Notice tone="warning" data-testid="system-alerts-pending">
          {String(report.pending)} alert{report.pending === 1 ? ' is' : 's are'} waiting to be
          delivered. If this stays above zero for more than a few minutes, the delivery is stuck:
          look for watchdog.alert_stuck in the API log.
        </Notice>
      )}
      {report.alerts.length === 0 ? (
        <p className="text-sm text-muted" data-testid="system-alerts-none">
          No alert has been delivered yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="system-alert-deliveries">
            <thead>
              <tr className="border-b border-default">
                <th scope="col" className={head}>
                  Alert
                </th>
                <th scope="col" className={head}>
                  Inbox
                </th>
                <th scope="col" className={head}>
                  Push
                </th>
                <th scope="col" className={head}>
                  E-mail
                </th>
              </tr>
            </thead>
            <tbody>
              {report.alerts.map((alert) => (
                <tr
                  key={alert.event.id}
                  className="border-b border-default"
                  data-testid="system-alert"
                >
                  <td className={cell}>
                    #{String(alert.event.id)} {conditionName(alert.event.condition)}{' '}
                    {EVENT_WORDS[alert.event.kind]}
                    <span className="block text-xs text-muted">
                      <time dateTime={alert.event.at}>{alert.event.at}</time>
                    </span>
                  </td>
                  <td className={`${cell} tabular-nums`}>
                    {alert.inbox === 0 ? 'none written' : String(alert.inbox)}
                  </td>
                  <td className={cell}>{channelLine(channels.push, alert.push)}</td>
                  <td className={cell}>{channelLine(channels.email, alert.email)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// --- API errors and job failures (T-803) -------------------------------------

const SPARK = { width: 120, height: 20 };

function Sparkline({
  series,
  direction,
  label,
}: {
  series: number[];
  direction: 'ltr' | 'rtl';
  label: string;
}) {
  const bars = sparkBars(series, SPARK.width, SPARK.height, direction);
  return (
    <svg
      viewBox={`0 0 ${String(SPARK.width)} ${String(SPARK.height)}`}
      className="h-5 w-32 text-danger"
      role="img"
      aria-label={label}
      data-testid="system-sparkline"
    >
      <line
        x1={0}
        x2={SPARK.width}
        y1={SPARK.height - 0.5}
        y2={SPARK.height - 0.5}
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
        />
      ))}
    </svg>
  );
}

function hourLabel(series: number[], window: string): string {
  const total = series.reduce((sum, n) => sum + n, 0);
  const busiest = Math.max(0, ...series);
  return `${String(total)} in the last ${window}; the busiest hour had ${String(busiest)}`;
}

function FailureWindow({
  report,
  window,
  direction,
  testId,
}: {
  report: FailureCountsReport | null;
  window: string;
  direction: 'ltr' | 'rtl';
  testId: string;
}) {
  if (report === null) {
    return (
      <Unavailable testId={`${testId}-unavailable`} what={`The counts for the last ${window}`} />
    );
  }
  const series = (hours: FailureCountsReport['http_errors'][number]['hours']) =>
    hourlySeries(hours, report.since, report.window_hours);
  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold">API errors (5xx) by route</h4>
        {report.http_errors.length === 0 ? (
          <p className="text-sm text-muted" data-testid={`${testId}-http-none`}>
            Nothing recorded in the last {window}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default">
                  <th scope="col" className={head}>
                    Route
                  </th>
                  <th scope="col" className={head}>
                    Total
                  </th>
                  <th scope="col" className={head}>
                    Per hour
                  </th>
                  <th scope="col" className={head}>
                    Newest (request id)
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.http_errors.map((row) => (
                  <tr
                    key={`${row.method} ${row.route}`}
                    className="border-b border-default"
                    data-testid="system-route-errors"
                  >
                    <td className={`${cell} font-mono text-xs`}>
                      {row.method} {row.route}
                    </td>
                    <td className={`${cell} tabular-nums`}>
                      {String(row.total)}
                      <span className="block text-xs text-muted">
                        {Object.entries(row.by_status)
                          .map(([status, n]) => `${status}: ${String(n)}`)
                          .join(', ')}
                      </span>
                    </td>
                    <td className={cell}>
                      <Sparkline
                        series={series(row.hours)}
                        direction={direction}
                        label={hourLabel(series(row.hours), window)}
                      />
                    </td>
                    <td className={`${cell} text-xs`}>
                      {row.newest.status} at <time dateTime={row.newest.at}>{row.newest.at}</time>
                      <span className="block font-mono">{row.newest.request_id}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold">Failed jobs by queue</h4>
        {report.job_failures.length === 0 ? (
          <p className="text-sm text-muted" data-testid={`${testId}-jobs-none`}>
            Nothing recorded in the last {window}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default">
                  <th scope="col" className={head}>
                    Queue
                  </th>
                  <th scope="col" className={head}>
                    Total
                  </th>
                  <th scope="col" className={head}>
                    Per hour
                  </th>
                  <th scope="col" className={head}>
                    Newest
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.job_failures.map((row) => (
                  <tr
                    key={row.queue}
                    className="border-b border-default"
                    data-testid="system-queue-failures"
                  >
                    <td className={`${cell} font-mono text-xs`}>{row.queue}</td>
                    <td className={`${cell} tabular-nums`}>
                      {String(row.total)}
                      <span className="block text-xs text-muted">
                        {String(row.by_kind.failed)} failed, {String(row.by_kind.stalled)} stalled
                      </span>
                    </td>
                    <td className={cell}>
                      <Sparkline
                        series={series(row.hours)}
                        direction={direction}
                        label={hourLabel(series(row.hours), window)}
                      />
                    </td>
                    <td className={`${cell} text-xs`}>
                      {row.newest.kind} {row.newest.job} at{' '}
                      <time dateTime={row.newest.at}>{row.newest.at}</time>
                      {row.newest.job_id !== null && (
                        <span className="block font-mono">job {row.newest.job_id}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function FailuresSection({
  day,
  week,
  direction,
}: {
  day: FailureCountsReport | null;
  week: FailureCountsReport | null;
  direction: 'ltr' | 'rtl';
}) {
  return (
    <section className="flex flex-col gap-6" data-testid="system-failures">
      <h2 className="text-lg font-semibold">API errors and job failures</h2>
      <p className="text-sm text-muted">
        Counted per UTC hour and kept for 30 days. Quote a request id to find its line in the API
        log; no stack or request body is kept here.
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Last 24 hours</h3>
        <FailureWindow
          report={day}
          window="24 hours"
          direction={direction}
          testId="system-failures-24h"
        />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Last 7 days</h3>
        <FailureWindow
          report={week}
          window="7 days"
          direction={direction}
          testId="system-failures-7d"
        />
      </div>
    </section>
  );
}
