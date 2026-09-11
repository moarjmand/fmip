import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE } from '@/i18n/locales';

/**
 * The web app manifest (T-082, D-042): what a phone needs to install the
 * app to its home screen. The icons live under `public/icons`
 * (`scripts/make-icons.mjs`); the maskable one is full-bleed so Android can
 * crop it to any shape.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FMIP — Football Match Intelligence Platform',
    short_name: 'FMIP',
    description:
      'Football match intelligence: live scores, match centre, forecasts and predictions.',
    id: `/${DEFAULT_LOCALE}`,
    start_url: `/${DEFAULT_LOCALE}/scores`,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b6b3a',
    theme_color: '#0b6b3a',
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
