import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchSearch } from '@/lib/api';
import {
  MIN_QUERY_LENGTH,
  TYPE_LABEL,
  apiQuery,
  matchNote,
  readSearchTerm,
  resultHref,
} from '@/lib/search';
import { pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  // The empty form is a page; a result list is not, so it is never indexed.
  return pageMetadata({
    locale,
    path: '/search',
    title: 'Search · FMIP',
    description: 'Find teams, competitions and players by name, alias or another spelling.',
    index: readSearchTerm(query) === '',
  });
}

/**
 * Entity search (T-038): teams, competitions and players by name or alias,
 * from `GET /search`. The form is a plain GET so the URL is the state; an
 * unreachable API is said out loud, never shown as "no results".
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const term = readSearchTerm(query);
  const ask = apiQuery(term);
  const result = ask === null ? null : await fetchSearch(ask);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        Search
      </h1>

      <form action={`/${locale}/search`} method="get" className="flex gap-2" role="search">
        <label htmlFor="search-term" className="sr-only">
          Team, competition or player
        </label>
        <input
          id="search-term"
          name="q"
          type="search"
          defaultValue={term}
          placeholder="Team, competition or player"
          autoComplete="off"
          className="grow rounded border border-current/30 bg-transparent px-3 py-2"
          data-testid="search-input"
        />
        <button type="submit" className="rounded border border-current/30 px-3 py-2">
          Search
        </button>
      </form>

      {ask === null ? (
        <p className="text-sm opacity-70" data-testid="search-hint">
          {term === ''
            ? 'Type a name, an abbreviation or a spelling in another language.'
            : `Type at least ${MIN_QUERY_LENGTH} characters.`}
        </p>
      ) : result === null || !result.ok ? (
        <p role="alert" data-testid="search-unreachable">
          The service is unreachable right now, so nothing can be searched.
        </p>
      ) : result.data.results.length === 0 ? (
        <p data-testid="search-empty">Nothing matches “{term}”.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-current/10" data-testid="search-results">
          {result.data.results.map((hit) => (
            <li
              key={`${hit.type}-${hit.id}`}
              className="flex flex-wrap items-baseline gap-x-3 py-2"
              data-testid="search-result"
            >
              <span className="w-24 text-xs uppercase opacity-60">{TYPE_LABEL[hit.type]}</span>
              <Link href={resultHref(locale, hit)} className="font-medium underline">
                {hit.name}
              </Link>
              {hit.secondary !== null && (
                <span className="text-sm opacity-70">{hit.secondary}</span>
              )}
              {matchNote(hit) !== null && (
                <span className="text-xs opacity-60" data-testid="search-alias">
                  {matchNote(hit)}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
