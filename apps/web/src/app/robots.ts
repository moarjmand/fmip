import type { MetadataRoute } from 'next';
import { PSEUDO_LOCALES } from '@/i18n/locales';
import { isDemonstrationData } from '@/lib/demonstration';
import { INDEXABLE_LOCALES, siteUrl } from '@/lib/seo';

// Read per request, not at build time: the variable reaches the container at
// runtime, and a robots.txt baked during the build would say "crawl this" about
// a database that had not been loaded yet (T-087).
export const dynamic = 'force-dynamic';

/**
 * Crawlers asked to wait between requests (T-1451, D-240). On
 * 2026-10-21 ClaudeBot sent 2,134 of the 2,534 requests the origin took in
 * thirty minutes, Reflectionbot 312: about 97 % of the load on a two-core
 * server, every one a full render of a dynamic page. They stay welcome --
 * throttled, not refused. Anthropic documents that its crawler honours
 * `Crawl-delay`; CCBot is the other large training crawler; a crawler that
 * ignores the field is the Cloudflare rule's business, not this file's. Search engines are not listed:
 * Google ignores the field, and slowing Bing would slow indexing for nothing.
 */
export const THROTTLED_CRAWLERS = ['ClaudeBot', 'CCBot', 'Reflectionbot'] as const;

/** Ten seconds: at most six pages a minute from each, against seventy measured. */
export const CRAWL_DELAY_SECONDS = 10;

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
    rules: [
      { userAgent: '*', allow: '/', disallow },
      // A crawler obeys its own group alone, so the throttled ones repeat the
      // disallow list beside their delay.
      { userAgent: [...THROTTLED_CRAWLERS], allow: '/', disallow, crawlDelay: CRAWL_DELAY_SECONDS },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
