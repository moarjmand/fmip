import type { Metadata } from 'next';
import { formatNumber, intlLocale } from '@/i18n/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MatchViewing, TeamCompetitionSplits, TeamPageFixture } from '@fmip/contracts';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import {
  fetchEntityNews,
  fetchFounderFeed,
  fetchMe,
  fetchTeam,
  fetchViewingBatch,
} from '@/lib/api';
import { FORM_KEY, coverageText, formatFixtureDate, say } from '@/lib/competition';
import { pageMetadata, teamJsonLd } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import {
  METRIC_KEY,
  SPLIT_COLUMNS,
  SPLIT_COLUMN_KEY,
  SPLIT_RECORD_ROWS,
  SPLITS_FOOTNOTE,
  averageCell,
  afterTimeNote,
  averageNote,
  notSuppliedNote,
  contextLine,
  fromTeamSide,
  groupSquad,
  splitNotes,
} from '@/lib/team';
import { readTerritoryQuery, withTerritory } from '@/lib/viewing';
import { JsonLd } from '@/components/json-ld';
import { MinutesFigure } from '@/components/minutes-figure';
import { EntityNews } from '@/components/related-news';
import { Score } from '@/components/score';
import { Translated } from '@/components/translated';
import { ViewingPanel } from '@/components/viewing-panel';
import { Notice, inlineTargetClasses } from '@/components/ui';
import { Stamp } from '@/components/stamp';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const fallback = `${say(locale, 'teamPage.title')} · FMIP`;
  if (!UUID.test(id)) return { title: fallback, robots: { index: false, follow: false } };
  const result = await fetchTeam(id, locale);
  if (!result.ok) return pageMetadata({ locale, path: `/team/${id}`, title: fallback });
  const t = result.data.team;
  // The reader's name in the title; the canonical one in the description, so
  // both are on the page and neither pretends to be the other (T-303).
  return pageMetadata({
    locale,
    path: `/team/${t.id}`,
    title: `${t.localised_name ?? t.name} · FMIP`,
    description: say(locale, 'teamPage.metaDescription', { name: t.name }),
  });
}

/**
 * The team page (blueprint 5.2, T-036): overview with ground and followers,
 * the current competitions with the table context, next and previous match,
 * fixtures and results, the squad by position. Player names become links
 * with the player page (T-037). Its words come from the catalogue (T-1304).
 */
export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const cookie = await sessionCookieHeader();
  const [result, me, founder, news] = await Promise.all([
    fetchTeam(id, locale),
    fetchMe(cookie),
    fetchFounderFeed({ team: id, limit: 3 }),
    fetchEntityNews('team', id, locale),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="teamPage.title" />
        </h1>
        <Notice tone="danger" data-testid="team-unreachable">
          <Translated locale={locale} message="teamPage.unreachable" />
        </Notice>
      </main>
    );
  }
  const page = result.data;
  // Where each fixture can be watched (T-314): one batch for the list, in the
  // member's stored territory or the one a guest carried here on the link.
  const territory = readTerritoryQuery(query);
  const viewing =
    page.fixtures.length > 0
      ? await fetchViewingBatch(
          page.fixtures.slice(0, 100).map((f) => f.id),
          territory,
          cookie,
        )
      : null;
  const answers = new Map<string, MatchViewing>(
    viewing !== null && viewing.ok ? viewing.data.fixtures.map((v) => [v.fixture_id, v]) : [],
  );
  const guestTerritory = me === null ? territory : undefined;
  const t = page.team;
  const timeZone = me?.timezone ?? 'UTC';
  const teamHref = (teamId: string) => `/${locale}/team/${teamId}`;
  const competitionHref = (competitionId: string, seasonId: string) =>
    `/${locale}/competition/${competitionId}?season=${seasonId}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <JsonLd data={teamJsonLd(locale, t)} />
      <header className="flex flex-col gap-1" data-testid="team-header">
        <p className="text-sm text-muted">
          {t.country !== null ? `${t.country.name} · ` : ''}
          <Translated
            locale={locale}
            message={t.kind === 'national' ? 'teamPage.national' : 'teamPage.club'}
          />
          {t.gender === 'women' ? ` · ${say(locale, 'competitionPage.women')}` : ''}
          {t.founded_year !== null
            ? ` · ${say(locale, 'teamPage.founded', { year: yearText(locale, t.founded_year) })}`
            : ''}
        </p>
        <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
          {t.localised_name ?? t.name}
        </h1>
        {t.localised_name !== null && (
          // The name it is a name for. Shown, not hidden: a page that showed
          // only the localised name would have lost the entity (rule 1).
          <p className="text-sm text-muted" data-testid="canonical-name">
            {t.name}
          </p>
        )}
        <p className="text-sm text-muted">
          {t.venue !== null ? (
            `${
              t.venue.city !== null
                ? say(locale, 'teamPage.venueCity', { venue: t.venue.name, city: t.venue.city })
                : t.venue.name
            }${t.venue.capacity !== null ? ` · ${formatNumber(locale, t.venue.capacity)}` : ''}`
          ) : (
            <Translated locale={locale} message="teamPage.noGround" />
          )}
          {' · '}
          <span data-testid="followers">
            <Translated locale={locale} message="team.followerCount" count={page.followers} />
          </span>
        </p>
        <p className="text-sm" data-testid="manager">
          {page.manager.coach.data !== null && page.manager.lineup_fixture !== null ? (
            <>
              <span className="text-muted">
                <Translated locale={locale} message="team.manager.label" />
              </span>{' '}
              <span className="font-medium">{page.manager.coach.data.name}</span>{' '}
              <span className="text-xs text-muted">
                <Translated locale={locale} message="team.manager.named" />{' '}
                <Link
                  href={`/${locale}/match/${page.manager.lineup_fixture.id}`}
                  className="underline"
                >
                  <time dateTime={page.manager.lineup_fixture.kickoff_at}>
                    {formatFixtureDate(locale, page.manager.lineup_fixture.kickoff_at, timeZone)}
                  </time>
                </Link>
              </span>
            </>
          ) : (
            <span className="text-muted" data-testid="manager-none">
              <Translated
                locale={locale}
                message={
                  page.manager.lineup_fixture === null
                    ? 'team.manager.noLineup'
                    : 'team.manager.noCoach'
                }
              />
            </span>
          )}
        </p>
      </header>
      {founder.ok && (
        <FounderAnalysisFeed
          analyses={founder.data.analyses}
          locale={locale}
          timeZone={timeZone}
          heading={say(locale, 'teamPage.founderHeading', { name: t.name })}
        />
      )}

      <section className="flex flex-col gap-3" data-testid="competitions">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="teamPage.competitions" />
        </h2>
        {page.competitions.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="teamPage.noCompetition" />
          </p>
        ) : (
          page.competitions.map((entry) => (
            <div key={entry.season.id} className="flex flex-col gap-1" data-testid="competition">
              <h3 className="font-medium">
                <Link
                  href={competitionHref(entry.competition.id, entry.season.id)}
                  className="underline"
                >
                  {entry.competition.name}
                </Link>{' '}
                <span className="text-sm text-muted">{entry.season.label}</span>
                <span className="ms-2 text-xs font-normal uppercase text-muted">
                  {coverageText(locale, entry.context.coverage)}
                </span>
              </h3>
              {entry.context.data === null ? (
                <p className="text-sm text-muted">
                  <Translated locale={locale} message="teamPage.noPosition" />
                </p>
              ) : (
                <>
                  <p className="text-sm" data-testid="context-line">
                    {contextLine(locale, entry.context.data)}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {entry.context.data.rows.map((row) => (
                          <tr
                            key={row.team.id}
                            className={`border-b border-default ${
                              row.team.id === t.id ? 'font-semibold' : ''
                            }`}
                          >
                            <td className="py-1 pe-2 tabular-nums">
                              {formatNumber(locale, row.position)}
                            </td>
                            <td className="py-1 pe-2">
                              {row.team.id === t.id ? (
                                row.team.name
                              ) : (
                                <Link href={teamHref(row.team.id)} className="underline">
                                  {row.team.name}
                                </Link>
                              )}
                            </td>
                            <td className="py-1 pe-2 text-end tabular-nums">
                              {formatNumber(locale, row.played)}
                            </td>
                            <td className="py-1 pe-2 text-end tabular-nums">
                              {row.goal_difference > 0 ? '+' : ''}
                              {formatNumber(locale, row.goal_difference)}
                            </td>
                            <td className="py-1 text-end tabular-nums">
                              {formatNumber(locale, row.points)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3" data-testid="splits">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="teamPage.splits" />
        </h2>
        {page.splits.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="teamPage.noCompetition" />
          </p>
        ) : (
          <>
            {page.splits.map((entry) => (
              <SplitsTable key={entry.season.id} splits={entry} locale={locale} />
            ))}
            <p className="text-xs text-muted" data-testid="splits-footnote">
              <Translated locale={locale} message={SPLITS_FOOTNOTE} />
            </p>
          </>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2" data-testid="next-previous">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="player.availability.nextMatch" />
          </h2>
          {page.next_match === null ? (
            <p className="text-sm text-muted">
              <Translated locale={locale} message="teamPage.noNext" />
            </p>
          ) : (
            <MatchLine
              fixture={page.next_match}
              teamId={t.id}
              locale={locale}
              timeZone={timeZone}
            />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="teamPage.previousMatch" />
          </h2>
          {page.previous_match === null ? (
            <p className="text-sm text-muted">
              <Translated locale={locale} message="teamPage.noPrevious" />
            </p>
          ) : (
            <MatchLine
              fixture={page.previous_match}
              teamId={t.id}
              locale={locale}
              timeZone={timeZone}
            />
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2" data-testid="fixtures">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="competitionPage.fixtures" />
        </h2>
        {page.fixtures.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="teamPage.noFixtures" />
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-default">
            {page.fixtures.map((fixture) => (
              <li key={fixture.id} className="flex flex-col gap-1 py-2">
                <MatchLine fixture={fixture} teamId={t.id} locale={locale} timeZone={timeZone} />
                <ViewingPanel
                  variant="line"
                  locale={locale}
                  timeZone={timeZone}
                  viewing={answers.get(fixture.id) ?? null}
                  kickoffAt={fixture.kickoff_at}
                  status={fixture.status}
                  signedIn={me !== null}
                  href={withTerritory(`/${locale}/match/${fixture.id}`, guestTerritory)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="results">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="competitionPage.results" />
        </h2>
        {page.results.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="teamPage.noResults" />
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-default">
            {page.results.map((fixture) => (
              <li key={fixture.id} className="py-2">
                <MatchLine fixture={fixture} teamId={t.id} locale={locale} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="squad">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="teamPage.squad" />
          <span className="ms-2 text-xs font-normal uppercase text-muted">
            {coverageText(locale, page.squad.coverage)}
          </span>
        </h2>
        {page.squad.data === null ? (
          <p className="text-sm text-muted" data-testid="squad-empty">
            <Translated locale={locale} message="teamPage.noSquad" />
          </p>
        ) : (
          groupSquad(locale, page.squad.data).map((group) => (
            <div key={group.position} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-muted">{group.label}</h3>
              <ul className="flex flex-col text-sm">
                {group.players.map((player) => (
                  <li
                    key={player.person.id}
                    className="flex flex-wrap items-baseline gap-x-3"
                    data-testid="player"
                  >
                    <span className="w-8 text-end tabular-nums text-muted">
                      {player.shirt_number === null
                        ? '–'
                        : formatNumber(locale, player.shirt_number)}
                    </span>
                    <span className="grow">
                      <Link href={`/${locale}/player/${player.person.id}`} className="underline">
                        {player.person.name}
                      </Link>
                      {player.on_loan && (
                        <span className="ms-2 text-xs text-muted">
                          <Translated locale={locale} message="teamPage.onLoan" />
                        </span>
                      )}
                    </span>
                    <MinutesFigure locale={locale} minutes={player.minutes} className="text-sm" />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        {page.squad.data !== null && (
          <p className="text-xs text-muted" data-testid="squad-minutes-note">
            <Translated locale={locale} message="team.squad.minutes" />
          </p>
        )}
      </section>

      <EntityNews locale={locale} timeZone={timeZone} news={news.ok ? news.data : null} />

      <p className="text-xs text-muted">
        {page.last_updated_at === null ? (
          <Translated locale={locale} message="competitionPage.noData" />
        ) : (
          <>
            <Translated locale={locale} message="competitionPage.lastUpdate" />{' '}
            <Stamp iso={page.last_updated_at} locale={locale} timeZone={timeZone} />
          </>
        )}
      </p>
    </main>
  );
}

/**
 * One competition's figures (T-632): a row per figure, a column per split, so
 * the table stays four columns wide at 360px. Averages follow under their own
 * coverage; a short row says why rather than showing a partial figure.
 */
function SplitsTable({ splits, locale }: { splits: TeamCompetitionSplits; locale: string }) {
  const played = splits.total.played;
  const notes = splitNotes(locale, splits);
  // A figure the feed never supplied for these matches is named once under
  // the table, not given a row of dashes each (T-1205); rule 3 still holds.
  const shown = splits.averages.filter((a) => a.coverage !== 'not_supplied');
  const missing = splits.averages.filter((a) => a.coverage === 'not_supplied');
  return (
    <div className="flex flex-col gap-1" data-testid="splits-competition">
      <h3 className="font-medium">
        {splits.competition.name} <span className="text-sm text-muted">{splits.season.label}</span>
      </h3>
      {played === 0 ? (
        <p className="text-sm text-muted" data-testid="splits-empty">
          <Translated locale={locale} message="teamPage.splitsEmpty" />
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-default text-xs text-muted">
              <th scope="col" className="py-1 pe-2 text-start font-normal">
                <span className="sr-only">
                  <Translated locale={locale} message="teamPage.figure" />
                </span>
              </th>
              {SPLIT_COLUMNS.map((column) => (
                <th key={column} scope="col" className="py-1 ps-2 text-end font-normal">
                  <Translated locale={locale} message={SPLIT_COLUMN_KEY[column]} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SPLIT_RECORD_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-default">
                <th scope="row" className="py-1 pe-2 text-start font-normal">
                  <Translated locale={locale} message={row.label} />
                </th>
                {SPLIT_COLUMNS.map((column) => (
                  <td key={column} className="py-1 ps-2 text-end tabular-nums">
                    {formatNumber(locale, splits[column][row.key])}
                  </td>
                ))}
              </tr>
            ))}
            {shown.map((average) => {
              const note = averageNote(locale, average, played);
              return (
                <tr
                  key={average.metric}
                  className="border-b border-default"
                  data-testid="splits-average"
                  data-coverage={average.coverage}
                >
                  <th scope="row" className="py-1 pe-2 text-start font-normal">
                    <Translated locale={locale} message={METRIC_KEY[average.metric]} />
                    <span className="block text-xs text-muted">
                      {note === null ? say(locale, 'teamPage.perMatch') : note}
                    </span>
                  </th>
                  {SPLIT_COLUMNS.map((column) => (
                    <td key={column} className="py-1 ps-2 text-end align-top tabular-nums">
                      {averageCell(locale, average, column)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {played > 0 && missing.length > 0 && (
        <p className="text-xs text-muted" data-testid="splits-not-supplied">
          {notSuppliedNote(
            locale,
            missing.map((a) => say(locale, METRIC_KEY[a.metric])),
          )}
        </p>
      )}
      {notes.map((note) => (
        <p key={note} className="text-xs text-muted">
          {note}
        </p>
      ))}
    </div>
  );
}

/** A year as a reader reads it: the locale's digits, never grouped ("1899", not "1,899"). */
function yearText(locale: string, year: number): string {
  return new Intl.NumberFormat(intlLocale(locale), { useGrouping: false }).format(year);
}

function MatchLine({
  fixture,
  teamId,
  locale,
  timeZone,
}: {
  fixture: TeamPageFixture;
  teamId: string;
  locale: string;
  timeZone: string;
}) {
  const side = fromTeamSide(fixture, teamId);
  const note = afterTimeNote(locale, fixture, teamId);
  const opponentId = fixture.home.id === teamId ? fixture.away.id : fixture.home.id;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 text-sm" data-testid="match-line">
      {side.result !== null && (
        <span className="w-4 font-mono text-xs font-semibold" data-testid="result-letter">
          {say(locale, FORM_KEY[side.result])}
        </span>
      )}
      <span className="text-muted">
        <Translated locale={locale} message={side.home ? 'teamPage.home' : 'teamPage.away'} />
      </span>
      <Link href={`/${locale}/team/${opponentId}`} className={inlineTargetClasses('underline')}>
        {side.opponent}
      </Link>
      <Link
        href={`/${locale}/match/${fixture.id}`}
        className={inlineTargetClasses('font-medium underline')}
      >
        {fixture.score === null ? (
          <Translated locale={locale} message="viewing.matchCentre" />
        ) : (
          <Score home={fixture.score.home} away={fixture.score.away} />
        )}
      </Link>
      {note !== null && (
        <span className="text-xs text-muted" data-testid="after-time-note">
          {note}
        </span>
      )}
      <span className="text-xs text-muted">
        <time dateTime={fixture.kickoff_at}>
          {formatFixtureDate(locale, fixture.kickoff_at, timeZone)}
        </time>
        {' · '}
        <Link
          href={`/${locale}/competition/${fixture.competition.id}?season=${fixture.season.id}`}
          className={inlineTargetClasses('underline')}
        >
          {fixture.competition.short_name ?? fixture.competition.name}
        </Link>
      </span>
    </div>
  );
}
