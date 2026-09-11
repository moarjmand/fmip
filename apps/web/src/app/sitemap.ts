import type { MetadataRoute } from 'next';
import { fetchCompetitions, fetchTeams } from '@/lib/api';
import { INDEXABLE_LOCALES, canonicalUrl, siteUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

const STATIC_PATHS: { path: string; priority: number }[] = [
  { path: '', priority: 1 },
  { path: '/scores', priority: 0.9 },
  { path: '/leaderboard', priority: 0.5 },
  { path: '/search', priority: 0.3 },
];

/**
 * `/sitemap.xml` (T-039): the static pages, every active competition and
 * team, under each indexable locale. Built per request from the catalog so a
 * new entity is listed without a deploy; when the API cannot be reached the
 * static pages are still listed rather than the whole map failing.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const [competitions, teams] = await Promise.all([fetchCompetitions(), fetchTeams()]);
  const entries: MetadataRoute.Sitemap = [];
  for (const locale of INDEXABLE_LOCALES) {
    for (const { path, priority } of STATIC_PATHS) {
      entries.push({
        url: canonicalUrl(locale, path, origin),
        changeFrequency: path === '/scores' ? 'hourly' : 'daily',
        priority,
      });
    }
    for (const c of competitions ?? []) {
      entries.push({
        url: canonicalUrl(locale, `/competition/${c.id}`, origin),
        changeFrequency: 'daily',
        priority: 0.8,
      });
    }
    for (const t of teams ?? []) {
      entries.push({
        url: canonicalUrl(locale, `/team/${t.id}`, origin),
        changeFrequency: 'daily',
        priority: 0.7,
      });
    }
  }
  return entries;
}
