import type {
  AccuracyMetrics,
  PublicAccuracySeries,
  PublicModelAccuracyResponse,
} from '@fmip/contracts';
import { MessageText } from '@/components/message-text';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { formatDate, formatGregorianMonth, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type Message, interpolate, message, plural } from '@/i18n/messages';
import { formatFixed, formatPercent } from '@/lib/words';

/**
 * "How accurate is our model?" (T-1369, D-187): the statistical model's
 * published pre-kick-off forecasts, scored after the match, by month, over
 * every competition and each one. Only the model: the founder's analysis
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
}: {
  lang: Locale;
  series: PublicAccuracySeries;
  minimum: number;
}) {
  const head = 'py-1 pe-3 text-end font-semibold';
  return (
    <div className="flex flex-col gap-2" data-coverage={series.total.coverage}>
      <Standing lang={lang} metrics={series.total} minimum={minimum} />
      {series.total.coverage !== 'not_supplied' && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm" data-testid="accuracy-months">
              <caption className="pb-2 text-start text-muted">
                <Translated locale={lang} message="modelAccuracy.table.caption" />
              </caption>
              <thead>
                <tr className="border-b border-default">
                  <th scope="col" className="py-1 pe-3 text-start font-semibold">
                    <Translated locale={lang} message="modelAccuracy.table.month" />
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
                      <time dateTime={point.period}>
                        {formatGregorianMonth(lang, point.period)}
                      </time>
                    </th>
                    <Cells lang={lang} metrics={point} />
                  </tr>
                ))}
                <tr className="font-semibold" data-testid="accuracy-all-months">
                  <th scope="row" className="py-1 pe-3 text-start">
                    <Translated locale={lang} message="modelAccuracy.table.all" />
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
  return (
    <div className="flex flex-col gap-6" data-testid="model-accuracy">
      <section className="flex flex-col gap-2" data-testid="accuracy-overall">
        <h2 className="text-lg font-semibold">
          <Translated locale={lang} message="modelAccuracy.overall.title" />
        </h2>
        <SeriesBlock lang={lang} series={report.overall} minimum={minimum} />
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
          <h2 className="text-lg font-semibold">
            <Translated locale={lang} message="modelAccuracy.competitions.title" />
          </h2>
          {report.competitions.map((series) => (
            <section
              key={series.competition?.id}
              className="flex flex-col gap-2"
              data-testid="accuracy-competition"
            >
              <h3 className="font-semibold">{series.competition?.name}</h3>
              <SeriesBlock lang={lang} series={series} minimum={minimum} />
            </section>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2" data-testid="accuracy-explained">
        <h2 className="text-lg font-semibold">
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
