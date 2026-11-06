import type { AccuracyMetrics } from '@fmip/contracts';
import { useId } from 'react';
import { MessageText } from '@/components/message-text';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { formatDate, formatNumber, intlLocale } from '@/i18n/format';
import { DEFAULT_LOCALE, directionOf, type Locale } from '@/i18n/locales';
import { interpolate, message, plural, t } from '@/i18n/messages';
import {
  completeWeeks,
  edgeOverGuess,
  formatEdge,
  WEEKLY_CHART_MINIMUM,
  weeklyChartGeometry,
  type WeekBar,
} from '@/lib/accuracy-edge';
import { filled, formatFixed } from '@/lib/words';

/**
 * "Each week, how much better than a guess" (T-1750, D-370): one bar a week
 * for `(uniform_rps - rps) / uniform_rps`, the same edge the opening card
 * states, so a reader who has never met RPS reads "taller is better". A week
 * worse than a guess is drawn below the axis and said in words; the last,
 * still-running week is lighter and dashed and said to be incomplete; a week
 * under the sample rule is drawn the same way and said too.
 *
 * Inline SVG rendered on the server: no chart library, no script. Widths are
 * percentages and heights pixels (no `viewBox`), so the labels stay their
 * own size on a phone. `role="img"` with a sentence that carries every
 * figure, and the same numbers as a table under a native disclosure. Time
 * runs from the inline start, so on a right-to-left page the oldest week is
 * on the right. The model's turquoise only: nothing here is saffron.
 *
 * With fewer than two complete weeks there is no chart, only the sentence
 * that says when there will be one: a single point is not a trend.
 */

const day = (lang: Locale, date: string, year = false): string =>
  formatDate(lang, `${date}T00:00:00Z`, 'UTC', {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' as const } : {}),
  });

function Heading({ lang }: { lang: Locale }) {
  return (
    <h2
      id="accuracy-weekly-heading"
      className="text-lg font-extrabold font-stretch-semi-expanded sm:text-xl"
    >
      <Translated locale={lang} message="modelAccuracy.weekly.title" />
    </h2>
  );
}

/** The chart's numbers as a table: every week, not only the ones drawn. */
function WeeksTable({ lang, weeks }: { lang: Locale; weeks: readonly WeekBar[] }) {
  const captionId = useId();
  const th = 'px-2 py-2 text-xs font-semibold text-caption';
  const cell = 'px-2 py-2 text-end';
  return (
    <details className="group border-t border-default" data-testid="accuracy-weekly-table">
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
        <table className="w-full min-w-100 border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-t border-default">
              <th scope="col" className={`${th} text-start`}>
                <Translated locale={lang} message="modelAccuracy.table.week" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={lang} message="modelAccuracy.table.matches" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={lang} message="modelAccuracy.table.rps" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={lang} message="modelAccuracy.table.rpsGuess" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={lang} message="modelAccuracy.weekly.edge" />
              </th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr
                key={week.period}
                className="border-t border-default"
                data-testid="accuracy-weekly-row"
                data-partial={week.partial ? 'true' : undefined}
              >
                <th scope="row" className="px-2 py-2 text-start font-semibold">
                  <time dateTime={week.periodStart} className="whitespace-nowrap">
                    {interpolate(t(lang, 'modelAccuracy.weekOf'), {
                      date: day(lang, week.periodStart, true),
                    })}
                  </time>
                  {week.partial && (
                    <span className="ms-2 text-xs font-normal text-muted">
                      (<Translated locale={lang} message="modelAccuracy.weekly.partialMark" />)
                    </span>
                  )}
                </th>
                <td className={cell}>{formatNumber(lang, week.matches)}</td>
                <td className={cell}>{formatFixed(lang, week.edge.model, 3)}</td>
                <td className={cx(cell, 'text-muted')}>{formatFixed(lang, week.edge.guess, 3)}</td>
                <td className={cx(cell, 'font-semibold')}>
                  <bdi dir="ltr">{formatEdge(lang, week.edge.percent)}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function WeeklyEdgeChart({
  lang,
  weeks,
  total,
  minimum,
  lastScoredAt,
}: {
  lang: Locale;
  /** The record's weeks, oldest first; null when the weekly figures did not arrive. */
  weeks: readonly WeekBar[] | null;
  /** Every match together: the line across the chart. */
  total: AccuracyMetrics;
  minimum: number;
  lastScoredAt: string | null;
}) {
  const frame = {
    'aria-labelledby': 'accuracy-weekly-heading',
    className: 'flex flex-col gap-3 rounded-tile border border-default bg-surface p-4 sm:p-6',
    'data-testid': 'accuracy-weekly',
  };

  if (weeks === null) {
    return (
      <section {...frame} data-chart="unreachable">
        <Heading lang={lang} />
        <p className="text-sm text-muted" data-testid="accuracy-weekly-unreachable">
          <Translated locale={lang} message="modelAccuracy.weekly.unreachable" />
        </p>
      </section>
    );
  }

  if (completeWeeks(weeks) < WEEKLY_CHART_MINIMUM) {
    const scored = weeks.reduce((sum, week) => sum + week.matches, 0);
    return (
      <section {...frame} data-chart="too-few">
        <Heading lang={lang} />
        <p className="max-w-measure text-sm text-muted" data-testid="accuracy-weekly-too-few">
          <Translated locale={lang} message="modelAccuracy.weekly.tooFew" />{' '}
          <Translated locale={lang} message="modelAccuracy.weekly.soFar" count={weeks.length} />{' '}
          <Translated locale={lang} message="modelAccuracy.available" count={scored} />
        </p>
      </section>
    );
  }

  const direction = directionOf(lang);
  const rtl = direction === 'rtl';
  const overall = edgeOverGuess(total.rps, total.uniform_rps);
  const chart = weeklyChartGeometry(weeks, direction, overall);
  const bars = chart.bars;
  const percents = bars.map((bar) => bar.edge.percent);
  const worse = percents.filter((percent) => percent < 0).length;
  const allBeat = percents.every((percent) => percent > 0);
  const last = bars.at(-1);
  const thin = bars.some((bar) => bar.limited && !bar.partial);

  // The sentence a screen reader hears in place of the picture: every bar's figure.
  const label = plural(lang, 'modelAccuracy.weekly.chartLabel', bars.length, {
    values: new Intl.ListFormat(intlLocale(lang), { style: 'long', type: 'conjunction' }).format(
      percents.map((percent) => formatEdge(lang, percent, false)),
    ),
    overall: overall === null ? '—' : formatEdge(lang, overall.percent, false),
    matches: formatNumber(lang, total.matches),
  });

  // On a phone the labels thin out as the weeks add up, counted from the latest:
  // every week to six, every second to nine, every third beyond; the figures
  // over the bars go past eight. All of them stay in the sentence and the table.
  const packed = bars.length > 8;
  const every = bars.length > 9 ? 3 : bars.length > 6 ? 2 : 1;
  const onPhone = (index: number): boolean => (bars.length - 1 - index) % every === 0;
  const tick = 'fill-caption text-[0.6875rem] tabular-nums';

  return (
    <section {...frame} data-chart="drawn">
      <Heading lang={lang} />
      <p className="max-w-measure text-sm text-muted">
        <Translated locale={lang} message="modelAccuracy.weekly.lede" />{' '}
        <span data-testid="accuracy-weekly-reading">
          {allBeat ? (
            <MessageText
              message={filled(message(lang, 'modelAccuracy.weekly.allBeat'), {
                low: formatEdge(lang, Math.min(...percents), false),
                high: formatEdge(lang, Math.max(...percents), false),
              })}
            />
          ) : worse > 0 ? (
            <Translated
              locale={lang}
              message="modelAccuracy.weekly.someWorse"
              count={worse}
              params={{ weeks: formatNumber(lang, bars.length) }}
            />
          ) : null}
        </span>
      </p>

      {/* One column on a phone; on a wide page the notes and the table sit beside the picture. */}
      <div className="grid gap-x-10 gap-y-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <svg
          role="img"
          aria-label={label.text}
          lang={label.status === 'untranslated' ? DEFAULT_LOCALE : undefined}
          width="100%"
          height={chart.height}
          className="block w-full min-w-0 overflow-visible text-fg"
          data-testid="accuracy-weekly-chart"
          data-direction={direction}
        >
          {chart.ticks.map((line) => (
            <g key={line.value}>
              <line
                x1="0"
                x2="100%"
                y1={line.y}
                y2={line.y}
                stroke="currentColor"
                strokeOpacity={line.value === 0 ? 0.6 : 0.14}
                strokeWidth={line.value === 0 ? 1.5 : 1}
              />
              {/* At the inline start, above its line; the digits stay left to right. */}
              <text
                x={rtl ? '100%' : '0'}
                y={line.y - 4}
                textAnchor={rtl ? 'end' : 'start'}
                direction="ltr"
                unicodeBidi="isolate"
                className={tick}
              >
                {formatEdge(lang, line.value, false)}
              </text>
            </g>
          ))}
          {chart.overallY !== null && (
            <line
              x1="0"
              x2="100%"
              y1={chart.overallY}
              y2={chart.overallY}
              className="stroke-model"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              data-mark="overall"
            />
          )}
          {bars.map((bar, index) => {
            const light = bar.partial || bar.limited;
            return (
              <g
                key={bar.period}
                data-testid="accuracy-week"
                data-week={bar.periodStart}
                data-edge={bar.edge.percent}
                data-below={bar.below ? 'true' : undefined}
                data-partial={bar.partial ? 'true' : undefined}
                data-limited={bar.limited ? 'true' : undefined}
              >
                <rect
                  x={`${bar.centre - bar.width / 2}%`}
                  width={`${bar.width}%`}
                  y={bar.y}
                  height={bar.height}
                  rx={3}
                  className={light ? 'fill-model/25 stroke-model' : 'fill-model'}
                  strokeWidth={light ? 1.5 : undefined}
                  strokeDasharray={light ? '4 3' : undefined}
                  data-mark="week"
                />
                <text
                  x={`${bar.centre}%`}
                  y={bar.labelY}
                  textAnchor="middle"
                  direction="ltr"
                  unicodeBidi="isolate"
                  // A halo in the card's own ground, so the line across never strikes a figure through.
                  className={cx(
                    'fill-fg stroke-surface stroke-[3px] text-xs font-bold tabular-nums [paint-order:stroke] [stroke-linejoin:round]',
                    packed && 'max-sm:hidden',
                  )}
                >
                  {formatEdge(lang, bar.edge.percent, false)}
                </text>
                <g className={cx(!onPhone(index) && 'max-sm:hidden')}>
                  <text
                    x={`${bar.centre}%`}
                    y={chart.dateY}
                    textAnchor="middle"
                    className="fill-muted text-[0.6875rem]"
                  >
                    {day(lang, bar.periodStart)}
                  </text>
                  <text
                    x={`${bar.centre}%`}
                    y={chart.matchesY}
                    textAnchor="middle"
                    className={tick}
                  >
                    {formatNumber(lang, bar.matches)}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        <div className="flex min-w-0 flex-col gap-3">
          <ul
            className="flex flex-col gap-1.5 text-xs text-muted"
            data-testid="accuracy-weekly-notes"
          >
            {overall !== null && chart.overallY !== null && (
              <li className="flex items-center gap-2">
                <svg
                  width="26"
                  height="6"
                  aria-hidden="true"
                  focusable="false"
                  className="shrink-0"
                >
                  <line
                    x1="0"
                    x2="26"
                    y1="3"
                    y2="3"
                    className="stroke-model"
                    strokeWidth="1.5"
                    strokeDasharray="6 4"
                  />
                </svg>
                <span>
                  <Translated
                    locale={lang}
                    message="modelAccuracy.weekly.overall"
                    count={total.matches}
                    params={{ edge: formatEdge(lang, overall.percent, false) }}
                  />
                </span>
              </li>
            )}
            <li>
              <Translated locale={lang} message="modelAccuracy.weekly.axis" />
            </li>
            {last?.partial === true && lastScoredAt !== null && (
              <li data-testid="accuracy-weekly-partial">
                <MessageText
                  message={filled(message(lang, 'modelAccuracy.weekly.partial'), {
                    date: formatDate(lang, lastScoredAt, 'UTC', { day: 'numeric', month: 'short' }),
                  })}
                />
              </li>
            )}
            {thin && (
              <li data-testid="accuracy-weekly-thin">
                <MessageText
                  message={filled(message(lang, 'modelAccuracy.weekly.thin'), {
                    minimum: formatNumber(lang, minimum),
                  })}
                />
              </li>
            )}
            {chart.omitted > 0 && (
              <li data-testid="accuracy-weekly-latest">
                <MessageText
                  message={filled(message(lang, 'modelAccuracy.weekly.latest'), {
                    weeks: formatNumber(lang, bars.length),
                  })}
                />
              </li>
            )}
          </ul>

          <WeeksTable lang={lang} weeks={weeks} />
        </div>
      </div>
    </section>
  );
}
