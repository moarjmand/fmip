import type { Metadata } from 'next';
import Link from 'next/link';
import { ScoreCard } from '@/components/score-card';
import { fetchMe, fetchScores } from '@/lib/api';
import { apiQuery, dayStrip, pageHref, readScoresQuery } from '@/lib/scores';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Scores · FMIP' };

/**
 * The scores page (blueprint 4.1, T-031): one day at a time, in the viewer's
 * zone, with the yesterday / today / next-five-days strip, live and
 * favourites filters, favourites pinned, the rest grouped by competition.
 * Data comes from `GET /scores`; when the API cannot be reached the page says
 * so instead of rendering an empty list that looks like a quiet day.
 */
export default async function ScoresPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const q = readScoresQuery(query, me?.timezone ?? null);
  const result = await fetchScores(apiQuery(q), cookie);
  const strip = dayStrip(q);
  const linkClass = (active: boolean): string =>
    `rounded px-2 py-1 ${active ? 'bg-current/10 font-semibold' : 'underline'}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        Scores
      </h1>

      <nav aria-label="Day" className="flex flex-wrap gap-1 text-sm" data-testid="day-strip">
        {strip.map((day) => (
          <Link
            key={day.date}
            href={pageHref(locale, q, { date: day.date })}
            aria-current={day.isSelected ? 'date' : undefined}
            className={linkClass(day.isSelected)}
          >
            {day.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="filters">
        <Link href={pageHref(locale, q, { live: false })} className={linkClass(!q.live)}>
          All
        </Link>
        <Link href={pageHref(locale, q, { live: true })} className={linkClass(q.live)}>
          Live
        </Link>
        {me !== null && (
          <Link
            href={pageHref(locale, q, { favourites: !q.favourites })}
            className={linkClass(q.favourites)}
            aria-pressed={q.favourites}
          >
            Favourites only
          </Link>
        )}
        <span className="ms-auto opacity-70" data-testid="timezone">
          Times in {q.timezone}
          {me === null && !q.explicitTimezone ? ' (sign in for your own zone)' : ''}
        </span>
      </div>

      {!result.ok ? (
        <p role="alert" data-testid="scores-unreachable">
          {result.status === 401
            ? 'Sign in to filter by your favourites.'
            : 'The scores service is unreachable right now, so nothing can be shown for this day.'}
        </p>
      ) : result.data.total === 0 ? (
        <p className="opacity-70" data-testid="scores-empty">
          No fixtures {q.live ? 'live' : ''} on this day{q.favourites ? ' among your follows' : ''}.
        </p>
      ) : (
        <>
          {result.data.pinned.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="pinned">
              <h2 className="text-lg font-semibold">Your favourites</h2>
              <ul className="flex flex-col gap-2">
                {result.data.pinned.map((card) => (
                  <ScoreCard key={card.id} card={card} timeZone={q.timezone} />
                ))}
              </ul>
            </section>
          )}
          {result.data.groups.map((group) => (
            <section
              key={group.competition.id}
              className="flex flex-col gap-2"
              data-testid="competition-group"
            >
              <h2 className="text-lg font-semibold">
                {group.country !== null && (
                  <span className="me-2 text-sm font-normal uppercase opacity-60">
                    {group.country.name}
                  </span>
                )}
                {group.competition.name}
              </h2>
              <ul className="flex flex-col gap-2">
                {group.fixtures.map((card) => (
                  <ScoreCard key={card.id} card={card} timeZone={q.timezone} />
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs opacity-60">
            Generated <time dateTime={result.data.generated_at}>{result.data.generated_at}</time>.
          </p>
        </>
      )}
    </main>
  );
}
