import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { LOCALES, directionOf, isLocale } from '@/i18n/locales';
import { pageMetadata, siteUrl } from '@/lib/seo';
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

  // A pseudo-locale is a QA surface, not content: `pageMetadata` never
  // indexes it, so duplicate English text never sits under a second URL on an
  // SEO-dependent product. Pages below override title, path and description.
  return {
    metadataBase: new URL(siteUrl()),
    ...pageMetadata({
      locale,
      path: '',
      title: 'FMIP',
      description:
        'Football match intelligence: live scores, match centre, forecasts and predictions.',
    }),
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
