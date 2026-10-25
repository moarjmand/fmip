import type {
  AccuracyMetrics,
  AccuracyPeriod,
  AccuracyPoint,
  PublicAccuracySeries,
  PublicModelAccuracyResponse,
} from '@fmip/contracts';
import { useId } from 'react';
import Link from '@/components/ui/link';
import { MessageText } from '@/components/message-text';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
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

/**
 * Month or week (T-1414): two plain links, the current one marked, so the
 * page needs no script and each view has its own address.
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
      className="flex flex-wrap items-center gap-2 text-sm"
      aria-label={t(lang, 'modelAccuracy.period.label')}
      data-testid="accuracy-period"
    >
      <span className="text-muted">
        <Translated locale={lang} message="modelAccuracy.period.label" />
      </span>
      {choices.map((choice) => (
        <Link
          key={choice.value}
          href={choice.href}
          aria-current={choice.value === period ? 'page' : undefined}
          className={`inline-flex min-h-touch items-center border px-3 ${
            choice.value === period ? 'border-fg font-bold' : 'border-default text-accent'
          }`}
        >
          <Translated locale={lang} message={choice.label} />
        </Link>
      ))}
    </nav>
  );
}

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
    <p className="text-sm" data-testid={`accuracy-${metrics.coverage}`}>
      <MessageText message={text} />
    </p>
  );
}

function Cells({ lang, metrics }: { lang: Locale; metrics: AccuracyMetrics }) {
  const cell = 'py-1 pe-3 text-end tabular-nums';
  const fixed = (value: number | null) => (value === null ? '—' : formatFixed(lang, value, 3));
  return (
    <>
      <td className={cell}>{formatNumber(lang, metrics.matches)}</td>
      <td className={cell}>
        {metrics.accuracy === null ? '—' : formatPercent(lang, metrics.accuracy * 100)}
      </td>
      <td className={cell}>{fixed(metrics.rps)}</td>
      <td className={cell}>{fixed(metrics.uniform_rps)}</td>
      <td className={cell}>{fixed(metrics.brier)}</td>
      <td className={cell}>{fixed(metrics.log_loss)}</td>
      <td className="py-1 text-start text-muted">
        <Translated locale={lang} message={COVERAGE_KEY[metrics.coverage]} />
      </td>
    </>
  );
}

function SeriesBlock({
  lang,
  series,
  minimum,
  period,
}: {
  lang: Locale;
  series: PublicAccuracySeries;
  minimum: number;
  period: AccuracyPeriod;
}) {
  const weekly = period === 'week';
  const head = 'py-1 pe-3 text-end font-semibold';
  const captionId = useId();
  return (
    <div className="flex flex-col gap-2" data-coverage={series.total.coverage}>
      <Standing lang={lang} metrics={series.total} minimum={minimum} />
      {series.total.coverage !== 'not_supplied' && (
        <>
          {/*
            The table scrolls sideways on a phone, so its box is a named region
            a keyboard can reach and scroll (axe `scrollable-region-focusable`,
            T-1571), as the player's career table is.
          */}
          <div
            className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-focus"
            role="region"
            aria-labelledby={captionId}
            tabIndex={0}
            data-testid="accuracy-months-scroll"
          >
            <table className="w-full text-start text-sm" data-testid="accuracy-months">
              <caption id={captionId} className="pb-2 text-start text-muted">
                <Translated
                  locale={lang}
                  message={
                    weekly ? 'modelAccuracy.table.captionWeek' : 'modelAccuracy.table.caption'
                  }
                />
              </caption>
              <thead>
                <tr className="border-b border-default">
                  <th scope="col" className="py-1 pe-3 text-start font-semibold">
                    <Translated
                      locale={lang}
                      message={weekly ? 'modelAccuracy.table.week' : 'modelAccuracy.table.month'}
                    />
                  </th>
                  <th scope="col" className={head}>
                    <Translated locale={lang} message="modelAccuracy.table.matches" />
                  </th>
                  <th scope="col" className={head}>
                    <Translated locale={lang} message="modelAccuracy.table.correct" />
                  </th>
                  <th scope="col" className={head}>
                    <Translated locale={lang} message="modelAccuracy.table.rps" />
                  </th>
                  <th scope="col" className={head}>
                    <Translated locale={lang} message="modelAccuracy.table.rpsGuess" />
                  </th>
                  <th scope="col" className={head}>
                    <Translated locale={lang} message="modelAccuracy.table.brier" />
                  </th>
                  <th scope="col" className={head}>
                    <Translated locale={lang} message="modelAccuracy.table.logLoss" />
                  </th>
                  <th scope="col" className="py-1 text-start font-semibold">
                    <Translated locale={lang} message="modelAccuracy.table.coverage" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {series.points.map((point) => (
                  <tr
                    key={point.period}
                    className="border-b border-default"
                    data-testid="accuracy-month"
                    data-coverage={point.coverage}
                  >
                    <th scope="row" className="py-1 pe-3 text-start font-normal">
                      <time dateTime={weekly ? point.period_start : point.period}>
                        {periodName(lang, point, period)}
                      </time>
                    </th>
                    <Cells lang={lang} metrics={point} />
                  </tr>
                ))}
                <tr className="font-semibold" data-testid="accuracy-all-months">
                  <th scope="row" className="py-1 pe-3 text-start">
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
          <p className="text-xs text-muted">
            <MessageText
              message={filled(message(lang, 'modelAccuracy.versions'), {
                versions: series.model_versions.join(', '),
              })}
            />
          </p>
        </>
      )}
    </div>
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
      <p className="text-sm text-muted" data-testid="accuracy-unreachable">
        <Translated locale={lang} message="modelAccuracy.unreachable" />
      </p>
    );
  }
  const minimum = report.minimum_matches;
  const ref = report.reference;
  const period = report.period;
  return (
    <div className="flex flex-col gap-6" data-testid="model-accuracy" data-period={period}>
      <PeriodSwitch lang={lang} period={period} />
      <section className="flex flex-col gap-2" data-testid="accuracy-overall">
        <h2 className="border-t-2 border-fg pt-2.5 font-serif text-2xl font-semibold">
          <Translated locale={lang} message="modelAccuracy.overall.title" />
        </h2>
        <SeriesBlock lang={lang} series={report.overall} minimum={minimum} period={period} />
        {report.last_updated_at !== null && (
          <p className="text-xs text-muted">
            <MessageText
              message={filled(message(lang, 'modelAccuracy.updated'), {
                date: formatDate(lang, report.last_updated_at, 'UTC', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                }),
              })}
            />
          </p>
        )}
      </section>

      {report.competitions.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="border-t-2 border-fg pt-2.5 font-serif text-2xl font-semibold">
            <Translated locale={lang} message="modelAccuracy.competitions.title" />
          </h2>
          {report.competitions.map((series) => (
            <section
              key={series.competition?.id}
              className="flex flex-col gap-2"
              data-testid="accuracy-competition"
            >
              <h3 className="font-serif text-xl font-semibold">{series.competition?.name}</h3>
              <SeriesBlock lang={lang} series={series} minimum={minimum} period={period} />
            </section>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2" data-testid="accuracy-explained">
        <h2 className="border-t-2 border-fg pt-2.5 font-serif text-2xl font-semibold">
          <Translated locale={lang} message="modelAccuracy.explain.title" />
        </h2>
        <ul className="flex list-disc flex-col gap-2 ps-6 text-sm">
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
                minimum: formatNumber(lang, minimum),
              })}
            />
          </li>
        </ul>
      </section>
    </div>
  );
}
