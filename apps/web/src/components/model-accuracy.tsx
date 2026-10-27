import type {
  AccuracyMetrics,
  AccuracyPeriod,
  AccuracyPoint,
  AccuracyReference,
  PublicAccuracySeries,
  PublicModelAccuracyResponse,
} from '@fmip/contracts';
import type { ReactNode } from 'react';
import { Fragment, useId } from 'react';
import Link from '@/components/ui/link';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { ModelVersion } from '@/components/model-version';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { formatDate, formatGregorianMonth, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type Message, type MessageKey, interpolate, message, plural, t } from '@/i18n/messages';
import { formatFixed, formatPercent } from '@/lib/words';

/**
 * "How accurate is our model?" (T-1369, D-187): the statistical model's
 * published pre-kick-off forecasts, scored after the match, by month or by
 * ISO week (T-1414), over every competition and each one. Only the model: the founder's analysis
 * and the community's consensus are other products, named here only to say
 * they are not counted (rule 6). A row with no match scored shows no figure
 * and says so; one below the minimum shows its figures marked limited with
 * the count beside them (rule 3). In this file rather than a shared table,
 * like every product's own components.
 *
 * The Stadiomind page (T-1620, D-291): it follows the theme like the other
 * data pages. A band on the surface names the model, its versions and the
 * last scoring day, with the month/week switch as a segmented control; the
 * totals are tiles, each with its plain meaning and what a blind guess
 * scores beside it; the table is the design system's; each competition is a
 * card with its logo, its figures, its coverage badge and its months under a
 * disclosure. The interface face throughout: the serif is the founder's
 * voice (D-263), never the model's. Server components only.
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

// ---------------------------------------------------------------------------
// The band
// ---------------------------------------------------------------------------

/**
 * Month or week (T-1414) as the design system's segmented control: two plain
 * links in one framed group, the current one in the selected look (the
 * saffron edge and tint of a chosen toggle) and `aria-current`, so the page
 * needs no script and each view keeps its own address. 44px targets.
 */
function PeriodSwitch({ lang, period }: { lang: Locale; period: AccuracyPeriod }) {
  const choices: { value: AccuracyPeriod; href: string; label: MessageKey }[] = [
    { value: 'month', href: `/${lang}/model-accuracy`, label: 'modelAccuracy.period.month' },
    {
      value: 'week',
      href: `/${lang}/model-accuracy?period=week`,
      label: 'modelAccuracy.period.week',
    },
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
              href={choice.href}
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
 * The page's band (T-1620): the model's lane and the question on the
 * surface, the one line that this is the statistical model and nothing else
 * (rule 6), the published versions the figures are from and the day they
 * were last scored, and the switch. Without an answer from the API only the
 * name and the line: no version and no date is guessed.
 */
export function ModelAccuracyBand({
  locale,
  report,
}: {
  locale: string;
  report: PublicModelAccuracyResponse | null;
}) {
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const versions = report?.overall.model_versions ?? [];
  return (
    <header className="border-b border-default bg-surface" data-testid="accuracy-band">
      <div className="page-frame flex flex-col gap-4 py-6 sm:gap-5 sm:py-9">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
          <div className="flex min-w-0 flex-[1_1_24rem] flex-col gap-2.5">
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
          {report !== null && <PeriodSwitch lang={lang} period={report.period} />}
        </div>
        {report !== null && (versions.length > 0 || report.last_updated_at !== null) && (
          <ul
            className="flex flex-wrap gap-x-5 gap-y-2 border-t border-default pt-4 text-sm text-muted"
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
        )}
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
      meaning: 'modelAccuracy.kpi.rpsMeaning',
    },
    {
      key: 'brier',
      label: 'modelAccuracy.table.brier',
      value: fixed(lang, total.brier),
      guess: formatFixed(lang, ref.uniform_brier, 3),
      lower: true,
      meaning: 'modelAccuracy.kpi.brierMeaning',
    },
    {
      key: 'log-loss',
      label: 'modelAccuracy.table.logLoss',
      value: fixed(lang, total.log_loss),
      guess: formatFixed(lang, ref.uniform_log_loss, 3),
      lower: true,
      meaning: 'modelAccuracy.kpi.logLossMeaning',
    },
  ];
}

/**
 * Every competition's totals as five tiles (T-1620): the figure large, what a
 * blind guess scores beside it, "lower is better" on the three error scores
 * and one plain line of what it means. The model's turquoise only as the
 * tiles' top edge, as on the product lanes (D-263).
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
// The sections
// ---------------------------------------------------------------------------

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-lg font-extrabold font-stretch-semi-expanded sm:text-xl">
      {children}
    </h2>
  );
}

/** Every competition together: the standing, the tiles and the table. */
function Overall({ lang, report }: { lang: Locale; report: PublicModelAccuracyResponse }) {
  const total = report.overall.total;
  return (
    <section
      aria-labelledby="accuracy-overall-heading"
      className="flex flex-col gap-4"
      data-testid="accuracy-overall"
      data-coverage={total.coverage}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionHeading id="accuracy-overall-heading">
          <Translated locale={lang} message="modelAccuracy.overall.title" />
        </SectionHeading>
        {coverageBadge(lang, total)}
      </div>
      <Standing lang={lang} metrics={total} minimum={report.minimum_matches} />
      {total.coverage !== 'not_supplied' && (
        <>
          <KpiTiles lang={lang} total={total} reference={report.reference} />
          <div className="overflow-hidden rounded-tile border border-default bg-surface">
            <PeriodTable lang={lang} series={report.overall} period={report.period} />
          </div>
        </>
      )}
    </section>
  );
}

/** One figure in a competition's card: small, beside the others. */
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
 * One competition (T-1620): its logo on the white tile (D-280; the lettered
 * mark when none is held, rule 3) and its name linking to its page, the
 * coverage badge, its five figures, the early-record note below the
 * minimum, and its months or weeks under a disclosure that works without
 * script. Nothing scored: the sentence and no figure.
 */
function CompetitionCard({
  lang,
  series,
  report,
}: {
  lang: Locale;
  series: PublicAccuracySeries;
  report: PublicModelAccuracyResponse;
}) {
  const competition = series.competition;
  if (competition === null) return null;
  const total = series.total;
  const headingId = `accuracy-competition-${competition.id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col overflow-hidden rounded-tile border border-default bg-surface"
      data-testid="accuracy-competition"
      data-coverage={total.coverage}
    >
      <div className="flex items-center gap-3 border-b border-default px-4 py-2 sm:px-4.5">
        <EntityImage media={competition.logo} kind="logo" name={competition.name} size={40} />
        <h3 id={headingId} className="min-w-0 flex-1 font-extrabold">
          <Link
            href={`/${lang}/competition/${encodeURIComponent(competition.id)}`}
            className="inline-flex min-h-touch items-center break-words hover:underline focus-visible:underline"
          >
            {competition.name}
          </Link>
        </h3>
        {coverageBadge(lang, total)}
      </div>
      <div className="flex flex-col gap-3 p-4 sm:px-4.5">
        {total.coverage !== 'not_supplied' && (
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
        )}
        <Standing lang={lang} metrics={total} minimum={report.minimum_matches} />
      </div>
      {total.coverage !== 'not_supplied' && (
        <details className="group mt-auto border-t border-default">
          <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 px-4 text-sm font-bold text-accent hover:underline sm:px-4.5 [&::-webkit-details-marker]:hidden">
            <Translated
              locale={lang}
              message={
                report.period === 'week'
                  ? 'modelAccuracy.competition.weeks'
                  : 'modelAccuracy.competition.months'
              }
            />
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
          <PeriodTable lang={lang} series={series} period={report.period} />
          <div className="border-t border-default px-4 py-3 sm:px-4.5">
            <Versions lang={lang} versions={series.model_versions} />
          </div>
        </details>
      )}
    </section>
  );
}

/** What each figure means, beside the uniform forecast (T-1369). */
function Explained({ lang, report }: { lang: Locale; report: PublicModelAccuracyResponse }) {
  const ref = report.reference;
  return (
    <section
      aria-labelledby="accuracy-explained-heading"
      className="flex flex-col gap-4 rounded-tile border border-default bg-surface p-4 sm:p-6"
      data-testid="accuracy-explained"
    >
      <SectionHeading id="accuracy-explained-heading">
        <Translated locale={lang} message="modelAccuracy.explain.title" />
      </SectionHeading>
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

export function ModelAccuracy({
  locale,
  report,
}: {
  locale: string;
  report: PublicModelAccuracyResponse | null;
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
  return (
    <div className="flex flex-col gap-10" data-testid="model-accuracy" data-period={report.period}>
      <Overall lang={lang} report={report} />

      {report.competitions.length > 0 && (
        <section
          aria-labelledby="accuracy-competitions-heading"
          className="flex flex-col gap-4"
          data-testid="accuracy-competitions"
        >
          <SectionHeading id="accuracy-competitions-heading">
            <Translated locale={lang} message="modelAccuracy.competitions.title" />
          </SectionHeading>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {report.competitions.map((series) => (
              <CompetitionCard
                key={series.competition?.id}
                lang={lang}
                series={series}
                report={report}
              />
            ))}
          </div>
        </section>
      )}

      <Explained lang={lang} report={report} />
    </div>
  );
}
