import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { ClientMessagesProvider } from '@/components/client-messages';
import { DemonstrationBanner } from '@/components/demonstration-banner';
import { ERROR_PAGE_KEYS } from '@/components/error-page';
import { ServiceWorker } from '@/components/service-worker';
import { Translated } from '@/components/translated';
import { SiteHeader } from '@/components/site-header';
import { DEFAULT_LOCALE, LOCALES, directionOf, isLocale } from '@/i18n/locales';
import { resolveMessages, t } from '@/i18n/messages';
import {
  demonstrationTitle,
  demonstrationTitleTemplate,
  isDemonstrationData,
} from '@/lib/demonstration';
import { BRAND_COLOURS } from '@/lib/brand-colours';
import { pageMetadata, siteUrl } from '@/lib/seo';
import { readAppearance, readTheme } from '@/lib/theme-cookie';
// The site font (T-601, D-089): Vazirmatn, self-hosted. The package's
// @font-face rules point at woff2 files Next copies into its own static
// assets, one per script subset by `unicode-range`, so a page downloads only
// the scripts it shows and no request leaves the site for a font. Imported
// before globals.css, which names the family.
import '@fontsource-variable/vazirmatn';
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
      description: t(isLocale(locale) ? locale : DEFAULT_LOCALE, 'shell.meta.description'),
    }),
    // On a deployment whose football is fixture data, every page title says so
    // (T-087). A template rather than a prefix in `pageMetadata`, because nine
    // pages export a plain `metadata` object and never call that function --
    // and a template applies to whatever a child segment sets, however it set
    // it. Next.js requires a `default` alongside a template.
    ...(isDemonstrationData()
      ? {
          title: {
            template: demonstrationTitleTemplate(locale),
            default: demonstrationTitle('FMIP', locale),
          },
        }
      : {}),
    // Installability (T-082): the manifest, the icons and the iOS home-screen title.
    manifest: '/manifest.webmanifest',
    // The mark itself as the favicon where a browser draws SVG, the PNG drawn
    // from it where it does not (T-604).
    icons: {
      icon: [
        { url: '/icons/mark.svg', type: 'image/svg+xml' },
        { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      ],
      apple: '/icons/apple-touch-icon.png',
    },
    appleWebApp: { capable: true, title: 'FMIP', statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = {
  themeColor: BRAND_COLOURS.accent,
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

  // The theme this browser chose (T-602), rendered here rather than applied by
  // a script after load, so the first paint is already light or dark as
  // chosen. `system` lets tokens.css follow the device.
  const theme = await readTheme();
  // Text size, contrast and motion (T-621), the same way: `data-text-size`
  // scales the root font size every rem follows, `data-contrast` and
  // `data-motion` switch tokens.css and globals.css.
  const appearance = await readAppearance();

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      data-theme={theme}
      data-text-size={appearance.text_size}
      data-contrast={appearance.contrast}
      data-motion={appearance.motion}
    >
      <body>
        {/* First in the tab order (T-081): one key past the navigation to the content. */}
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface-raised focus:px-3 focus:py-2"
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
        <DemonstrationBanner locale={locale} />
        <SiteHeader locale={locale} theme={theme} />
        <div id="content" tabIndex={-1} className="outline-none">
          {/* The error pages below this layout are client components, and the
              catalogues stay on the server (T-1040): their words are resolved
              here, for this locale only, and handed down. */}
          <ClientMessagesProvider messages={resolveMessages(locale, ERROR_PAGE_KEYS)}>
            {children}
          </ClientMessagesProvider>
        </div>
        <ServiceWorker />
      </body>
    </html>
  );
}
