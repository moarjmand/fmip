import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/json-ld';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import {
  fetchApiHealth,
  fetchCompetition,
  fetchForecastList,
  fetchFounderFeed,
  fetchMe,
  fetchNewsSection,
  fetchScores,
} from '@/lib/api';
import {
  HOME_TABLE_ROWS,
  homeForecasts,
  homeMatches,
  shortDay,
  tableCompetition,
} from '@/lib/home';
import { dateIn, formatKickoff, shiftDate, statusLabel } from '@/lib/scores';
import { rootTitle } from '@/lib/demonstration';
import { pageMetadata, websiteJsonLd } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

// The API is queried per request, so a build never depends on it being up.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '',
    // The only page in the layout's own segment, so the layout's title
    // template does not reach it and it carries the marker itself (T-087).
    title: rootTitle('FMIP'),
    description:
      'Football match intelligence: live scores, match centre, forecasts and predictions.',
  });
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const [health, founder, me] = await Promise.all([
    fetchApiHealth(),
    // The blueprint puts the founder's analysis on the homepage "for selected
    // matches"; the feed is upcoming matches only, so there is nothing to
    // select — what exists is what is coming (T-132).
    fetchFounderFeed({ limit: 3 }),
    // Only to offer the first-visit page to someone who is not signed in (T-523).
    fetchMe(cookie),
  ]);

  // Blueprint 2.3 (T-526): the homepage is made of answers the product already
  // gives, each block shown only when it has something real in it (rule 3).
  // Times are the member's zone, or UTC for a guest, and say which.
  const timeZone = me?.timezone ?? 'UTC';
  const today = dateIn(timeZone, new Date());
  const [scores, news] = await Promise.all([
    fetchScores(
      new URLSearchParams({ from: today, to: shiftDate(today, 6), tz: timeZone }).toString(),
      cookie,
    ),
    fetchNewsSection('', locale, cookie),
  ]);
  const matches = scores.ok ? homeMatches(scores.data) : [];
  const tableId = scores.ok ? tableCompetition(scores.data) : null;
  const [forecasts, table] = await Promise.all([
    matches.length > 0 ? fetchForecastList(matches.map((card) => card.id)) : null,
    tableId !== null ? fetchCompetition(tableId, '', locale) : null,
  ]);
  const modelView =
    forecasts !== null && forecasts.ok ? homeForecasts(matches, forecasts.data.fixtures) : [];
  const tableRows =
    table !== null && table.ok ? (table.data.table.data ?? []).slice(0, HOME_TABLE_ROWS) : [];
  const stories = news.ok ? (news.data.stories.data ?? []).slice(0, 5) : [];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <JsonLd data={websiteJsonLd(locale)} />
      {/*
        The accent bar is deliberately asymmetric and deliberately logical:
        `border-s` and `ps` sit on the inline start, so they move to the right
        edge under `dir="rtl"`. The Playwright check in tests/e2e asserts exactly
        that, which makes this element the canary for a physical-property
        regression that slipped past lint.
      */}
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        FMIP
      </h1>
      <p>
        Football Match Intelligence Platform. Start with the{' '}
        <Link href={`/${locale}/scores`} className="underline">
          scores
        </Link>
        .
      </p>
      {me === null && (
        <p data-testid="first-visit">
          New here?{' '}
          <Link href={`/${locale}/about`} className="underline">
            What FMIP is, and how a rating is earned
          </Link>
          .
        </p>
      )}
      {me === null && (
        <p className="text-sm" data-testid="guest-invite">
          <Link href={`/${locale}/register`} className="underline">
            Create an account
          </Link>{' '}
          to follow your teams, predict matches and earn a rating.
        </p>
      )}
      {me !== null && (
        <p className="text-sm">
          <Link href={`/${locale}/following`} className="underline">
            Your feed
          </Link>{' '}
          &mdash; your teams, competitions, friends and groups.
        </p>
      )}

      {matches.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="home-matches">
          <h2 className="text-lg font-semibold">Live and upcoming</h2>
          <ul className="flex flex-col gap-1">
            {matches.map((card) => (
              <li key={card.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="w-24 shrink-0 text-sm opacity-70">
                  {card.status === 'scheduled'
                    ? `${shortDay(card.kickoff_at, timeZone)} ${formatKickoff(locale, card.kickoff_at, timeZone)}`
                    : statusLabel(card, locale, timeZone)}
                </span>
                <Link href={`/${locale}/match/${card.id}`} className="underline">
                  {card.home.name}{' '}
                  {card.scores.current !== null
                    ? `${card.scores.current.home}–${card.scores.current.away}`
                    : 'v'}{' '}
                  {card.away.name}
                </Link>
                <span className="text-xs opacity-60">
                  {card.competition.short_name ?? card.competition.name}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            <Link href={`/${locale}/scores`} className="underline">
              All scores
            </Link>{' '}
            <span className="opacity-60">(times in {timeZone})</span>
          </p>
        </section>
      )}

      {modelView.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="home-forecasts">
          <h2 className="text-lg font-semibold">The model&rsquo;s view</h2>
          <ul className="flex flex-col gap-1">
            {modelView.map(({ card, percent }) => (
              <li key={card.id}>
                <Link href={`/${locale}/match/${card.id}`} className="underline">
                  {card.home.name} v {card.away.name}
                </Link>
                : {card.home.short_name ?? card.home.name} {percent.home}% · draw {percent.draw}% ·{' '}
                {card.away.short_name ?? card.away.name} {percent.away}%
              </li>
            ))}
          </ul>
          <p className="text-xs opacity-70">
            The statistical model&rsquo;s forecasts ({modelView[0]?.modelVersion}). Not the
            founder&rsquo;s view, and not the community&rsquo;s.
          </p>
        </section>
      )}

      {founder.ok && (
        <FounderAnalysisFeed
          analyses={founder.data.analyses}
          locale={locale}
          timeZone="UTC"
          heading="Founder's analysis of what is coming"
        />
      )}

      {table !== null && table.ok && tableRows.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="home-table">
          <h2 className="text-lg font-semibold">
            <Link
              href={`/${locale}/competition/${table.data.competition.id}`}
              className="underline"
            >
              {table.data.competition.name}
            </Link>
          </h2>
          <table className="text-sm">
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.team.id}>
                  <td className="pe-3 opacity-70">{row.position}</td>
                  <td className="pe-3">{row.team.name}</td>
                  <td className="pe-3 opacity-70">{row.played}</td>
                  <td className="font-semibold">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {stories.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="home-news">
          <h2 className="text-lg font-semibold">Latest stories</h2>
          <ul className="flex flex-col gap-1">
            {stories.map((story) => (
              <li key={story.story_id}>
                <Link href={`/${locale}/news/story/${story.story_id}`} className="underline">
                  {story.headline}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-sm opacity-70">
        Locale: <code>{locale}</code>
      </p>
      <p className="text-sm opacity-70">
        {health.reachable ? (
          <>
            API: <code>{health.report.status}</code>, up for{' '}
            {Math.round(health.report.uptime_seconds)}s as of{' '}
            <time dateTime={health.report.checked_at}>{health.report.checked_at}</time>
          </>
        ) : (
          // Never render a healthy-looking placeholder for something we could
          // not reach (rule 3).
          <>API: unreachable</>
        )}
      </p>
    </main>
  );
}
