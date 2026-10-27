import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { MARK_COLOURS } from '@/lib/brand-colours';

/**
 * The web app manifest (T-082, D-042): what a phone needs to install the
 * app to its home screen. The icons live under `public/icons`
 * (`scripts/make-icons.mjs`); the maskable one is full-bleed so Android can
 * crop it to any shape.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Stadiomind',
    short_name: 'Stadiomind',
    description:
      'Football match intelligence: live scores, match centre, forecasts and predictions.',
    id: `/${DEFAULT_LOCALE}`,
    start_url: `/${DEFAULT_LOCALE}/scores`,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // The ink of the icons' tile (T-1492): the splash screen around the icon
    // and the installed app's bar, which have one colour whatever the theme.
    background_color: MARK_COLOURS.tile,
    theme_color: MARK_COLOURS.tile,
    lang: DEFAULT_LOCALE,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
