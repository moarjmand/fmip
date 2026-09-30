import type { Metadata } from 'next';
import Link from 'next/link';
import { MAX_CONSENSUS_FIXTURES } from '@fmip/contracts';
import { CommunityConsensusList } from '@/components/community-consensus';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import { ForecastList } from '@/components/forecast-panel';
import { MemberName } from '@/components/member-name';
import {
  fetchConsensusList,
  fetchForecastList,
  fetchFounderFeed,
  fetchLeaderboard,
  fetchMe,
  fetchScores,
} from '@/lib/api';
import { apiQuery, readScoresQuery } from '@/lib/scores';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';
import { Translated } from '@/components/translated';
import { formatDate } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import { asLocale, plainNumber, ratingText } from '@/lib/prediction-text';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l = asLocale(locale);
  return pageMetadata({
    locale,
    path: '/predictions',
    title: t(l, 'predictions.page.title'),
    description: t(l, 'predictions.page.description'),
  });
}

/** The scores day, `2026-10-01`, as English has always shown it; the locale's own date elsewhere. */
function dayLabel(locale: Locale, date: string): string {
  if (locale === DEFAULT_LOCALE) return date;
  return formatDate(locale, `${date}T12:00:00Z`, 'UTC', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The Predictions page (blueprint 2.1, T-137).
 *
 * Blueprint 2.1 names four things under Predictions: "model forecasts, founder
 * analysis, community consensus and prediction leaderboards". This is the one
 * page in the product where all three prediction products appear together,
 * which makes it the page rule 6 was written for.
 *
 * **So they are four sections, not one list.** There is no combined feed, no
 * shared row component and no "prediction" with a source beside it. Each
 * section is rendered by a component that belongs to that product and can
 * render nothing else, from an endpoint that serves only that product. A reader
 * who scrolls past one heading and into the next can always tell which of the
 * three they are looking at, because the three never share a container.
 *
 * The alternative — one ranked list of "today's predictions" with a little tag
 * saying where each came from — is more compact, reads better, and is exactly
 * what the rule forbids.
 */
export default async function PredictionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const l = asLocale(locale);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const q = readScoresQuery(query, me?.timezone ?? null);

  // The fixtures come from the scores boundary, which is what knows what is on.
  // Neither prediction product is asked to also be a fixture list.
  const scores = await fetchScores(apiQuery(q), cookie);
  const cards = scores.ok
    ? [...scores.data.pinned, ...scores.data.groups.flatMap((g) => g.fixtures)]
    : [];
  const unique = [...new Map(cards.map((card) => [card.id, card])).values()];
  // The endpoints cap at this; asking for more would be a 400 rather than a
  // longer page.
  const shown = unique.slice(0, MAX_CONSENSUS_FIXTURES);
  const fixtureIds = shown.map((card) => card.id);
  const names = new Map(
    shown.map((card) => [card.id, { home: card.home.name, away: card.away.name }]),
  );

  const [forecasts, consensus, founder, leaderboard] = await Promise.all([
    fixtureIds.length === 0 ? Promise.resolve(null) : fetchForecastList(fixtureIds),
    fixtureIds.length === 0 ? Promise.resolve(null) : fetchConsensusList(fixtureIds),
    fetchFounderFeed({ limit: 5 }),
    fetchLeaderboard('limit=10'),
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" data-testid="title">
          <Translated locale={l} message="nav.predictions" />
        </h1>
        <p className="text-sm text-muted">
          <Translated locale={l} message="predictions.page.intro" />
        </p>
        <p className="text-sm text-muted" data-testid="predictions-day">
          {interpolate(t(l, 'predictions.page.day'), {
            date: dayLabel(l, q.date),
            timezone: q.timezone,
          })}{' '}
          <Link href={`/${locale}/scores`} className="underline">
            <Translated locale={l} message="predictions.page.allScores" />
          </Link>
        </p>
      </div>

      {!scores.ok ? (
        <Notice tone="danger" data-testid="predictions-unreachable">
          <Translated locale={l} message="predictions.page.unreachable" />
        </Notice>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted" data-testid="predictions-empty">
          <Translated locale={l} message="predictions.page.empty" />
        </p>
      ) : (
        <>
          <ForecastList
            entries={forecasts !== null && forecasts.ok ? forecasts.data.fixtures : []}
            fixtures={names}
            locale={locale}
          />
          {/*
            The feed component renders nothing when it is empty, which is right
            on the homepage and wrong here: this page promises four things, and
            a section that silently disappears leaves a reader unable to tell
            whether the founder has written nothing or the site forgot to ask.
            So the absence is stated.
          */}
          {founder.ok && founder.data.analyses.length > 0 ? (
            <FounderAnalysisFeed
              analyses={founder.data.analyses}
              locale={locale}
              timeZone={q.timezone}
            />
          ) : (
            <section className="flex flex-col gap-2" data-testid="predictions-founder">
              <h2 className="text-lg font-semibold">
                <Translated locale={l} message="analysis.founder.title" />
              </h2>
              <p className="text-sm text-muted">
                <Translated
                  locale={l}
                  message={
                    founder.ok
                      ? 'predictions.page.founderNone'
                      : 'predictions.page.founderUnreachable'
                  }
                />
              </p>
            </section>
          )}
          <CommunityConsensusList
            entries={consensus !== null && consensus.ok ? consensus.data.fixtures : []}
            fixtures={names}
            locale={locale}
          />
        </>
      )}

      <section className="flex flex-col gap-2" data-testid="predictions-leaderboard">
        <h2 className="text-lg font-semibold">
          <Translated locale={l} message="predictions.page.leaderboardTitle" />
        </h2>
        <p className="text-xs text-muted">
          <Translated locale={l} message="predictions.page.leaderboardNote" />
        </p>
        {!leaderboard.ok ? (
          <p className="text-sm text-muted">
            <Translated locale={l} message="predictions.page.leaderboardUnreachable" />
          </p>
        ) : leaderboard.data.entries.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={l} message="predictions.page.leaderboardEmpty" />
          </p>
        ) : (
          <ol className="flex flex-col gap-1">
            {leaderboard.data.entries.map((entry) => (
              <li key={entry.username} className="text-sm">
                <span className="text-muted">{plainNumber(l, entry.rank)}.</span>{' '}
                <MemberName locale={locale} member={entry} link className="underline" />{' '}
                <span className="text-muted">
                  <Translated
                    locale={l}
                    message={
                      entry.provisional
                        ? 'predictions.page.entryProvisional'
                        : 'predictions.page.entry'
                    }
                    count={entry.settled_count}
                    params={{ rating: ratingText(l, entry.rating) }}
                  />
                </span>
              </li>
            ))}
          </ol>
        )}
        <Link href={`/${locale}/leaderboard`} className="text-sm underline">
          <Translated locale={l} message="predictions.page.fullLeaderboard" />
        </Link>
      </section>
    </main>
  );
}
