import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { DemonstrationBanner } from '@/components/demonstration-banner';
import { ServiceWorker } from '@/components/service-worker';
import { Translated } from '@/components/translated';
import { SiteHeader } from '@/components/site-header';
import { LOCALES, directionOf, isLocale } from '@/i18n/locales';
import {
  DEMONSTRATION_TITLE_PREFIX,
  DEMONSTRATION_TITLE_TEMPLATE,
  isDemonstrationData,
} from '@/lib/demonstration';
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
    // On a deployment whose football is fixture data, every page title says so
    // (T-087). A template rather than a prefix in `pageMetadata`, because nine
    // pages export a plain `metadata` object and never call that function --
    // and a template applies to whatever a child segment sets, however it set
    // it. Next.js requires a `default` alongside a template.
    ...(isDemonstrationData()
      ? {
          title: {
            template: DEMONSTRATION_TITLE_TEMPLATE,
            default: `${DEMONSTRATION_TITLE_PREFIX}FMIP`,
          },
        }
      : {}),
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
          {/* Through `Translated` like every other label: on `/es` this is
              English and says so, rather than being English and silent. It was
              the one string in the catalogue with nowhere calling it. */}
          <Translated locale={locale} message="nav.skipToContent" />
        </a>
        {/* Above the header, on every page, and never dismissible: when this
            deployment's football is fixture data, a reader meets that fact
            before they meet a score (T-087). */}
        <DemonstrationBanner />
        <SiteHeader locale={locale} />
        <div id="content" tabIndex={-1} className="outline-none">
          {children}
        </div>
        <ServiceWorker />
      </body>
    </html>
  );
}
