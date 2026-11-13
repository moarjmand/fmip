import type { AccuracyCalibration, AccuracyMetrics } from '@fmip/contracts';
import { useId } from 'react';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { formatNumber, intlLocale } from '@/i18n/format';
import { DEFAULT_LOCALE, directionOf, type Locale } from '@/i18n/locales';
import { interpolate, message, plural, t } from '@/i18n/messages';
import {
  CALIBRATION_CHART,
  CALIBRATION_TICKS,
  calibrationForecasts,
  calibrationGeometry,
  calibrationState,
  type CountSide,
} from '@/lib/accuracy-calibration';
import { filled, formatPercent } from '@/lib/words';

/**
 * "When it says 60%, how often does it happen?" (T-1751, D-370 point 11,
 * D-408; board P3-6): every probability of each match's counted forecast --
 * home, draw and away -- in ten steps of ten points, each a dot placed at
 * the mean probability the model gave and the share of those outcomes that
 * happened. On the diagonal is a perfect forecaster. A step under the
 * minimum is drawn hollow with its count beside it; a step with nothing has
 * no dot, never a zero; with no step at the minimum there is no chart, only
 * a sentence (rule 3).
 *
 * Inline SVG rendered on the server, as the weekly chart: no chart library,
 * no script. Widths are percentages and heights pixels (no `viewBox`), so the
 * labels keep their size on a phone. `role="img"` with a sentence carrying
 * every step's figures, and the same rows as a table under a native
 * disclosure. "What the model said" runs from the inline start, so on a
 * right-to-left page 0% is on the right. The model's turquoise only.
 */

const whole = (lang: Locale, value: number): string => formatPercent(lang, value * 100, 0);

function Heading({ lang }: { lang: Locale }) {
  return (
    <h2
      id="accuracy-calibration-heading"
      className="text-lg font-extrabold font-stretch-semi-expanded sm:text-xl"
    >
      <Translated locale={lang} message="modelAccuracy.calibration.title" />
    </h2>
  );
}

/**
 * "60% to 70%" as text, for the chart's sentence: each figure between
 * left-to-right isolates (U+2066 ... U+2069), so a right-to-left reading
 * keeps "۰٪" whole instead of turning it into "٪۰".
 */
const rangeOf = (lang: Locale, from: number, to: number): string =>
  interpolate(t(lang, 'modelAccuracy.calibration.range'), {
    from: `\u2066${whole(lang, from)}\u2069`,
    to: `\u2066${whole(lang, to)}\u2069`,
  });

/** The same step in the table, each figure in `<bdi dir="ltr">`, as the weekly table's edges. */
function Range({ lang, from, to }: { lang: Locale; from: number; to: number }) {
  return (
    <FilledMessage
      message={message(lang, 'modelAccuracy.calibration.range')}
      params={{
        from: <bdi dir="ltr">{whole(lang, from)}</bdi>,
        to: <bdi dir="ltr">{whole(lang, to)}</bdi>,
      }}
    />
  );
}

/** The chart's rows as a table: all ten steps, an empty one with dashes, not zeros. */
function CalibrationTable({
  lang,
  calibration,
}: {
  lang: Locale;
  calibration: AccuracyCalibration;
}) {
  const captionId = useId();
  const th = 'px-2 py-2 text-xs font-semibold text-caption';
  const cell = 'px-2 py-2 text-end';
  const sticky = 'sticky start-0 z-1 bg-surface';
  const minimum = formatNumber(lang, calibration.minimum_forecasts);
  return (
    <details className="group border-t border-default" data-testid="accuracy-calibration-table">
      <summary
        id={captionId}
        className="flex min-h-touch cursor-pointer list-none items-center gap-2 text-sm font-bold text-accent hover:underline [&::-webkit-details-marker]:hidden"
      >
        <Translated locale={lang} message="modelAccuracy.weekly.table" />
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          focusable="false"
          className="shrink-0 group-open:rotate-180 motion-safe:transition-transform"
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div
        className="scroll-cue overflow-x-auto focus-visible:outline-2 focus-visible:outline-focus"
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
      >
        {/* The answer, the share that happened, stands next to the step: on a
            phone it is in view without scrolling, and the step column stays put
            if the table scrolls at all (review of the T-1751 screenshots). */}
        <table className="w-full border-collapse text-sm tabular-nums">
          <caption className="sr-only">
            <Translated locale={lang} message="modelAccuracy.calibration.title" />
          </caption>
          <thead>
            <tr className="border-t border-default">
              <th scope="col" className={cx(th, sticky, 'text-start')}>
                <Translated locale={lang} message="modelAccuracy.calibration.said" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={lang} message="modelAccuracy.calibration.share" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={lang} message="modelAccuracy.calibration.forecasts" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={lang} message="modelAccuracy.calibration.happened" />
              </th>
            </tr>
          </thead>
          <tbody>
            {calibration.bins.map((bin) => {
              const thin = bin.forecasts > 0 && bin.forecasts < calibration.minimum_forecasts;
              return (
                <tr
                  key={bin.from}
                  className="border-t border-default"
                  data-testid="accuracy-calibration-row"
                  data-thin={thin ? 'true' : undefined}
                >
                  <th scope="row" className={cx('px-2 py-2 text-start font-semibold', sticky)}>
                    <span className="whitespace-nowrap">
                      <Range lang={lang} from={bin.from} to={bin.to} />
                    </span>
                    {thin && (
                      <span className="block text-xs font-normal text-muted">
                        (
                        <MessageText
                          message={filled(message(lang, 'modelAccuracy.calibration.thinMark'), {
                            minimum,
                          })}
                        />
                        )
                      </span>
                    )}
                  </th>
                  <td className={cx(cell, 'font-semibold')}>
                    {bin.forecasts === 0 ? (
                      '—'
                    ) : (
                      <bdi dir="ltr">{whole(lang, bin.happened / bin.forecasts)}</bdi>
                    )}
                  </td>
                  <td className={cell}>
                    {bin.forecasts === 0 ? '—' : formatNumber(lang, bin.forecasts)}
                  </td>
                  <td className={cell}>
                    {bin.forecasts === 0 ? '—' : formatNumber(lang, bin.happened)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** The count's position for its side; "end" and "start" follow the reading direction. */
function countPlacement(
  side: CountSide,
  y: number,
  rtl: boolean,
): { dx: number; y: number; textAnchor: 'start' | 'middle' | 'end' } {
  const { radius } = CALIBRATION_CHART;
  if (side === 'above') return { dx: 0, y: y - radius - 7, textAnchor: 'middle' };
  if (side === 'below') return { dx: 0, y: y + radius + 14, textAnchor: 'middle' };
  const towardsEnd = side === 'end';
  const right = towardsEnd !== rtl;
  return {
    dx: (right ? 1 : -1) * (radius + 4),
    y: y + 4,
    textAnchor: right ? 'start' : 'end',
  };
}

export function CalibrationChart({
  lang,
  calibration,
  total,
}: {
  lang: Locale;
  calibration: AccuracyCalibration;
  /** Every match together: the sample the probabilities are from. */
  total: AccuracyMetrics;
}) {
  const state = calibrationState(calibration);
  // Nothing scored: no section at all (the opening card already says so).
  if (state === 'empty') return null;
  const frame = {
    'aria-labelledby': 'accuracy-calibration-heading',
    className: 'flex flex-col gap-3 rounded-tile border border-default bg-surface p-4 sm:p-6',
    'data-testid': 'accuracy-calibration',
  };
  const forecasts = calibrationForecasts(calibration);
  const minimum = formatNumber(lang, calibration.minimum_forecasts);

  if (state === 'thin') {
    return (
      <section {...frame} data-chart="too-thin">
        <Heading lang={lang} />
        <p className="max-w-measure text-sm text-muted" data-testid="accuracy-calibration-thin">
          <Translated
            locale={lang}
            message="modelAccuracy.calibration.tooThin"
            count={forecasts}
            params={{ minimum }}
          />
        </p>
      </section>
    );
  }

  const direction = directionOf(lang);
  const rtl = direction === 'rtl';
  const chart = calibrationGeometry(calibration, direction);
  const { radius } = CALIBRATION_CHART;

  // The sentence a screen reader hears in place of the picture: every step drawn.
  const steps = chart.points.map(
    (point) =>
      plural(lang, 'modelAccuracy.calibration.step', point.forecasts, {
        range: rangeOf(lang, point.from, point.to),
        share: whole(lang, point.share),
      }).text,
  );
  const label = filled(message(lang, 'modelAccuracy.calibration.chartLabel'), {
    values: new Intl.ListFormat(intlLocale(lang), { style: 'long', type: 'conjunction' }).format(
      steps,
    ),
  });
  const tick = 'fill-caption text-[0.6875rem] tabular-nums';
  const x0 = chart.xOf(0);
  const x1 = chart.xOf(1);

  return (
    <section {...frame} data-chart="drawn">
      <Heading lang={lang} />
      <p className="max-w-measure text-sm text-muted">
        <Translated locale={lang} message="modelAccuracy.calibration.lede" />{' '}
        <Translated
          locale={lang}
          message="modelAccuracy.calibration.pooled"
          count={total.matches}
          params={{ forecasts: formatNumber(lang, forecasts) }}
        />
      </p>

      <div className="grid gap-x-10 gap-y-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-semibold text-caption" aria-hidden="true">
            <Translated locale={lang} message="modelAccuracy.calibration.axisY" />
          </p>
          {/* The SVG is the plot, edge to edge; the gridline labels and the
              halves of the end labels sit in this padding (logical, so it
              mirrors), never clipped and never over the axis. */}
          <div className="ps-10 pe-5" data-testid="accuracy-calibration-plot">
            <svg
              role="img"
              aria-label={label.text}
              lang={label.status === 'untranslated' ? DEFAULT_LOCALE : undefined}
              width="100%"
              height={chart.height}
              className="block w-full min-w-0 overflow-visible text-fg"
              data-testid="accuracy-calibration-chart"
              data-direction={direction}
            >
              {CALIBRATION_TICKS.map((value) => (
                <g key={value}>
                  {/* Across: how often it happened. */}
                  <line
                    x1={`${Math.min(x0, x1)}%`}
                    x2={`${Math.max(x0, x1)}%`}
                    y1={chart.yOf(value)}
                    y2={chart.yOf(value)}
                    stroke="currentColor"
                    strokeOpacity={value === 0 ? 0.6 : 0.14}
                    strokeWidth={value === 0 ? 1.5 : 1}
                  />
                  {/* Beside the axis, in the inline-start padding, ending a gap short of the line. */}
                  <text
                    x={rtl ? '100%' : '0'}
                    dx={rtl ? 6 : -6}
                    y={chart.yOf(value) + 4}
                    textAnchor={rtl ? 'start' : 'end'}
                    direction="ltr"
                    unicodeBidi="isolate"
                    className={tick}
                  >
                    {whole(lang, value)}
                  </text>
                  {/* Down: what the model said, its label under the plot. */}
                  <line
                    x1={`${chart.xOf(value)}%`}
                    x2={`${chart.xOf(value)}%`}
                    y1={chart.topY}
                    y2={chart.bottom}
                    stroke="currentColor"
                    strokeOpacity={value === 0 ? 0.6 : 0.14}
                    strokeWidth={value === 0 ? 1.5 : 1}
                  />
                  <text
                    x={`${chart.xOf(value)}%`}
                    y={chart.labelY}
                    textAnchor="middle"
                    direction="ltr"
                    unicodeBidi="isolate"
                    className={tick}
                  >
                    {whole(lang, value)}
                  </text>
                </g>
              ))}
              {/* A perfect forecaster: what it says happens that often. Grey, named in the notes. */}
              <line
                x1={`${x0}%`}
                y1={chart.yOf(0)}
                x2={`${x1}%`}
                y2={chart.yOf(1)}
                className="stroke-caption"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                data-mark="perfect"
              />
              {chart.points.map((point) => (
                <g
                  key={point.from}
                  data-testid="accuracy-calibration-step"
                  data-from={point.from}
                  data-forecasts={point.forecasts}
                  data-thin={point.thin ? 'true' : undefined}
                >
                  <circle
                    cx={`${point.x}%`}
                    cy={point.y}
                    r={radius}
                    className={point.thin ? 'fill-surface stroke-model' : 'fill-model stroke-model'}
                    strokeWidth={2}
                    data-mark="step"
                  />
                  {point.thin && (
                    // The count beside a hollow dot, where it touches no other dot
                    // (`countSide`, worked out for the narrowest phone).
                    <text
                      x={`${point.x}%`}
                      {...countPlacement(point.countSide, point.y, rtl)}
                      data-side={point.countSide}
                      direction="ltr"
                      unicodeBidi="isolate"
                      className="fill-muted stroke-surface stroke-[3px] text-[0.6875rem] tabular-nums [paint-order:stroke] [stroke-linejoin:round]"
                    >
                      {formatNumber(lang, point.forecasts)}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
          <p className="text-center text-xs font-semibold text-caption" aria-hidden="true">
            <Translated locale={lang} message="modelAccuracy.calibration.axisX" />
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <ul
            className="flex flex-col gap-1.5 text-xs text-muted"
            data-testid="accuracy-calibration-notes"
          >
            <li className="flex items-center gap-2">
              <svg width="14" height="14" aria-hidden="true" focusable="false" className="shrink-0">
                <circle cx="7" cy="7" r="5" className="fill-model stroke-model" strokeWidth="2" />
              </svg>
              <span>
                <MessageText
                  message={filled(message(lang, 'modelAccuracy.calibration.solid'), { minimum })}
                />
              </span>
            </li>
            {chart.points.some((point) => point.thin) && (
              <li className="flex items-center gap-2" data-testid="accuracy-calibration-hollow">
                <svg
                  width="14"
                  height="14"
                  aria-hidden="true"
                  focusable="false"
                  className="shrink-0"
                >
                  <circle
                    cx="7"
                    cy="7"
                    r="5"
                    className="fill-surface stroke-model"
                    strokeWidth="2"
                  />
                </svg>
                <span>
                  <MessageText
                    message={filled(message(lang, 'modelAccuracy.calibration.hollow'), {
                      minimum,
                    })}
                  />
                </span>
              </li>
            )}
            <li className="flex items-center gap-2">
              <svg width="26" height="6" aria-hidden="true" focusable="false" className="shrink-0">
                <line
                  x1="0"
                  x2="26"
                  y1="3"
                  y2="3"
                  className="stroke-caption"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                />
              </svg>
              <span>
                <Translated locale={lang} message="modelAccuracy.calibration.perfect" />
              </span>
            </li>
          </ul>

          <CalibrationTable lang={lang} calibration={calibration} />
        </div>
      </div>
    </section>
  );
}
