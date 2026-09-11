import type { MetadataRoute } from 'next';
import { PSEUDO_LOCALES } from '@/i18n/locales';
import { INDEXABLE_LOCALES, siteUrl } from '@/lib/seo';

/**
 * `/robots.txt` (T-039). Everything public is crawlable; the pseudo-locale,
 * the web app's own API routes and a member's own pages are not.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [
    '/api/',
    ...PSEUDO_LOCALES.map((l) => `/${l}/`),
    ...INDEXABLE_LOCALES.flatMap((l) => [`/${l}/settings`, `/${l}/login`, `/${l}/register`]),
  ];
  return {
    rules: [{ userAgent: '*', allow: '/', disallow }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
