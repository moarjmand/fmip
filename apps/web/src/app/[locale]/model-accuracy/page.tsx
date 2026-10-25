import type { Metadata } from 'next';
import { ModelAccuracy } from '@/components/model-accuracy';
import { Translated } from '@/components/translated';
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
 * the page says so rather than showing a number (rule 3).
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

  return (
    // Editorial mode (T-1383, D-201): paper whatever the theme, the serif
    // display, the introduction at the article measure, the tables beside.
    <main data-mode="editorial" className="bg-canvas text-fg">
      <div className="page-frame flex flex-col gap-8 py-8 md:py-10">
        <header className="flex max-w-measure flex-col gap-3">
          <p className="text-xs font-bold tracking-widest text-model uppercase">
            <Translated locale={lang} message="lanes.model.title" />
          </p>
          <h1
            className="font-serif text-display-2 font-semibold md:text-display-4"
            data-testid="title"
          >
            <Translated locale={lang} message="modelAccuracy.meta.title" />
          </h1>
          <p className="font-article text-article text-muted">
            <Translated locale={lang} message="modelAccuracy.intro" />
          </p>
        </header>
        <div className="max-w-4xl">
          <ModelAccuracy locale={lang} report={result.ok ? result.data : null} />
        </div>
      </div>
    </main>
  );
}
