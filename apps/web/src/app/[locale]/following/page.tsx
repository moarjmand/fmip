import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { FeedItem, FeedSignal, MatchViewing } from '@fmip/contracts';
import { BriefingPanel } from '@/components/briefing';
import { Translated } from '@/components/translated';
import { ViewingPanel } from '@/components/viewing-panel';
import { formatDateTime } from '@/i18n/format';
import { fetchBriefing, fetchFeed, fetchMe, fetchViewingBatch } from '@/lib/api';
import {
  KIND_KEY,
  REASON_KEY,
  SIGNAL_KEY,
  feedItemHref,
  feedItemKey,
  feedItemTitle,
  signalValue,
} from '@/lib/feed';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/following',
    title: 'Following · FMIP',
    description: 'What is happening around the teams, competitions and contributors you follow.',
    index: false,
  });
}

/**
 * The Following feed (blueprint 12.1, T-333): what happened, and what is
 * about to, around what a member follows, in the API's order. The page adds
 * nothing to the ranking and hides nothing of it: every item shows the
 * reasons it is here and the rank they add up to, and the top of the page
 * says what window, what kinds and what rule the list is made from.
 */
export default async function FollowingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/following`);
  const timeZone = me.timezone;
  const result = await fetchFeed(cookie);
  // The briefing (E43): a stored version or the reason there is none; never a model call on this request.
  const briefing = await fetchBriefing(cookie);
  // Where each match in the feed can be watched (T-314): one batch, in the
  // member's stored territory -- the feed is theirs, so there is no guest here.
  const fixtureIds = result.ok
    ? result.data.items.flatMap((item) => (item.kind === 'fixture' ? [item.fixture_id] : []))
    : [];
  const viewing =
    fixtureIds.length > 0
      ? await fetchViewingBatch(fixtureIds.slice(0, 100), undefined, cookie)
      : null;
  const answers = new Map<string, MatchViewing>(
    viewing !== null && viewing.ok ? viewing.data.fixtures.map((v) => [v.fixture_id, v]) : [],
  );
  const when = (iso: string): string => formatDateTime(locale, iso, timeZone);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
          <Translated locale={locale} message="feed.title" />
        </h1>
        <Link href={`/${locale}/settings`} className="text-sm underline">
          <Translated locale={locale} message="feed.manage" />
        </Link>
      </div>

      <BriefingPanel
        locale={locale}
        timeZone={timeZone}
        briefing={briefing.ok ? briefing.data : null}
      />

      {!result.ok ? (
        <p role="alert" data-testid="feed-unreachable">
          <Translated locale={locale} message="feed.unreachable" />
        </p>
      ) : (
        <>
          <p className="text-sm opacity-80" data-testid="feed-showing">
            <Translated locale={locale} message="feed.showing" />{' '}
            <time dateTime={result.data.showing.since}>{when(result.data.showing.since)}</time>
            {' – '}
            <time dateTime={result.data.showing.until}>{when(result.data.showing.until)}</time>
            {' · '}
            <Translated
              locale={locale}
              message="feed.followedTeams"
              count={result.data.showing.followed.teams}
            />
            {', '}
            <Translated
              locale={locale}
              message="feed.followedCompetitions"
              count={result.data.showing.followed.competitions}
            />
            {', '}
            <Translated
              locale={locale}
              message="feed.followedMembers"
              count={result.data.showing.followed.members}
            />
            {' · '}
            <Translated locale={locale} message="feed.rankingRule" />{' '}
            <code data-testid="feed-ranking">{result.data.ranking.version}</code>
          </p>

          {result.data.reason !== null && (
            <p role="status" className="text-sm font-medium" data-testid="feed-reason">
              <Translated locale={locale} message={REASON_KEY[result.data.reason]} />
            </p>
          )}

          {result.data.items.length > 0 && (
            <ol className="flex flex-col gap-4" data-testid="feed-items">
              {result.data.items.map((item) => (
                <li key={feedItemKey(item)}>
                  <Item
                    item={item}
                    locale={locale}
                    when={when}
                    timeZone={timeZone}
                    viewing={
                      item.kind === 'fixture' ? (answers.get(item.fixture_id) ?? null) : undefined
                    }
                  />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </main>
  );
}

function Item({
  item,
  locale,
  when,
  timeZone,
  viewing,
}: {
  item: FeedItem;
  locale: string;
  when: (iso: string) => string;
  timeZone: string;
  /** For a fixture: the module, or `null` when the viewing service could not be reached. */
  viewing?: MatchViewing | null;
}) {
  return (
    <article
      className="flex flex-col gap-1 border-s-2 border-s-current/30 ps-4"
      data-testid="feed-item"
      data-kind={item.kind}
      data-rank={item.rank}
    >
      <p className="text-xs uppercase tracking-wide opacity-70">
        <Translated locale={locale} message={KIND_KEY[item.kind]} />
        {' · '}
        <time dateTime={item.at}>{when(item.at)}</time>
      </p>
      <h2 className="text-lg font-semibold">
        <Link href={feedItemHref(locale, item)} className="underline" data-testid="feed-item-link">
          {feedItemTitle(item)}
        </Link>
      </h2>
      {item.kind === 'fixture' && item.score !== null && (
        <p className="text-sm">
          {item.score.home} – {item.score.away}
        </p>
      )}
      {item.kind === 'fixture' && viewing !== undefined && (
        <ViewingPanel
          variant="line"
          locale={locale}
          timeZone={timeZone}
          viewing={viewing}
          kickoffAt={item.kickoff_at}
          status={item.status}
          signedIn
          href={`/${locale}/match/${item.fixture_id}`}
        />
      )}
      {item.kind === 'story' && (
        <p className="text-sm opacity-80">
          <Translated locale={locale} message="news.readAt" /> {item.source_name}
        </p>
      )}
      {item.kind === 'founder_analysis' && (
        <p className="text-sm opacity-80">
          <Translated locale={locale} message="feed.analysisCall" /> {item.predicted_outcome}
        </p>
      )}
      {item.kind === 'panel_post' && <p className="text-sm">{item.excerpt}</p>}
      <ul className="flex flex-wrap gap-2 text-xs" data-testid="feed-because">
        {item.because.map((signal, index) => (
          <li key={index} className="rounded bg-current/10 px-2 py-0.5" data-signal={signal.kind}>
            <Signal signal={signal} locale={locale} />
          </li>
        ))}
        <li className="opacity-70" data-testid="feed-rank">
          <Translated locale={locale} message="feed.rank" /> {item.rank}
        </li>
      </ul>
    </article>
  );
}

function Signal({ signal, locale }: { signal: FeedSignal; locale: string }) {
  if (signal.kind === 'discussed') {
    return (
      <Translated
        locale={locale}
        message="feed.signal.discussed"
        count={signal.participants}
        params={{ hours: String(signal.window_hours) }}
      />
    );
  }
  const value = signalValue(signal);
  return (
    <>
      <Translated locale={locale} message={SIGNAL_KEY[signal.kind]} />
      {value !== null && <> {value}</>}
    </>
  );
}
