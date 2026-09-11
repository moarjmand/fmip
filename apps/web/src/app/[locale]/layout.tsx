import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { ServiceWorker } from '@/components/service-worker';
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
    // Installability (T-082): the manifest, the icons and the iOS home-screen title.
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
    appleWebApp: { capable: true, title: 'FMIP', statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = {
  themeColor: '#0b6b3a',
  width: 'device-width',
  initialScale: 1,
};

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
        {/* First in the tab order (T-081): one key past the navigation to the content. */}
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-current/10 focus:px-3 focus:py-2"
          data-testid="skip-link"
        >
          Skip to content
        </a>
        <SiteHeader locale={locale} />
        <div id="content" tabIndex={-1} className="outline-none">
          {children}
        </div>
        <ServiceWorker />
      </body>
    </html>
  );
}
