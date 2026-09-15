import type { MetadataRoute } from 'next';
import { PSEUDO_LOCALES } from '@/i18n/locales';
import { isDemonstrationData } from '@/lib/demonstration';
import { INDEXABLE_LOCALES, siteUrl } from '@/lib/seo';

// Read per request, not at build time: the variable reaches the container at
// runtime, and a robots.txt baked during the build would say "crawl this" about
// a database that had not been loaded yet (T-087).
export const dynamic = 'force-dynamic';

/**
 * `/robots.txt` (T-039). Everything public is crawlable; the pseudo-locale,
 * the web app's own API routes and a member's own pages are not.
 *
 * **Unless the football here is demonstration data** (T-087), in which case
 * nothing is. The page-level `noindex` is the instruction a crawler obeys once
 * it has fetched a page; this is the one that stops it fetching. Both, because
 * an invented score in a search index outlives the deployment that produced it,
 * and no sitemap either — offering a map of matches that never happened is the
 * same claim made twice.
 */
export default function robots(): MetadataRoute.Robots {
  if (isDemonstrationData()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
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
