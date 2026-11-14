import type {
  AccuracyMetrics,
  AccuracyPeriod,
  AccuracyPoint,
  PublicAccuracyPoint,
  AccuracyReference,
  PublicAccuracySeries,
  PublicModelAccuracyResponse,
} from '@fmip/contracts';
import type { ReactNode } from 'react';
import { Fragment, useId } from 'react';
import Link from '@/components/ui/link';
import { CalibrationChart } from '@/components/accuracy-calibration-chart';
import { VerdictCard } from '@/components/accuracy-verdict';
import { VersionCards } from '@/components/accuracy-version-cards';
import { WeeklyEdgeChart } from '@/components/accuracy-weekly-chart';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { ModelVersion } from '@/components/model-version';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { ButtonLink } from '@/components/ui/button';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { formatDate, formatGregorianMonth, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type Message, type MessageKey, interpolate, message, plural, t } from '@/i18n/messages';
import {
  type AccuracySort,
  type CompetitionRow,
  accuracyHref,
  edgeBarWidth,
  formatEdge,
  groupCompetitions,
  verdictState,
  weeklyEdges,
} from '@/lib/accuracy-edge';
import { formatFixed, formatPercent } from '@/lib/words';

/**
 * "How accurate is our model?" (T-1369, D-187): the statistical model's
 * published pre-kick-off forecasts, scored after the match, over every
 * competition and each one. Only the model: the founder's analysis and the
 * community's consensus are other products, named here only to say they are
 * not counted (rule 6). A row with no match scored shows no figure and says
 * so; one below the minimum shows its figures marked limited with the count
 * beside them (rule 3). In this file rather than a shared table, like every
 * product's own components.
 *
 * The page a football reader can read (T-1750, D-370), top to bottom: a band
 * naming the model, its versions and the last scoring day; the opening card
 * (`VerdictCard`: two plain facts and, beside them, the warning that a guess
 * of one third each is the weakest benchmark); the weekly chart of how much
 * better than a guess (`WeeklyEdgeChart`); the competitions as one compact
 * list, each row a native disclosure, those under the sample rule a separate
 * dashed group; RPS, Brier and log loss, the month or week table and the
 * long explanation under one closed disclosure; and a link on to today's
 * forecasts. T-1751 (D-408) adds, after the weekly chart, the calibration
 * chart (`CalibrationChart`) and each published version on its own
 * (`VersionCards`), from the API's own fields: never an empty frame (rule 3).
 *
 * The interface face throughout: the serif is the founder's voice (D-263),
 * never the model's. The model's data is drawn in its turquoise only;
 * saffron is on controls only (the closing button, the disclosures, the sort
 * and period links), never on a data mark. Server components only.
 */

const filled = (m: Message, params: Record<string, string>): Message => ({
  ...m,
  text: interpolate(m.text, params),
});

/** A row's period as a reader names it: "October 2026", or "Week of 12 Oct 2026" (Monday, UTC). */
function periodName(lang: Locale, point: AccuracyPoint, period: AccuracyPeriod): string {
  if (period === 'month') return formatGregorianMonth(lang, point.period);
  return interpolate(t(lang, 'modelAccuracy.weekOf'), {
    date: formatDate(lang, `${point.period_start}T00:00:00Z`, 'UTC', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
  });
}

/** A figure, or the dash for a figure with nothing behind it. */
const fixed = (lang: Locale, value: number | null) =>
  value === null ? '—' : formatFixed(lang, value, 3);
const percent = (lang: Locale, value: number | null) =>
  value === null ? '—' : formatPercent(lang, value * 100);

const coverageBadge = (lang: Locale, metrics: AccuracyMetrics) => (
  <CoverageBadge
    state={metrics.coverage}
    label={<Translated locale={lang} message={COVERAGE_KEY[metrics.coverage]} />}
  />
);

/** The disclosure's chevron: down when closed, turned by the caller's `group-open`. */
function Chevron({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      className={cx('shrink-0 motion-safe:transition-transform', className)}
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
  );
}

// ---------------------------------------------------------------------------
// The band
// ---------------------------------------------------------------------------

/**
 * The versions in the mono face, left to right, each kept on one line and
 * each an element of its own, never "name@x.y.z" as one run (T-1580).
 */
function VersionList({ versions, className }: { versions: readonly string[]; className?: string }) {
  return (
    <span dir="ltr" className={cx('font-mono text-xs', className)}>
      {versions.map((version, i) => (
        <Fragment key={version}>
          {i > 0 && ', '}
          <span className="whitespace-nowrap">
            <ModelVersion version={version} />
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The page's band (T-1620): the model's lane and the question on the
 * surface, and the one line that this is the statistical model and nothing
 * else (rule 6). The versions and the last scoring day sit under the verdict
 * (`AccuracyMeta`).
 */
export function ModelAccuracyBand({ locale }: { locale: string }) {
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <header className="border-b border-default bg-surface" data-testid="accuracy-band">
      <div className="page-frame flex flex-col gap-4 py-6 sm:gap-5 sm:py-9">
        <div className="flex min-w-0 flex-col gap-2.5">
          <p className="inline-flex items-center gap-2 text-xs font-extrabold tracking-wider text-model uppercase">
            <Icon name="model" size={16} strokeWidth={2.2} />
            <Translated locale={lang} message="lanes.model.title" />
          </p>
          <h1
            className="text-2xl leading-tight font-extrabold break-words font-stretch-semi-expanded sm:text-display-3"
            data-testid="title"
          >
            <Translated locale={lang} message="modelAccuracy.meta.title" />
          </h1>
          <p className="max-w-measure text-base text-muted" data-testid="accuracy-only">
            <Translated locale={lang} message="competitionPage.model.only" />
          </p>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

/** How many matches a row is over, and whether that is enough to call (rule 3). */
function Standing({
  lang,
  metrics,
  minimum,
}: {
  lang: Locale;
  metrics: AccuracyMetrics;
  minimum: number;
}) {
  if (metrics.coverage === 'not_supplied') {
    return (
      <p className="text-sm text-muted" data-testid="accuracy-not-supplied">
        <Translated locale={lang} message="modelAccuracy.notSupplied" />
      </p>
    );
  }
  const text =
    metrics.coverage === 'limited'
      ? plural(lang, 'modelAccuracy.limited', metrics.matches, {
          minimum: formatNumber(lang, minimum),
        })
      : plural(lang, 'modelAccuracy.available', metrics.matches);
  return (
    <p
      className={cx('text-sm', metrics.coverage === 'limited' ? 'text-fg' : 'text-muted')}
      data-testid={`accuracy-${metrics.coverage}`}
    >
      <MessageText message={text} />
    </p>
  );
}

/** "Lower is better", with a small arrow, for the three error scores. */
function Lower({ lang }: { lang: Locale }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
      >
        <path
          d="M5 1.5v7M2 5.5l3 3 3-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <Translated locale={lang} message="modelAccuracy.kpi.lower" />
    </span>
  );
}

interface Tile {
  key: string;
  label: MessageKey;
  value: string;
  /** What a forecast of one third each scores on the same matches. */
  guess?: string;
  lower?: boolean;
  meaning: MessageKey;
}

function tilesOf(lang: Locale, total: AccuracyMetrics, ref: AccuracyReference): Tile[] {
  return [
    {
      key: 'matches',
      label: 'modelAccuracy.table.matches',
      value: formatNumber(lang, total.matches),
      meaning: 'modelAccuracy.kpi.matchesMeaning',
    },
    {
      key: 'correct',
      label: 'modelAccuracy.table.correct',
      value: percent(lang, total.accuracy),
      guess: formatPercent(lang, ref.uniform_accuracy * 100, 0),
      meaning: 'modelAccuracy.kpi.correctMeaning',
    },
    {
      key: 'rps',
      label: 'modelAccuracy.table.rps',
      value: fixed(lang, total.rps),
      ...(total.uniform_rps === null ? {} : { guess: fixed(lang, total.uniform_rps) }),
      lower: true,
      meaning: 'modelAccuracy.measures.rps',
    },
    {
      key: 'brier',
      label: 'modelAccuracy.table.brier',
      value: fixed(lang, total.brier),
      guess: formatFixed(lang, ref.uniform_brier, 3),
      lower: true,
      meaning: 'modelAccuracy.measures.brier',
    },
    {
      key: 'log-loss',
      label: 'modelAccuracy.table.logLoss',
      value: fixed(lang, total.log_loss),
      guess: formatFixed(lang, ref.uniform_log_loss, 3),
      lower: true,
      meaning: 'modelAccuracy.measures.logLoss',
    },
  ];
}

/**
 * Every competition's totals as five tiles (T-1620), under "Show all
 * measures" since T-1750: the figure large, what a blind guess scores beside
 * it, "lower is better" on the three error scores and one plain sentence of
 * what it means. The model's turquoise only as the tiles' top edge, as on
 * the product lanes (D-263).
 */
function KpiTiles({
  lang,
  total,
  reference,
}: {
  lang: Locale;
  total: AccuracyMetrics;
  reference: AccuracyReference;
}) {
  return (
    <dl
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      data-testid="accuracy-kpis"
    >
      {tilesOf(lang, total, reference).map((tile) => (
        <div
          key={tile.key}
          className={cx(
            'flex min-w-0 flex-col gap-2 rounded-tile border border-t-3 border-default border-t-model bg-surface p-4',
            tile.key === 'matches' && 'col-span-2 sm:col-span-1',
          )}
          data-testid="accuracy-kpi"
          data-metric={tile.key}
        >
          <dt className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-sm font-extrabold">
              <Translated locale={lang} message={tile.label} />
            </span>
            {tile.lower === true && <Lower lang={lang} />}
          </dt>
          <dd className="flex flex-col gap-2">
            <span className="text-3xl leading-none font-extrabold font-stretch-condensed tabular-nums sm:text-display-2">
              {tile.value}
            </span>
            {tile.guess !== undefined && (
              <span className="text-xs text-muted tabular-nums" data-testid="accuracy-kpi-guess">
                <MessageText
                  message={filled(message(lang, 'modelAccuracy.kpi.guess'), { value: tile.guess })}
                />
              </span>
            )}
            <span className="text-xs text-caption">
              <Translated locale={lang} message={tile.meaning} />
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function Cells({ lang, metrics }: { lang: Locale; metrics: AccuracyMetrics }) {
  const cell = 'px-2 py-2.5 text-end';
  return (
    <>
      <td className={cell}>{formatNumber(lang, metrics.matches)}</td>
      <td className={cell}>{percent(lang, metrics.accuracy)}</td>
      <td className={cell}>{fixed(lang, metrics.rps)}</td>
      <td className={cx(cell, 'text-muted')}>{fixed(lang, metrics.uniform_rps)}</td>
      <td className={cell}>{fixed(lang, metrics.brier)}</td>
      <td className={cell}>{fixed(lang, metrics.log_loss)}</td>
      <td className="px-2 py-2.5 pe-4 text-start sm:pe-4.5">{coverageBadge(lang, metrics)}</td>
    </>
  );
}

/**
 * A series by period, then all of them together (T-1369), in the design
 * system's table: the caption on top, hairline rows, tabular figures, each
 * row's coverage as its badge. Wider than a phone, so its box scrolls
 * sideways with the scroll cue (T-1395) and is a named region the keyboard
 * reaches (axe `scrollable-region-focusable`, T-1571), named by the caption
 * written above it.
 */
function PeriodTable({
  lang,
  series,
  period,
}: {
  lang: Locale;
  series: PublicAccuracySeries;
  period: AccuracyPeriod;
}) {
  const weekly = period === 'week';
  const captionId = useId();
  const th = 'px-2 py-2 text-xs font-semibold text-caption';
  const head: MessageKey[] = [
    'modelAccuracy.table.matches',
    'modelAccuracy.table.correct',
    'modelAccuracy.table.rps',
    'modelAccuracy.table.rpsGuess',
    'modelAccuracy.table.brier',
    'modelAccuracy.table.logLoss',
  ];
  const caption = (
    <Translated
      locale={lang}
      message={weekly ? 'modelAccuracy.table.captionWeek' : 'modelAccuracy.table.caption'}
    />
  );
  return (
    <>
      {/* Above the scrolling box, so a phone reads it whole; it names the region. */}
      <p id={captionId} className="px-4 pt-3 pb-2 text-xs text-muted sm:px-4.5">
        {caption}
      </p>
      <div
        className="scroll-cue overflow-x-auto focus-visible:outline-2 focus-visible:outline-focus"
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
        data-testid="accuracy-months-scroll"
      >
        <table
          className="w-full min-w-160 border-collapse text-sm tabular-nums"
          data-testid="accuracy-months"
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-t border-default">
              <th scope="col" className={`${th} ps-4 text-start sm:ps-4.5`}>
                <Translated
                  locale={lang}
                  message={weekly ? 'modelAccuracy.table.week' : 'modelAccuracy.table.month'}
                />
              </th>
              {head.map((key) => (
                <th key={key} scope="col" className={`${th} text-end`}>
                  <Translated locale={lang} message={key} />
                </th>
              ))}
              <th scope="col" className={`${th} pe-4 text-start sm:pe-4.5`}>
                <Translated locale={lang} message="modelAccuracy.table.coverage" />
              </th>
            </tr>
          </thead>
          <tbody>
            {series.points.map((point) => (
              <tr
                key={point.period}
                className="border-t border-default"
                data-testid="accuracy-month"
                data-coverage={point.coverage}
              >
                <th
                  scope="row"
                  className="px-2 py-2.5 ps-4 text-start font-semibold whitespace-nowrap sm:ps-4.5"
                >
                  <time dateTime={weekly ? point.period_start : point.period}>
                    {periodName(lang, point, period)}
                  </time>
                </th>
                <Cells lang={lang} metrics={point} />
              </tr>
            ))}
            <tr
              className="border-t-2 border-strong bg-surface-raised font-bold"
              data-testid="accuracy-all-months"
            >
              <th scope="row" className="px-2 py-2.5 ps-4 text-start whitespace-nowrap sm:ps-4.5">
                <Translated
                  locale={lang}
                  message={weekly ? 'modelAccuracy.table.allWeeks' : 'modelAccuracy.table.all'}
                />
              </th>
              <Cells lang={lang} metrics={series.total} />
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/** "Model versions: …" under a series' table. */
function Versions({ lang, versions }: { lang: Locale; versions: readonly string[] }) {
  return (
    <p className="text-xs text-muted">
      <FilledMessage
        message={message(lang, 'modelAccuracy.versions')}
        params={{ versions: <VersionList versions={versions} /> }}
      />
    </p>
  );
}

// ---------------------------------------------------------------------------
// The competitions
// ---------------------------------------------------------------------------

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-lg font-extrabold font-stretch-semi-expanded sm:text-xl">
      {children}
    </h2>
  );
}

/** The list's columns: name, matches, correct, the bar, the edge, the chevron. A phone drops "correct" and puts the bar on a second line. */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_2.75rem_3.5rem_0.75rem] items-center gap-x-3 gap-y-1.5 px-4 sm:grid-cols-[minmax(0,1.5fr)_3.25rem_3.75rem_minmax(0,2fr)_3.75rem_0.75rem] sm:px-4.5';

/** One figure in an opened row: small, beside the others. */
function Figure({ label, value, guess }: { label: ReactNode; value: string; guess?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-caption">{label}</dt>
      <dd className="flex flex-col">
        <span className="text-xl leading-tight font-extrabold font-stretch-condensed tabular-nums">
          {value}
        </span>
        {guess}
      </dd>
    </div>
  );
}

/**
 * Better or worse than a guess as a bar from the centre line: towards the
 * inline end is better, towards the inline start worse, so it mirrors on a
 * right-to-left page. Solid at or over the sample rule, dashed under it. The
 * signed figure beside it says the same in words, so the bar is decoration
 * to a screen reader. The model's turquoise on both sides: which side is the
 * sign, not a second colour.
 */
function EdgeBar({ percent: edge, early }: { percent: number | null; early: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative order-last col-span-full block h-2.5 sm:order-none sm:col-span-1"
      data-testid="accuracy-edge-bar"
    >
      <span className="absolute -inset-y-1 start-1/2 w-px bg-caption" />
      {edge !== null && edge !== 0 && (
        <span
          className={cx(
            'absolute inset-y-0 rounded-sm',
            edge < 0 ? 'end-1/2' : 'start-1/2',
            early ? 'border border-dashed border-model bg-model/20' : 'bg-model',
          )}
          style={{ inlineSize: `${edgeBarWidth(edge)}%` }}
          data-mark="edge"
          data-side={edge < 0 ? 'worse' : 'better'}
          data-early={early ? 'true' : undefined}
        />
      )}
    </span>
  );
}

/**
 * One competition as one row (T-1750): its logo (the lettered mark when none
 * is held, rule 3), its name, its matches, how often the model was right, a
 * bar for better or worse than a guess and the signed figure. The row is a
 * native disclosure: opened, it shows the five figures the cards showed, the
 * sample sentence, its months or weeks and the way to the competition's
 * page. Nothing scored: the name, the coverage badge and the sentence; no
 * figure, no bar, no zero, and nothing to open.
 */
function EdgeRow({
  lang,
  row,
  report,
}: {
  lang: Locale;
  row: CompetitionRow;
  report: PublicModelAccuracyResponse;
}) {
  const { series, edge } = row;
  const competition = series.competition;
  if (competition === null) return null;
  const total = series.total;
  const early = total.coverage !== 'available';
  const name = (
    <span className="flex min-w-0 items-center gap-2.5">
      <EntityImage media={competition.logo} kind="logo" name={competition.name} size={28} />
      <span className="min-w-0 text-sm font-bold break-words">{competition.name}</span>
    </span>
  );
  const item = {
    className: 'border-t border-default',
    'data-testid': 'accuracy-competition',
    'data-coverage': total.coverage,
  };

  if (total.coverage === 'not_supplied' || total.matches === 0) {
    return (
      <li {...item}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-4.5">
          {name}
          {coverageBadge(lang, total)}
          <Standing lang={lang} metrics={total} minimum={report.minimum_matches} />
        </div>
      </li>
    );
  }

  const label = (key: MessageKey) => (
    <span className="sr-only">
      <Translated locale={lang} message={key} />:{' '}
    </span>
  );
  return (
    <li {...item}>
      <details className="group/row">
        {/* The grid is a box inside the summary: a summary that is itself a grid loses its marker handling in older Safari. */}
        <summary className="block cursor-pointer list-none hover:bg-surface-raised [&::-webkit-details-marker]:hidden">
          <span className={cx(ROW_GRID, 'min-h-touch py-2.5')}>
            {name}
            <span className="text-end text-sm tabular-nums">
              {label('modelAccuracy.table.matches')}
              {formatNumber(lang, total.matches)}
            </span>
            <span className="hidden text-end text-sm tabular-nums sm:block">
              {label('modelAccuracy.table.correct')}
              {percent(lang, total.accuracy)}
            </span>
            <EdgeBar percent={edge?.percent ?? null} early={early} />
            <span
              className="text-end text-sm font-extrabold tabular-nums"
              data-testid="accuracy-edge"
            >
              {label('modelAccuracy.weekly.edge')}
              {edge === null ? '—' : <bdi dir="ltr">{formatEdge(lang, edge.percent)}</bdi>}
            </span>
            <Chevron className="text-muted group-open/row:rotate-180" />
          </span>
        </summary>
        <div className="flex flex-col gap-3 bg-surface-raised px-4 pt-2 pb-4 sm:px-4.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {early && coverageBadge(lang, total)}
            <Standing lang={lang} metrics={total} minimum={report.minimum_matches} />
          </div>
          <dl className="grid grid-cols-3 gap-x-3 gap-y-3 sm:grid-cols-5">
            <Figure
              label={<Translated locale={lang} message="modelAccuracy.table.matches" />}
              value={formatNumber(lang, total.matches)}
            />
            <Figure
              label={<Translated locale={lang} message="modelAccuracy.table.correct" />}
              value={percent(lang, total.accuracy)}
            />
            <Figure
              label={<Translated locale={lang} message="modelAccuracy.table.rps" />}
              value={fixed(lang, total.rps)}
              guess={
                total.uniform_rps === null ? undefined : (
                  <span className="text-xs text-muted tabular-nums">
                    <MessageText
                      message={filled(message(lang, 'modelAccuracy.kpi.guess'), {
                        value: fixed(lang, total.uniform_rps),
                      })}
                    />
                  </span>
                )
              }
            />
            <Figure
              label={<Translated locale={lang} message="modelAccuracy.table.brier" />}
              value={fixed(lang, total.brier)}
            />
            <Figure
              label={<Translated locale={lang} message="modelAccuracy.table.logLoss" />}
              value={fixed(lang, total.log_loss)}
            />
          </dl>
          <details className="group/period rounded-tile border border-default bg-surface">
            <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 px-4 text-sm font-bold text-accent hover:underline sm:px-4.5 [&::-webkit-details-marker]:hidden">
              <Translated
                locale={lang}
                message={
                  report.period === 'week'
                    ? 'modelAccuracy.competition.weeks'
                    : 'modelAccuracy.competition.months'
                }
              />
              <Chevron className="group-open/period:rotate-180" />
            </summary>
            <PeriodTable lang={lang} series={series} period={report.period} />
            <div className="border-t border-default px-4 py-3 sm:px-4.5">
              <Versions lang={lang} versions={series.model_versions} />
            </div>
          </details>
          <Link
            href={`/${lang}/competition/${encodeURIComponent(competition.id)}`}
            className="inline-flex min-h-touch items-center gap-1.5 self-start text-sm font-bold text-accent hover:underline focus-visible:underline"
          >
            <MessageText
              message={filled(message(lang, 'modelAccuracy.list.page'), {
                name: competition.name,
              })}
            />
            <Icon name="forward" size={14} />
          </Link>
        </div>
      </details>
    </li>
  );
}

/**
 * The competitions as one list (T-1750, D-370) in place of a card each: by
 * matches unless the address says `?sort=edge`, the other order one plain
 * link away. Two groups, by the coverage state the API gives: at or over the
 * sample rule, then the early records, whose bars are dashed and whose
 * heading says an early record is not a verdict; a competition with nothing
 * scored closes the second group with no figure at all.
 */
function EdgeList({
  lang,
  report,
  sort,
  period,
}: {
  lang: Locale;
  report: PublicModelAccuracyResponse;
  sort: AccuracySort;
  /** The period as the address has it, kept by the sort link; undefined when the reader chose none. */
  period: AccuracyPeriod | undefined;
}) {
  const groups = groupCompetitions(report.competitions, sort);
  const early = [...groups.early, ...groups.none];
  const minimum = formatNumber(lang, report.minimum_matches);
  const other: AccuracySort = sort === 'edge' ? 'matches' : 'edge';
  const scale = (
    // Each word in its own box: two bare strings would be one flex item, side by side.
    <span className="flex justify-between gap-3">
      <span>
        <Translated locale={lang} message="modelAccuracy.list.worse" />
      </span>
      <span>
        <Translated locale={lang} message="modelAccuracy.list.better" />
      </span>
    </span>
  );
  const heading = 'px-4 py-2 text-xs font-bold text-muted sm:px-4.5';
  return (
    <section
      aria-labelledby="accuracy-competitions-heading"
      className="flex flex-col gap-3"
      data-testid="accuracy-competitions"
      data-sort={sort}
    >
      <SectionHeading id="accuracy-competitions-heading">
        <Translated locale={lang} message="modelAccuracy.competitions.title" />
      </SectionHeading>
      <p className="max-w-measure text-sm text-muted">
        <MessageText message={filled(message(lang, 'modelAccuracy.list.lede'), { minimum })} />
      </p>
      <p
        className="flex flex-wrap items-center gap-x-2 text-xs text-muted"
        data-testid="accuracy-sort"
      >
        <Translated
          locale={lang}
          message={
            sort === 'edge'
              ? 'modelAccuracy.list.sortedByEdge'
              : 'modelAccuracy.list.sortedByMatches'
          }
        />
        <span aria-hidden="true">·</span>
        <Link
          href={accuracyHref(lang, { period, sort: other }, 'accuracy-competitions-heading')}
          className="inline-flex min-h-touch items-center font-bold text-accent hover:underline focus-visible:underline"
          data-testid="accuracy-sort-link"
        >
          <Translated
            locale={lang}
            message={
              sort === 'edge' ? 'modelAccuracy.list.sortByMatches' : 'modelAccuracy.list.sortByEdge'
            }
          />
        </Link>
      </p>
      <div className="overflow-hidden rounded-tile border border-default bg-surface">
        {/* The columns' names for the eye; each row says them again for a screen reader. */}
        <div
          aria-hidden="true"
          className={cx(ROW_GRID, 'hidden py-2 text-xs font-semibold text-caption sm:grid')}
        >
          <Translated locale={lang} message="modelAccuracy.list.competition" />
          <span className="text-end">
            <Translated locale={lang} message="modelAccuracy.table.matches" />
          </span>
          <span className="text-end">
            <Translated locale={lang} message="modelAccuracy.table.correct" />
          </span>
          {scale}
        </div>
        <div aria-hidden="true" className="px-4 py-2 text-xs font-semibold text-caption sm:hidden">
          {scale}
        </div>
        {groups.full.length > 0 && (
          <div data-testid="accuracy-group" data-group="full">
            <h3 className={cx(heading, 'border-t border-default bg-surface-raised')}>
              <Translated
                locale={lang}
                message="modelAccuracy.list.groupFull"
                count={groups.full.length}
                params={{ minimum }}
              />
            </h3>
            <ul>
              {groups.full.map((row) => (
                <EdgeRow key={row.series.competition?.id} lang={lang} row={row} report={report} />
              ))}
            </ul>
          </div>
        )}
        {early.length > 0 && (
          <div data-testid="accuracy-group" data-group="early">
            <h3
              className={cx(heading, 'border-t border-dashed border-strong bg-surface-raised')}
              data-testid="accuracy-early-heading"
            >
              <Translated
                locale={lang}
                message="modelAccuracy.list.groupEarly"
                count={early.length}
                params={{ minimum }}
              />
            </h3>
            <ul>
              {early.map((row) => (
                <EdgeRow key={row.series.competition?.id} lang={lang} row={row} report={report} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The measures
// ---------------------------------------------------------------------------

/**
 * Month or week (T-1414) as the design system's segmented control: two plain
 * links in one framed group, the current one in the selected look (the
 * saffron edge and tint of a chosen toggle) and `aria-current`, so the page
 * needs no script and each view keeps its own address. 44px targets. Inside
 * "Show all measures" since T-1750, where the table it changes is: each link
 * names its period in the address, which is what opens the measures again
 * after the page reloads, and returns to them.
 */
function PeriodSwitch({
  lang,
  period,
  sort,
}: {
  lang: Locale;
  period: AccuracyPeriod;
  sort: AccuracySort;
}) {
  const choices: { value: AccuracyPeriod; label: MessageKey }[] = [
    { value: 'month', label: 'modelAccuracy.period.month' },
    { value: 'week', label: 'modelAccuracy.period.week' },
  ];
  return (
    <nav
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm"
      aria-label={t(lang, 'modelAccuracy.period.label')}
      data-testid="accuracy-period"
    >
      <span className="text-xs font-semibold text-caption">
        <Translated locale={lang} message="modelAccuracy.period.label" />
      </span>
      <span className="inline-flex gap-1 rounded-control border border-strong bg-canvas p-1">
        {choices.map((choice) => {
          const current = choice.value === period;
          return (
            <Link
              key={choice.value}
              href={accuracyHref(lang, { period: choice.value, sort }, 'accuracy-measures')}
              aria-current={current ? 'page' : undefined}
              data-testid={`accuracy-period-${choice.value}`}
              className={cx(
                'inline-flex min-h-touch min-w-22 items-center justify-center rounded-md border-2 px-4',
                current
                  ? 'border-accent bg-brand/14 font-extrabold text-fg'
                  : 'border-transparent font-semibold text-muted hover:bg-surface-raised hover:text-fg',
              )}
            >
              <Translated locale={lang} message={choice.label} />
            </Link>
          );
        })}
      </span>
    </nav>
  );
}

/**
 * What each figure means, beside the uniform forecast (T-1369). A third-level
 * heading inside the measures; a second-level one when it stands alone on a
 * page with nothing scored, so the outline skips no level.
 */
function Explained({
  lang,
  report,
  alone = false,
}: {
  lang: Locale;
  report: PublicModelAccuracyResponse;
  alone?: boolean;
}) {
  const ref = report.reference;
  const Heading = alone ? 'h2' : 'h3';
  return (
    <section
      aria-labelledby="accuracy-explained-heading"
      className="flex flex-col gap-4"
      data-testid="accuracy-explained"
    >
      <Heading id="accuracy-explained-heading" className="text-base font-extrabold sm:text-lg">
        <Translated locale={lang} message="modelAccuracy.explain.title" />
      </Heading>
      <p className="max-w-measure text-sm">
        <Translated locale={lang} message="modelAccuracy.intro" />
      </p>
      <ul className="grid gap-x-8 gap-y-3 text-sm text-muted md:grid-cols-2">
        <li>
          <Translated locale={lang} message="modelAccuracy.explain.matches" />
        </li>
        <li>
          <MessageText
            message={filled(message(lang, 'modelAccuracy.explain.correct'), {
              guess: formatPercent(lang, ref.uniform_accuracy * 100, 0),
            })}
          />
        </li>
        <li>
          <Translated locale={lang} message="modelAccuracy.explain.rps" />
        </li>
        <li>
          <MessageText
            message={filled(message(lang, 'modelAccuracy.explain.brier'), {
              guess: formatFixed(lang, ref.uniform_brier, 3),
            })}
          />
        </li>
        <li>
          <MessageText
            message={filled(message(lang, 'modelAccuracy.explain.logLoss'), {
              guess: formatFixed(lang, ref.uniform_log_loss, 3),
            })}
          />
        </li>
        <li>
          <MessageText
            message={filled(message(lang, 'modelAccuracy.explain.threshold'), {
              minimum: formatNumber(lang, report.minimum_matches),
            })}
          />
        </li>
      </ul>
    </section>
  );
}

/**
 * "Show all measures" (T-1750, D-370): RPS, Brier and log loss, each with
 * one plain sentence, the month or week table and the long explanation,
 * under one native disclosure that is closed unless the reader chose a
 * period (the switch inside it reloads the page; the address then says to
 * open it again). Nothing here is hidden from a reader who wants it, and
 * nothing here is what the page opens with.
 */
function MeasuresDisclosure({
  lang,
  report,
  sort,
  open,
}: {
  lang: Locale;
  report: PublicModelAccuracyResponse;
  sort: AccuracySort;
  open: boolean;
}) {
  const total = report.overall.total;
  return (
    <details
      id="accuracy-measures"
      open={open}
      className="group/measures scroll-mt-4 rounded-tile border border-default bg-surface"
      data-testid="accuracy-measures"
    >
      <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-6 [&::-webkit-details-marker]:hidden">
        <Chevron className="group-open/measures:rotate-180" />
        <span className="text-lg font-extrabold font-stretch-semi-expanded">
          <Translated locale={lang} message="modelAccuracy.measures.title" />
        </span>
        <span className="text-sm text-muted">
          <Translated locale={lang} message="modelAccuracy.measures.lede" />
        </span>
      </summary>
      <div className="flex flex-col gap-6 border-t border-default p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {coverageBadge(lang, total)}
          <Standing lang={lang} metrics={total} minimum={report.minimum_matches} />
        </div>
        <KpiTiles lang={lang} total={total} reference={report.reference} />
        <PeriodSwitch lang={lang} period={report.period} sort={sort} />
        <div className="overflow-hidden rounded-tile border border-default bg-surface">
          <PeriodTable lang={lang} series={report.overall} period={report.period} />
        </div>
        <Explained lang={lang} report={report} />
      </div>
    </details>
  );
}

/**
 * The way on (T-1750): the record above is checked by the next match, so the
 * page ends on today's forecasts. The one primary, saffron button of the
 * view.
 */
function ForecastsCta({ lang }: { lang: Locale }) {
  return (
    <section
      aria-labelledby="accuracy-cta-heading"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-tile border border-default bg-surface p-4 sm:p-6"
      data-testid="accuracy-cta"
    >
      <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1.5">
        <SectionHeading id="accuracy-cta-heading">
          <Translated locale={lang} message="modelAccuracy.cta.title" />
        </SectionHeading>
        <p className="max-w-measure text-sm text-muted">
          <Translated locale={lang} message="modelAccuracy.cta.lede" />
        </p>
      </div>
      <ButtonLink
        href={`/${lang}/scores`}
        variant="primary"
        size="md"
        data-testid="accuracy-cta-link"
      >
        <Translated locale={lang} message="modelAccuracy.cta.button" />
        <Icon name="forward" size={16} />
      </ButtonLink>
    </section>
  );
}

/**
 * The published versions the figures are from and the day they were last
 * scored; a candidate still in testing is never named here. The line that
 * the figures combined the versions (T-1750) went with T-1751: each version
 * now has its own card (`VersionCards`). It sits under the verdict,
 * not in the band: on a phone the band's four extra lines pushed the page's
 * two figures off the first screen (found on the real-data screenshots).
 */
function AccuracyMeta({ lang, report }: { lang: Locale; report: PublicModelAccuracyResponse }) {
  const versions = report.overall.model_versions;
  if (versions.length === 0 && report.last_updated_at === null) return null;
  return (
    <ul
      className="flex flex-wrap gap-x-5 gap-y-1.5 px-1 text-sm text-muted"
      data-testid="accuracy-meta"
    >
      {versions.length > 0 && (
        <li data-testid="accuracy-versions">
          <FilledMessage
            message={message(lang, 'modelAccuracy.versions')}
            params={{
              versions: <VersionList versions={versions} className="font-semibold text-fg" />,
            }}
          />
        </li>
      )}
      {report.last_updated_at !== null && (
        <li data-testid="accuracy-updated">
          <MessageText
            message={filled(message(lang, 'modelAccuracy.updated'), {
              date: formatDate(lang, report.last_updated_at, 'UTC', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
            })}
          />
        </li>
      )}
    </ul>
  );
}

export function ModelAccuracy({
  locale,
  report,
  weekly,
  sort = 'matches',
  chosenPeriod = false,
}: {
  locale: string;
  report: PublicModelAccuracyResponse | null;
  /**
   * Every competition's weekly points, for the chart, whatever period the
   * tables show; null when they did not arrive. Left out, a weekly report
   * serves as its own.
   */
  weekly?: readonly PublicAccuracyPoint[] | null;
  /** The competition list's order (`?sort=edge`). */
  sort?: AccuracySort;
  /** The reader chose the period in the address: the measures open on it and the links keep it. */
  chosenPeriod?: boolean;
}) {
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (report === null) {
    return (
      <p
        className="rounded-tile border border-default bg-surface p-4 text-sm text-muted"
        data-testid="accuracy-unreachable"
      >
        <Translated locale={lang} message="modelAccuracy.unreachable" />
      </p>
    );
  }
  const total = report.overall.total;
  const state = verdictState(total);
  const points =
    weekly === undefined ? (report.period === 'week' ? report.overall.points : null) : weekly;
  const weeks = points === null ? null : weeklyEdges(points);
  return (
    <div
      className="flex flex-col gap-8 sm:gap-10"
      data-testid="model-accuracy"
      data-period={report.period}
    >
      <div className="flex flex-col gap-3">
        <VerdictCard lang={lang} report={report} weeks={weeks} />
        <AccuracyMeta lang={lang} report={report} />
      </div>

      {/* Under the sample rule there is no chart: a few matches a week are not a trend. */}
      {state === 'available' && (
        <WeeklyEdgeChart
          lang={lang}
          weeks={weeks}
          total={total}
          minimum={report.minimum_matches}
          lastScoredAt={report.last_updated_at}
        />
      )}

      {/* Under the sample rule no chart either (D-370 point 5); the calibration says when it has too few itself.
          An answer asked without it (`calibration=omit`) has none to draw. */}
      {state === 'available' && report.overall.calibration !== undefined && (
        <CalibrationChart lang={lang} calibration={report.overall.calibration} total={total} />
      )}

      {/* With one version its card would repeat the opening card; nothing scored, nothing to split. */}
      {state !== 'empty' && report.versions.length > 1 && (
        <VersionCards lang={lang} report={report} />
      )}

      {report.competitions.length > 0 && (
        <EdgeList
          lang={lang}
          report={report}
          sort={sort}
          period={chosenPeriod ? report.period : undefined}
        />
      )}

      {state === 'empty' ? (
        // Nothing scored: no measure to show, only what the measures will mean.
        <div className="rounded-tile border border-default bg-surface p-4 sm:p-6">
          <Explained lang={lang} report={report} alone />
        </div>
      ) : (
        <MeasuresDisclosure lang={lang} report={report} sort={sort} open={chosenPeriod} />
      )}

      <ForecastsCta lang={lang} />
    </div>
  );
}
