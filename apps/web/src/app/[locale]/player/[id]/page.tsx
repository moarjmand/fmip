import type { Metadata } from 'next';
import type { PlayerPage as PlayerPageData } from '@fmip/contracts';
import { notFound } from 'next/navigation';
import {
  fetchEntityNews,
  fetchFollowing,
  fetchMe,
  fetchPlayer,
  fetchPlayerProviderSeasons,
  fetchPlayerTransfers,
} from '@/lib/api';
import { EntityFollow, MoreLink, zoneWords } from '@/components/competition-page';
import { JsonLd } from '@/components/json-ld';
import { PlayerAvailabilitySection } from '@/components/player-availability';
import { ProviderCareerPanel, ProviderSeasonsPanel } from '@/components/player-provider-seasons';
import { PlayerTransfersPanel } from '@/components/transfers';
import {
  LastMatchesPanel,
  PlayerHeader,
  PlayerMatchesPanel,
  RecordPanel,
  SeasonFilter,
  SeasonTilesPanel,
  SpellsPanel,
} from '@/components/player-page';
import { EntityNews } from '@/components/related-news';
import { Stamp } from '@/components/stamp';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { say } from '@/lib/competition';
import {
  OVERVIEW_PLAYER_MATCHES,
  type PlayerTab,
  filterMatches,
  filterRecord,
  playerTabHref,
  readPlayerTab,
  readSeasonFilter,
  seasonLabelOf,
  seasonsOf,
} from '@/lib/player';
import { pageMetadata, playerJsonLd } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { pageTimeZone } from '@/lib/reader-time-zone-server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const fallback = `${say(locale, 'playerPage.title')} · Stadiomind`;
  if (!UUID.test(id)) return { title: fallback, robots: { index: false, follow: false } };
  const result = await fetchPlayer(id, locale);
  if (!result.ok) return pageMetadata({ locale, path: `/player/${id}`, title: fallback });
  const canonical = result.data.person.known_as ?? result.data.person.full_name;
  const name = result.data.person.localised_name ?? canonical;
  return pageMetadata({
    locale,
    path: `/player/${result.data.person.id}`,
    title: `${name} · Stadiomind`,
    description: say(locale, 'playerPage.metaDescription', { name: canonical }),
  });
}

/**
 * The player page (blueprint 5.3, T-037) in the Stadiomind Design System
 * (T-1500, D-271): the header with the photo in the club's ring, the name,
 * the club line and the facts (age, height, foot, each with its coverage),
 * follow and compare, then the tabs. The Overview is the canvas's Player
 * board: a main column with the newest season in tiles and the career by
 * season, and a side column (under it on a phone) with the last six
 * matches, the next match with his availability (T-1007), the news and the
 * data's freshness. Matches, Career and Stats hold the whole match log, the
 * clubs and the full record with cards, the season selector (`?season=`) on
 * Matches and Stats. Statistics we do not hold are named as such, never
 * shown as zero; every module carries its coverage. Its words come from the
 * catalogue (T-1304).
 */
export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const tab: PlayerTab = readPlayerTab(query);
  const overview = tab === 'overview';
  const cookie = await sessionCookieHeader();
  const [result, me, following, news, provider, transfers] = await Promise.all([
    fetchPlayer(id, locale),
    fetchMe(cookie),
    fetchFollowing(cookie),
    // The Overview's own module; the other tabs do not ask for it.
    overview ? fetchEntityNews('person', id, locale) : null,
    // The provider's season and career (T-1431): Career and Stats only.
    tab === 'career' || tab === 'stats' ? fetchPlayerProviderSeasons(id) : null,
    // The provider's list of his moves (T-1440): Career only.
    tab === 'career' ? fetchPlayerTransfers(id, locale) : null,
  ]);
  const providerSeasons = provider?.ok === true ? provider.data : null;
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main data-mode="data" className="pb-16">
        <div className="page-frame flex flex-col gap-4 pt-8">
          <h1 className="text-2xl font-semibold">
            <Translated locale={locale} message="playerPage.title" />
          </h1>
          <Notice tone="danger" data-testid="player-unreachable">
            <Translated locale={locale} message="playerPage.unreachable" />
          </Notice>
        </div>
      </main>
    );
  }
  const page = result.data;
  const p = page.person;
  const { timeZone } = await pageTimeZone(locale, me);
  const record = page.record.data ?? [];
  const seasons = seasonsOf(record);
  // The season filter belongs to Matches and Stats; elsewhere every season shows.
  const seasonId = tab === 'matches' || tab === 'stats' ? readSeasonFilter(query) : null;
  // A season is its label across competitions (T-1565): the id picks the label.
  const seasonLabel = seasonLabelOf(record, page.recent_matches.data ?? [], seasonId);
  const matches = filterMatches(page.recent_matches.data ?? [], seasonLabel);

  return (
    <main data-mode="data" className="pb-16" data-testid="player-page" data-tab={tab}>
      <JsonLd data={playerJsonLd(locale, page)} />
      <PlayerHeader
        page={page}
        locale={locale}
        tab={tab}
        seasonId={seasonId}
        follow={
          <EntityFollow
            locale={locale}
            entityType="person"
            entityId={p.id}
            signedIn={me !== null}
            following={following}
            followingKey="playerPage.follow.following"
            unreachableKey="playerPage.follow.unreachable"
          />
        }
      />
      <div className="page-frame flex flex-col gap-5 pt-6">
        {overview && (
          <div className="flex flex-wrap items-start gap-5 md:gap-6">
            <div className="flex min-w-0 flex-[999_1_40rem] flex-col gap-5 md:gap-6">
              <SeasonTilesPanel page={page} locale={locale} />
              {/* With no record the tiles already say so; a second empty table would repeat it (T-1569). */}
              {record.length > 0 && (
                <RecordPanel
                  page={page}
                  rows={record}
                  locale={locale}
                  full={false}
                  testId="career-record"
                />
              )}
            </div>
            <aside className="flex min-w-0 flex-[1_1_21rem] flex-col gap-5">
              <LastMatchesPanel
                page={page}
                matches={matches.slice(0, OVERVIEW_PLAYER_MATCHES)}
                locale={locale}
                timeZone={timeZone}
                footer={
                  matches.length > OVERVIEW_PLAYER_MATCHES ? (
                    <MoreLink href={playerTabHref(locale, p.id, 'matches')}>
                      <Translated locale={locale} message="playerPage.allMatches" />
                    </MoreLink>
                  ) : undefined
                }
              />
              <PlayerAvailabilitySection
                locale={locale}
                timeZone={timeZone}
                availability={page.availability}
                now={new Date()}
              />
              {/* The news module's own heading, set in the cards' style. */}
              <div className="rounded-card border border-default bg-surface p-4 [&_h2]:text-sm [&_h2]:font-extrabold">
                <EntityNews
                  locale={locale}
                  timeZone={timeZone}
                  news={news?.ok === true ? news.data : null}
                />
              </div>
              <Updated page={page} locale={locale} timeZone={timeZone} />
              {/* The dates, the kick-off and the checks above are in this zone (T-1566). */}
              <p className="text-xs text-muted" data-testid="player-zone">
                {zoneWords(locale, timeZone)}
              </p>
            </aside>
          </div>
        )}
        {tab === 'matches' && (
          <>
            <SeasonFilter
              page={page}
              locale={locale}
              tab="matches"
              seasons={seasons}
              current={seasonLabel}
            />
            <PlayerMatchesPanel page={page} matches={matches} locale={locale} timeZone={timeZone} />
          </>
        )}
        {tab === 'career' && (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <SpellsPanel page={page} locale={locale} />
              {providerSeasons !== null && (
                <ProviderCareerPanel data={providerSeasons} locale={locale} timeZone={timeZone} />
              )}
              {transfers?.ok === true && (
                <PlayerTransfersPanel data={transfers.data} locale={locale} timeZone={timeZone} />
              )}
            </div>
            <RecordPanel
              page={page}
              rows={record}
              locale={locale}
              full={false}
              testId="career-record"
            />
          </div>
        )}
        {tab === 'stats' && (
          <>
            <SeasonFilter
              page={page}
              locale={locale}
              tab="stats"
              seasons={seasons}
              current={seasonLabel}
            />
            <RecordPanel
              page={page}
              rows={filterRecord(record, seasonLabel)}
              locale={locale}
              full
              testId="record"
            />
            {providerSeasons !== null && (
              <ProviderSeasonsPanel data={providerSeasons} locale={locale} timeZone={timeZone} />
            )}
          </>
        )}
        {!overview && <Updated page={page} locale={locale} timeZone={timeZone} />}
      </div>
    </main>
  );
}

/**
 * When the player's data last changed (rule 4), in the Design System's
 * machine face: "● Last data update 24 Oct 2026, 14:24", or the sentence
 * that says nothing is stored yet.
 */
function Updated({
  page,
  locale,
  timeZone,
}: {
  page: PlayerPageData;
  locale: string;
  timeZone: string;
}) {
  return (
    <p className="font-mono text-xs text-caption" data-testid="player-updated">
      {page.last_updated_at === null ? (
        <Translated locale={locale} message="playerPage.noData" />
      ) : (
        <>
          <span aria-hidden="true">● </span>
          <Translated locale={locale} message="competitionPage.lastUpdate" />{' '}
          <Stamp iso={page.last_updated_at} locale={locale} timeZone={timeZone} />
        </>
      )}
    </p>
  );
}
