import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { LOCALES, directionOf, isLocale, isPseudoLocale } from '@/i18n/locales';
import '../globals.css';

/**
 * Every shipped locale is known at build time, so each one is rendered
 * statically rather than on demand.
 */
export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  return {
    title: 'FMIP',
    description:
      'Football match intelligence: live scores, match centre, forecasts and predictions.',
    // A pseudo-locale is a QA surface, not content. Indexing it would put
    // duplicate English text under a second URL on an SEO-dependent product.
    ...(isPseudoLocale(locale) ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // An unshipped locale is a 404, not a silent fallback to English: a URL that
  // renders content in the wrong language looks like coverage we do not have.
  if (!isLocale(locale)) {
    notFound();
  }

  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body>
        <SiteHeader locale={locale} />
        {children}
      </body>
    </html>
  );
}
