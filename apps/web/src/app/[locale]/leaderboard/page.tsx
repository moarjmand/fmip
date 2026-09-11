import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchLeaderboard } from '@/lib/api';
import {
  apiQuery,
  pageCount,
  pageHref,
  ratingLabel,
  readLeaderboardQuery,
  statusLabel,
  tierLabel,
} from '@/lib/leaderboard';
import { pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/leaderboard',
    title: 'Leaderboard · FMIP',
    description: 'Members ranked by Performance Rating, behind a minimum-sample filter.',
  });
}

/**
 * The leaderboard (blueprint 9.3, T-055): members ranked by their current
 * Performance Rating behind a minimum-sample filter, so a member with one
 * lucky result never ranks above established performers. The filter's floor
 * and presets come from the API, not from this page; an unreachable API is
 * said out loud rather than shown as an empty board.
 */
export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const q = readLeaderboardQuery(query);
  const result = await fetchLeaderboard(apiQuery(q));
  const linkClass = (active: boolean): string =>
    `rounded px-2 py-1 ${active ? 'bg-current/10 font-semibold' : 'underline'}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        Leaderboard
      </h1>

      {!result.ok ? (
        result.status === 400 ? (
          <p role="alert" data-testid="leaderboard-invalid">
            That filter is not one the board accepts.{' '}
            <Link href={pageHref(locale, q, { min: null, page: 1 })} className="underline">
              Show the default board
            </Link>
            .
          </p>
        ) : (
          <p role="alert" data-testid="leaderboard-unreachable">
            The service is unreachable right now, so the leaderboard cannot be shown.
          </p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="min-sample">
            <span className="opacity-70">Minimum settled predictions:</span>
            {result.data.presets.map((preset) => (
              <Link
                key={preset}
                href={pageHref(locale, q, {
                  min: preset === result.data.floor ? null : preset,
                  page: 1,
                })}
                aria-current={preset === result.data.min_settled ? 'true' : undefined}
                className={linkClass(preset === result.data.min_settled)}
              >
                {preset}
              </Link>
            ))}
            {!result.data.presets.includes(result.data.min_settled) && (
              <span className={linkClass(true)} aria-current="true">
                {result.data.min_settled}
              </span>
            )}
          </div>

          <p className="text-sm opacity-70">
            Ranked by current Performance Rating among members with at least{' '}
            {result.data.min_settled} settled predictions. Ratings are provisional below{' '}
            {result.data.floor}, so no smaller sample is ranked.
          </p>

          {result.data.entries.length === 0 ? (
            <p data-testid="leaderboard-empty">
              No member has {result.data.min_settled} settled predictions yet
              {q.page > 1 ? ' on this page' : ''}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="leaderboard">
                <thead>
                  <tr className="border-b border-current/20 text-start">
                    <th scope="col" className="py-2 pe-3 text-start">
                      #
                    </th>
                    <th scope="col" className="py-2 pe-3 text-start">
                      Member
                    </th>
                    <th scope="col" className="py-2 pe-3 text-end">
                      Rating
                    </th>
                    <th scope="col" className="py-2 pe-3 text-start">
                      Tier
                    </th>
                    <th scope="col" className="py-2 pe-3 text-end">
                      Settled
                    </th>
                    <th scope="col" className="py-2 text-start">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.entries.map((entry) => (
                    <tr key={entry.username} className="border-b border-current/10">
                      <td className="py-2 pe-3 tabular-nums">{entry.rank}</td>
                      <td className="py-2 pe-3">
                        <Link
                          href={`/${locale}/u/${encodeURIComponent(entry.username)}`}
                          className="underline"
                        >
                          @{entry.username}
                        </Link>
                      </td>
                      <td className="py-2 pe-3 text-end tabular-nums" data-testid="rating">
                        {ratingLabel(entry)}
                      </td>
                      <td className="py-2 pe-3">{tierLabel(entry.tier)}</td>
                      <td className="py-2 pe-3 text-end tabular-nums">{entry.settled_count}</td>
                      <td className="py-2">{statusLabel(entry)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <nav aria-label="Pages" className="flex flex-wrap items-center gap-3 text-sm">
            {q.page > 1 && (
              <Link href={pageHref(locale, q, { page: q.page - 1 })} className="underline">
                Previous
              </Link>
            )}
            <span className="opacity-70">
              Page {q.page} of {pageCount(result.data.total)} · {result.data.total} ranked
            </span>
            {q.page < pageCount(result.data.total) && (
              <Link href={pageHref(locale, q, { page: q.page + 1 })} className="underline">
                Next
              </Link>
            )}
          </nav>

          <p className="text-xs opacity-70">
            Formula {result.data.entries[0]?.formula_version ?? 'performance-rating'} · board rules{' '}
            {result.data.rules_version} · as of{' '}
            <time dateTime={result.data.generated_at}>{result.data.generated_at}</time>
          </p>
        </>
      )}
    </main>
  );
}
