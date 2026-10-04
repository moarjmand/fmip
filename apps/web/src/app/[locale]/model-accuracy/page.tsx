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
    title: `${t(lang, 'modelAccuracy.meta.title')} · FMIP`,
    description: t(lang, 'modelAccuracy.meta.description'),
  });
}

/**
 * "How accurate is our model?" (T-1369, D-187): the statistical model's
 * published forecasts against the results, by month, overall and per
 * competition, over `GET /model/accuracy`. Linked from the forecast panel.
 * Every figure comes with its sample and coverage state; with nothing scored
 * the page says so rather than showing a number (rule 3).
 */
export default async function ModelAccuracyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const result = await fetchModelAccuracy();

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={lang} message="modelAccuracy.meta.title" />
      </h1>
      <p>
        <Translated locale={lang} message="modelAccuracy.intro" />
      </p>
      <ModelAccuracy locale={lang} report={result.ok ? result.data : null} />
    </main>
  );
}
