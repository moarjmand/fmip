import type { Metadata } from 'next';
import { ModelAccuracy, ModelAccuracyBand } from '@/components/model-accuracy';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';
import { accuracySort } from '@/lib/accuracy-edge';
import { fetchModelAccuracy } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/model-accuracy',
    title: `${t(lang, 'modelAccuracy.meta.title')} · Stadiomind`,
    description: t(lang, 'modelAccuracy.meta.description'),
  });
}

/**
 * "How accurate is our model?" (T-1369, D-187): the statistical model's
 * published forecasts against the results, overall and per competition, over
 * `GET /model/accuracy`. Linked from the forecast panel.
 *
 * The page opens with two plain facts and a weekly chart (T-1750, D-370);
 * the tables are under "Show all measures", by month or (`?period=week`,
 * T-1414) by ISO week. Any other `period` is the month view, and a period in
 * the address is the reader's own choice, which opens the measures on it.
 * `?sort=edge` orders the competitions by their edge over a guess instead of
 * by matches. Every choice is a plain link: no script.
 *
 * The weekly chart needs the weekly points whatever the tables show, so the
 * month view asks the API twice, in parallel (months for the tables, weeks
 * for the chart); the week view's one answer serves both. If only the weekly
 * answer fails, the chart's place says so and the rest of the page stands.
 *
 * Every figure comes with its sample and coverage state; with nothing scored
 * the page says so rather than showing a number (rule 3). The band names the
 * model; the versions and the last scoring day sit under the opening card.
 */
export default async function ModelAccuracyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const period = query.period === 'week' ? 'week' : 'month';
  const [result, weeks] = await Promise.all([
    fetchModelAccuracy(period),
    // The weekly chart needs the points only: the calibration, which does not
    // depend on the period, comes with the first answer (T-1751).
    period === 'week' ? null : fetchModelAccuracy('week', { calibration: false }),
  ]);
  const report = result.ok ? result.data : null;
  // A weekly report is its own chart; beside a monthly one, the second answer or nothing.
  const weekly =
    report === null
      ? null
      : weeks === null
        ? report.overall.points
        : weeks.ok
          ? weeks.data.overall.points
          : null;

  return (
    // The Stadiomind page (T-1620, D-291): it follows the theme like the
    // other data pages (D-274, D-276), no longer on editorial paper.
    <main data-mode="data" className="pb-16" data-testid="model-accuracy-page">
      <ModelAccuracyBand locale={lang} />
      <div className="page-frame pt-6 sm:pt-8">
        <ModelAccuracy
          locale={lang}
          report={report}
          weekly={weekly}
          sort={accuracySort(query.sort)}
          chosenPeriod={query.period === 'week' || query.period === 'month'}
        />
      </div>
    </main>
  );
}
