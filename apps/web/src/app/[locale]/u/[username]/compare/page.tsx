import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Rating } from '@fmip/contracts';
import { fetchMe, fetchPredictionHistory, fetchRating } from '@/lib/api';
import { COMPARE_WINDOW, compared, settledCount, tally, truncated } from '@/lib/compare';
import { ratingLabel, statusLabel, tierLabel } from '@/lib/leaderboard';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}): Promise<Metadata> {
  const { locale, username } = await params;
  const name = decodeURIComponent(username);
  return pageMetadata({
    locale,
    path: `/u/${encodeURIComponent(name)}/compare`,
    title: `Compare with @${name} · FMIP`,
  });
}

function ratingLine(rating: Rating | null): string {
  if (rating === null) return 'No rating yet: a rating starts with the first settled prediction.';
  return `${ratingLabel(rating)} · ${tierLabel(rating.tier)} · ${statusLabel(rating)} · ${rating.settled_count} settled`;
}

/**
 * Two members' prediction records, side by side (blueprint 8.1, T-203).
 *
 * The blueprint gives friends the ability to "compare prediction records and
 * ratings". The care in this page is all in what it declines to claim.
 *
 * **It never routes around the other member's privacy.** The history comes from
 * the same endpoint their profile uses (T-056), so a member whose history is
 * friends-only or private is restricted here too, and the page says which. A
 * comparison built by reading the predictions a different way would be a
 * privacy setting with a hole in it.
 *
 * **It compares a window and says so.** One request per member reaches 50
 * predictions (`HISTORY_MAX_LIMIT`), so where either has made more, the page
 * states that this is the recent record rather than the career.
 *
 * **Unsettled and void matches are absent from the tally** rather than counted
 * as misses — see `lib/compare.ts` for why each exclusion is there.
 */
export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}) {
  const { locale, username } = await params;
  const name = decodeURIComponent(username);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login`);
  if (me.username.toLowerCase() === name.toLowerCase()) {
    redirect(`/${locale}/u/${encodeURIComponent(me.username)}`);
  }

  const query = `limit=${COMPARE_WINDOW}&offset=0`;
  const [myRating, theirRating, myHistory, theirHistory] = await Promise.all([
    fetchRating(me.username),
    fetchRating(name),
    fetchPredictionHistory(me.username, query, cookie),
    fetchPredictionHistory(name, query, cookie),
  ]);

  if (!theirRating.ok && theirRating.status === 404) notFound();

  const both = myHistory.ok && theirHistory.ok;
  const theirs = theirHistory.ok ? theirHistory.data : null;
  const mine = myHistory.ok ? myHistory.data : null;

  const matches =
    mine?.kind === 'visible' && theirs?.kind === 'visible'
      ? compared(mine.items, theirs.items)
      : [];
  const counts = tally(matches);
  const settled = settledCount(counts);
  const partial =
    mine?.kind === 'visible' && theirs?.kind === 'visible'
      ? truncated(mine.total, theirs.total)
      : false;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" data-testid="title">
          You and @{name}
        </h1>
        <Link href={`/${locale}/u/${encodeURIComponent(name)}`} className="text-sm underline">
          Back to their profile
        </Link>
      </div>

      <section className="flex flex-col gap-2" data-testid="compare-ratings">
        <h2 className="text-lg font-semibold">Ratings</h2>
        <p className="text-sm">
          <span className="opacity-70">You · </span>
          {myRating.ok ? ratingLine(myRating.data.rating) : 'Your rating is unreachable right now.'}
        </p>
        <p className="text-sm">
          <span className="opacity-70">@{name} · </span>
          {theirRating.ok
            ? ratingLine(theirRating.data.rating)
            : 'Their rating is unreachable right now.'}
        </p>
        <p className="text-xs opacity-60">
          A Performance Rating is earned from settled predictions and adjusted for how hard each
          call was — it is not a count of how often somebody posts.
        </p>
      </section>

      <section className="flex flex-col gap-2" data-testid="compare-record">
        <h2 className="text-lg font-semibold">Matches you both predicted</h2>

        {!both ? (
          <p role="alert" className="text-sm">
            One of the two histories is unreachable right now, so there is nothing to compare.
          </p>
        ) : theirs?.kind === 'restricted' ? (
          <p className="text-sm" data-testid="compare-restricted">
            {theirs.visibility === 'friends'
              ? `@${name} shows their prediction history to friends only.`
              : `@${name} keeps their prediction history private.`}
          </p>
        ) : mine?.kind === 'restricted' ? (
          // Reachable: a member may hide their own history, and this page reads
          // it through the same endpoint everybody else does rather than around
          // it. Settings is where they change it.
          <p className="text-sm" data-testid="compare-mine-restricted">
            Your own prediction history is hidden, and this comparison reads it the same way
            everyone else does.{' '}
            <Link href={`/${locale}/settings`} className="underline">
              Privacy settings
            </Link>
          </p>
        ) : matches.length === 0 ? (
          <p className="text-sm opacity-70" data-testid="compare-none">
            You have not predicted any of the same matches yet.
          </p>
        ) : (
          <>
            <p className="text-sm" data-testid="compare-tally">
              {settled === 0
                ? `${matches.length} match${matches.length === 1 ? '' : 'es'} in common, none of them settled yet.`
                : `Over ${settled} settled match${settled === 1 ? '' : 'es'} in common: both right ${counts.both}, only you ${counts.only_mine}, only @${name} ${counts.only_theirs}, neither ${counts.neither}.`}
            </p>
            {partial && (
              <p className="text-xs opacity-60" data-testid="compare-window">
                This is the most recent {COMPARE_WINDOW} predictions from each of you, not the whole
                record.
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {matches.slice(0, 20).map((match) => (
                <li key={match.fixture.id} className="text-sm">
                  <Link href={`/${locale}/match/${match.fixture.id}`} className="underline">
                    {match.fixture.home.name} v {match.fixture.away.name}
                  </Link>{' '}
                  <span className="opacity-70">
                    · you: {match.mine.latest.outcome} · @{name}: {match.theirs.latest.outcome}
                    {match.mine.settlement?.status === 'settled' &&
                    match.theirs.settlement?.status === 'settled'
                      ? ` · ${match.mine.settlement.outcome_correct === true ? 'you were right' : 'you were wrong'}, ${
                          match.theirs.settlement.outcome_correct === true
                            ? 'they were right'
                            : 'they were wrong'
                        }`
                      : ' · not settled'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
