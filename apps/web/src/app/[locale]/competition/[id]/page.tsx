import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type {
  AssistLeader,
  CardLeader,
  CleanSheetLeader,
  Covered,
  LeagueZones,
  SeasonFixture,
  TableRow,
} from '@fmip/contracts';
import { zoneOfPlace } from '@fmip/contracts';
import { FounderAnalysisFeed } from '@/components/founder-analysis';
import { KnockoutBracket } from '@/components/knockout-bracket';
import { EntityNews } from '@/components/related-news';
import { MinutesFigure } from '@/components/minutes-figure';
import { Translated } from '@/components/translated';
import { formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { fetchCompetition, fetchEntityNews, fetchFounderFeed, fetchMe } from '@/lib/api';
import {
  KIND_KEY,
  competitionQuery,
  coverageText,
  fixtureLine,
  formLine,
  formatFixtureDate,
  leadersHref,
  readMinMinutesParam,
  readSeasonParam,
  say,
  seasonHref,
  statusSuffix,
  ZONE_KEY,
  ZONE_MARK,
  zoneBand,
  zonesAbsentLine,
} from '@/lib/competition';
import { competitionJsonLd, pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { JsonLd } from '@/components/json-ld';
import { Notice } from '@/components/ui';
import { Stamp } from '@/components/stamp';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  const fallback = `${say(locale, 'competitionPage.title')} · FMIP`;
  if (!UUID.test(id)) return { title: fallback, robots: { index: false, follow: false } };
  const season = readSeasonParam(query);
  const result = await fetchCompetition(id, competitionQuery(season), locale);
  if (!result.ok) return pageMetadata({ locale, path: `/competition/${id}`, title: fallback });
  const c = result.data.competition;
  // The current season is the canonical page; an older season is its own URL.
  const path = result.data.season.is_current
    ? `/competition/${c.id}`
    : `/competition/${c.id}?season=${result.data.season.id}`;
  return pageMetadata({
    locale,
    path,
    title: `${c.localised_name ?? c.name} ${result.data.season.label} · FMIP`,
    description: say(locale, 'competitionPage.metaDescription', {
      name: c.name,
      season: result.data.season.label,
    }),
  });
}

/**
 * The competition page (blueprint 5.1, T-035): overview, season selector,
 * league table, results and fixtures, top scorers — each module with its
 * coverage from the API, an unreachable API said out loud. Team names become
 * links with the team page (T-036). A continental cup adds its knockout
 * rounds after the table (T-630). Its words come from the catalogue (T-1304).
 */
export default async function CompetitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const seasonParam = readSeasonParam(query);
  const minMinutes = readMinMinutesParam(query);
  const [result, me, founder, news] = await Promise.all([
    fetchCompetition(id, competitionQuery(seasonParam, minMinutes), locale),
    fetchMe(await sessionCookieHeader()),
    fetchFounderFeed({ competition: id, limit: 3 }),
    fetchEntityNews('competition', id, locale),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="competitionPage.title" />
        </h1>
        <Notice tone="danger" data-testid="competition-unreachable">
          <Translated locale={locale} message="competitionPage.unreachable" />
        </Notice>
      </main>
    );
  }
  const page = result.data;
  const timeZone = me?.timezone ?? 'UTC';
  const c = page.competition;
  const kind = KIND_KEY[c.kind];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <JsonLd data={competitionJsonLd(locale, page)} />
      <header className="flex flex-col gap-1" data-testid="competition-header">
        <p className="text-sm text-muted">
          {c.country !== null ? `${c.country.name} · ` : ''}
          {kind === undefined ? c.kind : <Translated locale={locale} message={kind} />}
          {c.tier !== null
            ? ` · ${say(locale, 'competitionPage.tier', { tier: formatNumber(locale, c.tier) })}`
            : ''}
          {c.gender === 'women' ? ` · ${say(locale, 'competitionPage.women')}` : ''}
        </p>
        <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
          {c.localised_name ?? c.name}
        </h1>
        {c.localised_name !== null && (
          <p className="text-sm text-muted" data-testid="canonical-name">
            {c.name}
          </p>
        )}
        <nav
          aria-label={say(locale, 'competitionPage.season')}
          className="mt-2 flex flex-wrap gap-1 text-sm"
          data-testid="seasons"
        >
          {page.seasons.map((season) => (
            <Link
              key={season.id}
              href={seasonHref(locale, c.id, season)}
              aria-current={season.id === page.season.id ? 'true' : undefined}
              className={`rounded px-2 py-1 ${
                season.id === page.season.id ? 'bg-surface-raised font-semibold' : 'underline'
              }`}
            >
              {season.is_current
                ? say(locale, 'competitionPage.seasonCurrent', { season: season.label })
                : season.label}
            </Link>
          ))}
        </nav>
      </header>
      {founder.ok && (
        <FounderAnalysisFeed
          analyses={founder.data.analyses}
          locale={locale}
          timeZone={timeZone}
          heading={say(locale, 'competitionPage.founderHeading', { name: c.name })}
        />
      )}

      <Module
        locale={locale}
        timeZone={timeZone}
        title={<Translated locale={locale} message="competitionPage.table" />}
        module={page.table}
        testId="table"
      >
        {(rows) => (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default">
                  <th scope="col" className="py-1 pe-2 text-start">
                    #
                  </th>
                  <th scope="col" className="py-1 pe-2 text-start">
                    <Translated locale={locale} message="competitionPage.col.team" />
                  </th>
                  {TABLE_COLUMNS.map((c) => (
                    <th
                      key={c.label}
                      scope="col"
                      className={cellClass(c.phone, 'py-1 pe-2 text-end')}
                    >
                      <abbr title={say(locale, c.title)}>{say(locale, c.label)}</abbr>
                    </th>
                  ))}
                  <th scope="col" className="py-1 pe-2 text-end">
                    <abbr title={say(locale, 'competitionPage.col.pointsTitle')}>
                      {say(locale, 'competitionPage.col.points')}
                    </abbr>
                  </th>
                  <th scope="col" className="hidden py-1 text-start md:table-cell">
                    <Translated locale={locale} message="competitionPage.col.form" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.team.id} className="border-b border-default" data-testid="table-row">
                    <PlaceCell locale={locale} position={row.position} zones={page.zones} />
                    <td className="py-1 pe-2">
                      <Link
                        href={`/${locale}/team/${row.team.id}`}
                        className="font-medium hover:underline focus-visible:underline"
                      >
                        {row.team.name}
                      </Link>
                    </td>
                    {TABLE_COLUMNS.map((c) => (
                      <td
                        key={c.label}
                        className={cellClass(c.phone, 'py-1 pe-2 text-end tabular-nums')}
                      >
                        {formatNumber(locale, c.value(row))}
                      </td>
                    ))}
                    <td className="py-1 pe-2 text-end font-semibold tabular-nums">
                      {formatNumber(locale, row.points)}
                    </td>
                    <td className="hidden py-1 font-mono text-xs whitespace-nowrap md:table-cell">
                      {formLine(locale, row.form)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ZoneLegend locale={locale} zones={page.zones} />
          </div>
        )}
      </Module>

      {page.bracket !== null && (
        <KnockoutBracket bracket={page.bracket} locale={locale} timeZone={timeZone} />
      )}

      <section className="flex flex-col gap-2" data-testid="results">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="competitionPage.results" />
        </h2>
        {page.results.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="competitionPage.noResults" />
          </p>
        ) : (
          <FixtureList fixtures={page.results} locale={locale} timeZone={timeZone} />
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="fixtures">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="competitionPage.fixtures" />
        </h2>
        {page.fixtures.length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="competitionPage.noFixtures" />
          </p>
        ) : (
          <FixtureList fixtures={page.fixtures} locale={locale} timeZone={timeZone} />
        )}
      </section>

      <Module
        locale={locale}
        timeZone={timeZone}
        title={<Translated locale={locale} message="competitionPage.topScorers" />}
        module={page.leaders}
        testId="leaders"
        empty={
          page.leaders_filter.min_minutes !== null && page.leaders.data !== null ? (
            <Translated locale={locale} message="competition.leaders.noneReach" />
          ) : undefined
        }
        intro={
          <>
            <nav
              aria-labelledby="leaders-filter"
              className="flex flex-wrap items-baseline gap-1 text-sm"
              data-testid="leaders-filter"
            >
              <span id="leaders-filter" className="me-1 text-muted">
                <Translated locale={locale} message="competition.leaders.filter" />
              </span>
              {[null, ...page.leaders_filter.presets].map((floor) => {
                const current = floor === page.leaders_filter.min_minutes;
                return (
                  <Link
                    key={floor ?? 'any'}
                    href={leadersHref(locale, c.id, page.season, floor)}
                    aria-current={current ? 'true' : undefined}
                    className={`rounded px-2 py-1 ${current ? 'bg-surface-raised font-semibold' : 'underline'}`}
                  >
                    {floor === null ? (
                      <Translated locale={locale} message="competition.leaders.anyMinutes" />
                    ) : (
                      <Translated locale={locale} message="minutes.total" count={floor} />
                    )}
                  </Link>
                );
              })}
            </nav>
            {page.leaders_filter.min_minutes !== null && (
              <p className="text-sm text-muted" data-testid="leaders-floor">
                <Translated
                  locale={locale}
                  message="competition.leaders.floor"
                  count={page.leaders_filter.min_minutes}
                />
                {page.leaders_filter.unproven > 0 && (
                  <>
                    {' '}
                    <Translated
                      locale={locale}
                      message="competition.leaders.unproven"
                      count={page.leaders_filter.unproven}
                    />
                  </>
                )}
              </p>
            )}
          </>
        }
      >
        {(leaders) => (
          <ol className="flex flex-col gap-1 text-sm">
            {leaders.map((leader, index) => (
              <li
                key={`${leader.person.id}:${leader.team?.id ?? ''}`}
                className="flex flex-wrap items-baseline gap-x-3"
              >
                <span className="w-6 tabular-nums text-muted">
                  {formatNumber(locale, index + 1)}
                </span>
                <span className="grow">
                  <Link href={`/${locale}/player/${leader.person.id}`} className="underline">
                    {leader.person.name}
                  </Link>
                  {leader.team !== null && (
                    <span className="ms-2 text-xs text-muted">{leader.team.name}</span>
                  )}
                  <MinutesFigure
                    locale={locale}
                    minutes={leader.minutes}
                    className="ms-2 text-xs text-muted"
                  />
                </span>
                <span className="tabular-nums font-semibold">
                  {formatNumber(locale, leader.goals)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Module>

      {BOARDS.map((board) => {
        const boardModule = page.boards[board.key] as Covered<BoardPlayer[]>;
        const floor = page.leaders_filter.min_minutes;
        const unproven = page.boards.unproven[board.key];
        return (
          <Module
            locale={locale}
            timeZone={timeZone}
            key={board.key}
            title={<Translated locale={locale} message={board.title} />}
            module={boardModule}
            testId={board.testId}
            empty={
              boardModule.data === null ? undefined : floor !== null ? (
                <Translated locale={locale} message="competition.boards.noneReach" />
              ) : (
                <Translated locale={locale} message={board.none} />
              )
            }
            intro={
              floor !== null && unproven > 0 ? (
                <p className="text-sm text-muted" data-testid={`${board.testId}-unproven`}>
                  <Translated
                    locale={locale}
                    message="competition.boards.unproven"
                    count={unproven}
                  />
                </p>
              ) : undefined
            }
          >
            {(rows) => (
              <ol className="flex flex-col gap-1 text-sm">
                {rows.map((row, index) => (
                  <li
                    key={`${row.person.id}:${row.team?.id ?? ''}`}
                    className="flex flex-wrap items-baseline gap-x-3"
                  >
                    <span className="w-6 tabular-nums text-muted">
                      {formatNumber(locale, index + 1)}
                    </span>
                    <span className="grow">
                      <Link href={`/${locale}/player/${row.person.id}`} className="underline">
                        {row.person.name}
                      </Link>
                      {row.team !== null && (
                        <span className="ms-2 text-xs text-muted">{row.team.name}</span>
                      )}
                      <MinutesFigure
                        locale={locale}
                        minutes={row.minutes}
                        className="ms-2 text-xs text-muted"
                      />
                    </span>
                    <BoardFigure locale={locale} row={row} board={board.key} />
                  </li>
                ))}
              </ol>
            )}
          </Module>
        );
      })}

      <EntityNews locale={locale} timeZone={timeZone} news={news.ok ? news.data : null} />

      <section className="flex flex-col gap-2" data-testid="coverage">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="competitionPage.coverage" />
        </h2>
        {Object.keys(page.coverage).length === 0 ? (
          <p className="text-sm text-muted">
            <Translated locale={locale} message="competitionPage.noCoverage" />
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-xs">
            {Object.entries(page.coverage).map(([module, state]) => (
              <li key={module} className="rounded border border-default px-2 py-1">
                {module.replace('_', ' ')}: {coverageText(locale, state)}
              </li>
            ))}
          </ul>
        )}
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
      </section>
    </main>
  );
}

/** The boards beyond goals (T-943), in the order the page shows them. */
const BOARDS = [
  {
    key: 'assists',
    testId: 'board-assists',
    title: 'competition.boards.assists',
    none: 'competition.boards.noAssists',
  },
  {
    key: 'clean_sheets',
    testId: 'board-clean-sheets',
    title: 'competition.boards.cleanSheets',
    none: 'competition.boards.noCleanSheets',
  },
  {
    key: 'cards',
    testId: 'board-cards',
    title: 'competition.boards.cards',
    none: 'competition.boards.noCards',
  },
] as const;

type BoardPlayer = AssistLeader | CleanSheetLeader | CardLeader;

/** A board row's own figure: assists, clean sheets over starts in goal, or reds and yellows. */
function BoardFigure({
  locale,
  row,
  board,
}: {
  locale: string;
  row: BoardPlayer;
  board: (typeof BOARDS)[number]['key'];
}) {
  if (board === 'assists' && 'assists' in row) {
    return <span className="tabular-nums font-semibold">{formatNumber(locale, row.assists)}</span>;
  }
  if (board === 'clean_sheets' && 'clean_sheets' in row) {
    return (
      <span className="flex items-baseline gap-2">
        <span className="text-xs text-muted">
          <Translated
            locale={locale}
            message="competition.boards.startsInGoal"
            count={row.starts_in_goal}
          />
        </span>
        <span className="tabular-nums font-semibold">{formatNumber(locale, row.clean_sheets)}</span>
      </span>
    );
  }
  if ('red_cards' in row) {
    return (
      <span className="flex items-baseline gap-3 tabular-nums">
        <span>
          <Translated locale={locale} message="competition.boards.red" count={row.red_cards} />
        </span>
        <span>
          <Translated
            locale={locale}
            message="competition.boards.yellow"
            count={row.yellow_cards}
          />
        </span>
      </span>
    );
  }
  return null;
}

/**
 * The table's figure columns (T-1203). On a phone the table keeps position,
 * team, played, goal difference and points, the columns a reader ranks by;
 * won, drawn, lost and the goals, and the form, appear from the tablet width
 * up. At 375 px all eleven columns squeezed the form into a stack of letters
 * and wrapped every club's name onto two lines. The abbreviations are the
 * catalogue's (T-1304): Persian uses short words that fit a phone column, the
 * whole word in the title.
 */
const TABLE_COLUMNS: {
  label: MessageKey;
  title: MessageKey;
  phone: boolean;
  value: (row: TableRow) => number;
}[] = [
  {
    label: 'competitionPage.col.played',
    title: 'competitionPage.col.playedTitle',
    phone: true,
    value: (r) => r.played,
  },
  {
    label: 'competitionPage.col.won',
    title: 'competitionPage.col.wonTitle',
    phone: false,
    value: (r) => r.won,
  },
  {
    label: 'competitionPage.col.drawn',
    title: 'competitionPage.col.drawnTitle',
    phone: false,
    value: (r) => r.drawn,
  },
  {
    label: 'competitionPage.col.lost',
    title: 'competitionPage.col.lostTitle',
    phone: false,
    value: (r) => r.lost,
  },
  {
    label: 'competitionPage.col.goalsFor',
    title: 'competitionPage.col.goalsForTitle',
    phone: false,
    value: (r) => r.goals_for,
  },
  {
    label: 'competitionPage.col.goalsAgainst',
    title: 'competitionPage.col.goalsAgainstTitle',
    phone: false,
    value: (r) => r.goals_against,
  },
  {
    label: 'competitionPage.col.goalDifference',
    title: 'competitionPage.col.goalDifferenceTitle',
    phone: true,
    value: (r) => r.goal_difference,
  },
];

function cellClass(phone: boolean, base: string): string {
  return phone ? base : `hidden sm:table-cell ${base}`;
}

function Module<T>({
  title,
  module,
  testId,
  intro,
  empty,
  children,
  locale,
  timeZone,
}: {
  title: React.ReactNode;
  module: Covered<T[]>;
  /** For the "Updated" line, in the viewer's zone (T-1201). */
  locale: string;
  timeZone: string;
  testId: string;
  /** Above the list: a filter, and what it did (T-824). */
  intro?: React.ReactNode;
  /** What an empty list means when it is a list, e.g. nobody reached a floor (T-824). */
  empty?: React.ReactNode;
  children: (data: T[]) => React.ReactNode;
}) {
  return (
    <section id={testId} className="flex flex-col gap-2 scroll-mt-4" data-testid={testId}>
      <h2 className="text-lg font-semibold">
        {title}
        <span className="ms-2 text-xs font-normal uppercase text-muted">
          {coverageText(locale, module.coverage)}
        </span>
      </h2>
      {intro}
      {module.data === null || module.data.length === 0 ? (
        <p className="text-sm text-muted" data-testid={`${testId}-empty`}>
          {empty !== undefined ? (
            empty
          ) : module.coverage === 'delayed' ? (
            <Translated locale={locale} message="competitionPage.delayed" />
          ) : (
            <Translated locale={locale} message="competitionPage.notSupplied" />
          )}
        </p>
      ) : (
        children(module.data)
      )}
      {module.last_updated_at !== null && (
        <p className="text-xs text-muted">
          <Translated locale={locale} message="competitionPage.updated" />{' '}
          <Stamp iso={module.last_updated_at} locale={locale} timeZone={timeZone} />
        </p>
      )}
    </section>
  );
}

function FixtureList({
  fixtures,
  locale,
  timeZone,
}: {
  fixtures: SeasonFixture[];
  locale: string;
  timeZone: string;
}) {
  return (
    <ul className="flex flex-col divide-y divide-default text-sm">
      {fixtures.map((fixture) => (
        <li
          key={fixture.id}
          className="flex flex-wrap items-baseline gap-x-3 py-2"
          data-testid="fixture"
        >
          <Link href={`/${locale}/match/${fixture.id}`} className="font-medium underline">
            {fixtureLine(locale, fixture)}
          </Link>
          <span className="text-xs text-muted">
            <time dateTime={fixture.kickoff_at}>
              {formatFixtureDate(locale, fixture.kickoff_at, timeZone)}
            </time>
            {fixture.stage !== null ? ` · ${fixture.stage.name}` : ''}
            {fixture.round !== null ? ` · ${fixture.round}` : ''}
            {statusSuffix(locale, fixture.status)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The place, with its zone's start-edge mark and its name for a screen
 * reader (T-1167, D-171). A place in no zone, or a season with none listed,
 * keeps a blank edge of the same width so the numbers stay in line.
 */
function PlaceCell({
  locale,
  position,
  zones,
}: {
  locale: string;
  position: number;
  zones: LeagueZones;
}) {
  const zone = zones.state === 'listed' ? zoneOfPlace(zones.zones, position) : null;
  return (
    <td
      className={`border-s-4 py-1 ps-1 pe-2 tabular-nums ${zone === null ? 'border-s-transparent' : ZONE_MARK[zone.kind]}`}
      data-zone={zone?.kind}
    >
      {formatNumber(locale, position)}
      {zone !== null && <span className="sr-only"> ({say(locale, ZONE_KEY[zone.kind])})</span>}
    </td>
  );
}

/** What the marks mean, where they come from, and what is not listed (rule 3). */
function ZoneLegend({ locale, zones }: { locale: string; zones: LeagueZones }) {
  const absent = zonesAbsentLine(locale, zones);
  if (zones.state !== 'listed') {
    return absent === null ? null : (
      <p className="mt-2 text-xs text-muted" data-testid="table-zones-absent">
        {absent}
      </p>
    );
  }
  const separator = say(locale, 'competitionPage.list.separator');
  return (
    <div className="mt-2 flex flex-col gap-1 text-xs text-muted" data-testid="table-zones">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {zones.zones.map((z) => (
          <li key={`${z.kind}-${z.from}`} className={`border-s-4 ps-2 ${ZONE_MARK[z.kind]}`}>
            {say(locale, ZONE_KEY[z.kind])}: {zoneBand(locale, z)}
          </li>
        ))}
      </ul>
      <p>
        <Translated locale={locale} message="competitionPage.zones.lead" />
        {zones.sources.map((url, i) => (
          <span key={url}>
            {i === 0 ? ' (' : separator}
            <a href={url} className="underline" rel="noopener noreferrer">
              {say(locale, 'competitionPage.zones.source', { number: formatNumber(locale, i + 1) })}
            </a>
            {i === zones.sources.length - 1 ? ')' : ''}
          </span>
        ))}
        . <Translated locale={locale} message="competitionPage.zones.cupWinners" />
        {zones.complete ? (
          ''
        ) : (
          <>
            {' '}
            <Translated locale={locale} message="competitionPage.zones.incomplete" />
          </>
        )}
      </p>
      {zones.note !== null && <p>{zones.note}</p>}
    </div>
  );
}
