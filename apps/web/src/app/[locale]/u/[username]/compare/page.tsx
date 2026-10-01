import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { PredictionOutcome, Rating } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type MessageKey, interpolate, plural, t } from '@/i18n/messages';
import { fetchMe, fetchPredictionHistory, fetchRating } from '@/lib/api';
import { COMPARE_WINDOW, compared, settledCount, tally, truncated } from '@/lib/compare';
import { ratingLabel, statusLabel, tierLabel } from '@/lib/leaderboard';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}): Promise<Metadata> {
  const { locale, username } = await params;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const name = decodeURIComponent(username);
  return pageMetadata({
    locale,
    path: `/u/${encodeURIComponent(name)}/compare`,
    title: `${interpolate(t(lang, 'profile.compare.metaTitle'), { username: name })} · FMIP`,
  });
}

const OUTCOME_KEY: Record<PredictionOutcome, MessageKey> = {
  home: 'profile.compare.outcome.home',
  draw: 'profile.compare.outcome.draw',
  away: 'profile.compare.outcome.away',
};

function ratingLine(lang: Locale, rating: Rating | null): string {
  if (rating === null) return t(lang, 'profile.rating.none');
  const settled = plural(lang, 'profile.compare.settledCount', rating.settled_count).text;
  return `${ratingLabel(rating)} · ${tierLabel(rating.tier)} · ${statusLabel(rating)} · ${settled}`;
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
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
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
  const say = (key: MessageKey, params: Record<string, string> = {}): string =>
    interpolate(t(lang, key), params);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" data-testid="title">
          {say('profile.compare.title', { username: name })}
        </h1>
        <Link href={`/${locale}/u/${encodeURIComponent(name)}`} className="text-sm underline">
          <Translated locale={locale} message="profile.compare.back" />
        </Link>
      </div>

      <section className="flex flex-col gap-2" data-testid="compare-ratings">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="profile.compare.ratings" />
        </h2>
        <p className="text-sm">
          <span className="text-muted">
            <Translated locale={locale} message="profile.compare.you" /> ·{' '}
          </span>
          {myRating.ok
            ? ratingLine(lang, myRating.data.rating)
            : say('profile.compare.myRatingUnreachable')}
        </p>
        <p className="text-sm">
          <span className="text-muted">@{name} · </span>
          {theirRating.ok
            ? ratingLine(lang, theirRating.data.rating)
            : say('profile.compare.theirRatingUnreachable')}
        </p>
        <p className="text-xs text-muted">
          <Translated locale={locale} message="profile.compare.ratingNote" />
        </p>
      </section>

      <section className="flex flex-col gap-2" data-testid="compare-record">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="profile.compare.record" />
        </h2>

        {!both ? (
          <Notice tone="danger">
            <Translated locale={locale} message="profile.compare.unreachable" />
          </Notice>
        ) : theirs?.kind === 'restricted' ? (
          <p className="text-sm" data-testid="compare-restricted">
            {say(
              theirs.visibility === 'friends'
                ? 'profile.compare.restrictedFriends'
                : 'profile.compare.restrictedPrivate',
              { username: name },
            )}
          </p>
        ) : mine?.kind === 'restricted' ? (
          // Reachable: a member may hide their own history, and this page reads
          // it through the same endpoint everybody else does rather than around
          // it. Settings is where they change it.
          <p className="text-sm" data-testid="compare-mine-restricted">
            <Translated locale={locale} message="profile.compare.mineRestricted" />{' '}
            <Link href={`/${locale}/settings`} className="underline">
              <Translated locale={locale} message="profile.compare.privacyLink" />
            </Link>
          </p>
        ) : matches.length === 0 ? (
          <p className="text-sm text-muted" data-testid="compare-none">
            <Translated locale={locale} message="profile.compare.none" />
          </p>
        ) : (
          <>
            <p className="text-sm" data-testid="compare-tally">
              {settled === 0
                ? plural(lang, 'profile.compare.inCommon', matches.length).text
                : plural(lang, 'profile.compare.tally', settled, {
                    both: formatNumber(lang, counts.both),
                    mine: formatNumber(lang, counts.only_mine),
                    theirs: formatNumber(lang, counts.only_theirs),
                    neither: formatNumber(lang, counts.neither),
                    username: name,
                  }).text}
            </p>
            {partial && (
              <p className="text-xs text-muted" data-testid="compare-window">
                {say('profile.compare.window', { count: formatNumber(lang, COMPARE_WINDOW) })}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {matches.slice(0, 20).map((match) => (
                <li key={match.fixture.id} className="text-sm">
                  <Link href={`/${locale}/match/${match.fixture.id}`} className="underline">
                    {say('profile.compare.fixture', {
                      home: match.fixture.home.name,
                      away: match.fixture.away.name,
                    })}
                  </Link>{' '}
                  <span className="text-muted">
                    ·{' '}
                    {say('profile.compare.yourCall', {
                      outcome: t(lang, OUTCOME_KEY[match.mine.latest.outcome]),
                    })}{' '}
                    ·{' '}
                    {say('profile.compare.theirCall', {
                      username: name,
                      outcome: t(lang, OUTCOME_KEY[match.theirs.latest.outcome]),
                    })}{' '}
                    ·{' '}
                    {match.mine.settlement?.status === 'settled' &&
                    match.theirs.settlement?.status === 'settled'
                      ? say('profile.compare.verdict', {
                          you: t(
                            lang,
                            match.mine.settlement.outcome_correct === true
                              ? 'profile.compare.youRight'
                              : 'profile.compare.youWrong',
                          ),
                          they: t(
                            lang,
                            match.theirs.settlement.outcome_correct === true
                              ? 'profile.compare.theyRight'
                              : 'profile.compare.theyWrong',
                          ),
                        })
                      : t(lang, 'profile.compare.notSettled')}
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
