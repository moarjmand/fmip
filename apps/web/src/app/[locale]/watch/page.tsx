import type { Metadata } from 'next';
import Link from 'next/link';
import type { MatchViewing, ScoreCard } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { TerritoryChooser, ViewingPanel } from '@/components/viewing-panel';
import { formatDateTime } from '@/i18n/format';
import { fetchMe, fetchScores, fetchTerritories, fetchViewingBatch } from '@/lib/api';
import { apiQuery, dayStrip, readScoresQuery } from '@/lib/scores';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { readTerritoryQuery, watchHref, withTerritory } from '@/lib/viewing';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/watch',
    title: 'Watch · FMIP',
    description: 'Where each match can be watched, in the territory you choose.',
  });
}

/**
 * The Watch page (blueprint 11, T-314): the day's matches, each with where it
 * can be watched in the viewer's territory -- the member's stored one
 * (T-312) or the one a guest picks here, which then travels with every link
 * on the page. The matches are the scores page's day (T-031), in the same
 * zone, so the two pages never disagree about which day it is; the answers
 * come from one batch request, and a match the viewing service could not
 * answer for says so rather than showing an empty line (rule 3).
 */
export default async function WatchPage({
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
  const territory = readTerritoryQuery(query);
  const [scores, territories] = await Promise.all([
    fetchScores(apiQuery(q), cookie),
    me === null ? fetchTerritories() : Promise.resolve(null),
  ]);
  const groups = scores.ok ? scores.data.groups : [];
  const cards: ScoreCard[] = groups.flatMap((group) => group.fixtures);
  const batch =
    cards.length > 0
      ? await fetchViewingBatch(
          cards.map((card) => card.id),
          territory,
          cookie,
        )
      : null;
  const answers = new Map<string, MatchViewing>(
    batch !== null && batch.ok ? batch.data.fixtures.map((v) => [v.fixture_id, v]) : [],
  );
  // The chooser needs a territory state to show even when the day is empty.
  const territoryState: MatchViewing | null =
    batch !== null && batch.ok
      ? { fixture_id: '', territory: batch.data.territory, options: NONE, highlights: NONE }
      : null;
  const strip = dayStrip(q, locale);
  const guestTerritory = me === null ? territory : undefined;
  const linkClass = (active: boolean): string =>
    `rounded px-2 py-1 ${active ? 'bg-current/10 font-semibold' : 'underline'}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={locale} message="viewing.pageTitle" />
      </h1>
      <p className="text-sm opacity-80">
        <Translated locale={locale} message="viewing.pageLead" />
      </p>

      <nav aria-label="Day" className="flex flex-wrap gap-2 text-sm" data-testid="day-strip">
        {strip.map((day) => (
          <Link
            key={day.date}
            href={watchHref(locale, q, guestTerritory, { date: day.date })}
            aria-current={day.isSelected ? 'date' : undefined}
            className={linkClass(day.isSelected)}
          >
            {day.label}
          </Link>
        ))}
        <span className="ms-auto opacity-70" data-testid="timezone">
          Times in {q.timezone}
        </span>
      </nav>

      {territoryState !== null ? (
        <TerritoryChooser
          locale={locale}
          viewing={territoryState}
          signedIn={me !== null}
          href={`/${locale}/watch`}
          territories={territories}
          hidden={{ date: q.date, ...(q.explicitTimezone ? { tz: q.timezone } : {}) }}
        />
      ) : (
        cards.length > 0 && (
          <p role="alert">
            <Translated locale={locale} message="viewing.unreachable" />
          </p>
        )
      )}

      {!scores.ok ? (
        <p role="alert" data-testid="watch-unreachable">
          <Translated locale={locale} message="viewing.unreachable" />
        </p>
      ) : cards.length === 0 ? (
        <p className="opacity-70" data-testid="watch-empty">
          <Translated locale={locale} message="viewing.noMatches" />
        </p>
      ) : (
        <ol className="flex flex-col gap-6" data-testid="watch-list">
          {groups.map((group) => (
            <li key={`${group.competition.id}`} className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">
                <Link href={`/${locale}/competition/${group.competition.id}`} className="underline">
                  {group.competition.name}
                </Link>
              </h2>
              <ul className="flex flex-col gap-3">
                {group.fixtures.map((card) => {
                  const href = withTerritory(`/${locale}/match/${card.id}`, guestTerritory);
                  return (
                    <li key={card.id} className="flex flex-col gap-1" data-testid="watch-card">
                      <p className="flex flex-wrap items-baseline gap-x-3">
                        <Link href={href} className="font-medium underline">
                          {card.home.name} v {card.away.name}
                        </Link>
                        <time dateTime={card.kickoff_at} className="text-sm opacity-70">
                          {formatDateTime(locale, card.kickoff_at, q.timezone)}
                        </time>
                      </p>
                      <ViewingPanel
                        variant="line"
                        locale={locale}
                        timeZone={q.timezone}
                        viewing={answers.get(card.id) ?? null}
                        kickoffAt={card.kickoff_at}
                        status={card.status}
                        signedIn={me !== null}
                        href={href}
                      />
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

const NONE = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;
