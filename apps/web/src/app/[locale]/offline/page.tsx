import type { Metadata } from 'next';
import Link from 'next/link';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: `${t(isLocale(locale) ? locale : DEFAULT_LOCALE, 'offline.title')} · FMIP`,
    robots: { index: false, follow: false },
  };
}

/**
 * The offline shell (T-082, D-042): what the service worker shows when a
 * page cannot be fetched. It says so; it never shows a cached score as if
 * it were current (rule 4).
 */
export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={locale} message="offline.title" />
      </h1>
      <p role="status" data-testid="offline-message">
        <Translated locale={locale} message="offline.body" />
      </p>
      <p>
        <Link href={`/${locale}/scores`} className="underline">
          <Translated locale={locale} message="offline.retry" />
        </Link>
      </p>
    </main>
  );
}
