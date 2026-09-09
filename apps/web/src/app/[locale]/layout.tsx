import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LOCALES, directionOf, isLocale } from '@/i18n/locales';
import '../globals.css';

export const metadata: Metadata = {
  title: 'FMIP',
  description: 'Football match intelligence: live scores, match centre, forecasts and predictions.',
};

/**
 * Every shipped locale is known at build time, so each one is rendered
 * statically rather than on demand.
 */
export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }));
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
      <body>{children}</body>
    </html>
  );
}
