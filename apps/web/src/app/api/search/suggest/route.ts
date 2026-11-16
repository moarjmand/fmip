import { isLocale } from '@/i18n/locales';
import { fetchSearch } from '@/lib/api';
import { buildSuggestions, suggestApiQuery, suggestTerm } from '@/lib/search-suggest';

export const dynamic = 'force-dynamic';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

/**
 * The suggestions a search field shows while a reader types (T-1844, D-435):
 * `GET /api/search/suggest?q=&locale=`. Public and the same for every reader
 * (no cookie is read or forwarded, so no block or session can change it): at
 * most six teams, competitions and players, with their links and words
 * already in the reader's language.
 *
 * Its reach is bounded by what it takes: a term of 2 to 64 characters, one of
 * our locales, three fixed kinds and a fixed limit, each a single indexed
 * query of `GET /search` (T-1842, tens of milliseconds). An answer may be
 * kept for a minute; anything but a 200 is never kept.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const term = suggestTerm(params.get('q'));
  const locale = params.get('locale') ?? '';
  if (term === null || !isLocale(locale)) {
    return new Response(JSON.stringify({ error: 'validation' }), {
      status: 400,
      headers: { ...JSON_HEADERS, 'cache-control': 'no-store' },
    });
  }
  const found = await fetchSearch(suggestApiQuery(term, locale));
  if (!found.ok) {
    // Said as unavailable in the list, never drawn as "no suggestions" (rule 3).
    return new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: { ...JSON_HEADERS, 'cache-control': 'no-store' },
    });
  }
  return new Response(JSON.stringify(buildSuggestions(locale, term, found.data)), {
    status: 200,
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=60, s-maxage=60' },
  });
}
