import type { Metadata } from 'next';
import { ModelAccuracy, ModelAccuracyBand } from '@/components/model-accuracy';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';
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
 * published forecasts against the results, by month or (`?period=week`,
 * T-1414) by ISO week, overall and per competition, over
 * `GET /model/accuracy`. Linked from the forecast panel. Any other `period`
 * is the month view, the page's address without one.
 * Every figure comes with its sample and coverage state; with nothing scored
 * the page says so rather than showing a number (rule 3). The band names the
 * model, its versions and the last scoring day; the figures follow.
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
  const result = await fetchModelAccuracy(query.period === 'week' ? 'week' : 'month');
  const report = result.ok ? result.data : null;

  return (
    // The Stadiomind page (T-1620, D-291): it follows the theme like the
    // other data pages (D-274, D-276), no longer on editorial paper.
    <main data-mode="data" className="pb-16" data-testid="model-accuracy-page">
      <ModelAccuracyBand locale={lang} report={report} />
      <div className="page-frame pt-6 sm:pt-8">
        <ModelAccuracy locale={lang} report={report} />
      </div>
    </main>
  );
}
