import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import type {
  MatchViewing,
  SquadPlayer,
  TeamCompetition,
  TeamCompetitionSplits,
  TeamPage,
  TeamPageFixture,
} from '@fmip/contracts';
import { stillToPlay } from '@fmip/contracts';
import { BandStanding } from '@/components/club-overview';
import { Coverage, MoreLink, Panel, When, zoneWords } from '@/components/competition-page';
import { EntityBand } from '@/components/entity-band';
import { SectionTabs } from '@/components/ui/section-tabs';
import { EntityImage } from '@/components/entity-image';
import { MinutesFigure } from '@/components/minutes-figure';
import { Score } from '@/components/score';
import { FORM_LOOK } from '@/components/standings-table';
import { Translated } from '@/components/translated';
import { ViewingPanel } from '@/components/viewing-panel';
import { inlineTargetClasses } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { formatDate, formatNumber, intlLocale, localDigits } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { FORM_KEY, say } from '@/lib/competition';
import { POSITION_KEY as PLAYER_POSITION_KEY, dayText } from '@/lib/player';
import {
  METRIC_KEY,
  OVERVIEW_SQUAD,
  SPLIT_COLUMNS,
  SPLIT_COLUMN_KEY,
  SPLIT_RECORD_ROWS,
  SPLITS_FOOTNOTE,
  type TeamTab,
  TEAM_TABS,
  afterTimeNote,
  averageCell,
  averageNote,
  fromTeamSide,
  groupSquad,
  notSuppliedNote,
  splitNotes,
  squadIncomplete,
  squadInOrder,
  teamTabHref,
} from '@/lib/team';
import { withTerritory } from '@/lib/viewing';

/**
 * The club page (T-1386, D-204; the Stadiomind Club board since T-1499,
 * D-276): the band, the tabs and the modules of the tabs beyond the
 * Overview, whose own modules are in `club-overview.tsx`. Every module
 * states its coverage with a `CoverageBadge` where the API declares one
 * (rule 3); a figure the API does not count is left out with a sentence,
 * never drawn as a zero. The page (`app/[locale]/team/[id]/page.tsx`)
 * fetches and composes.
 */

// ---------------------------------------------------------------------------
// The band
// ---------------------------------------------------------------------------

const TAB_KEY: Record<TeamTab, MessageKey> = {
  overview: 'competitionPage.tab.overview',
  fixtures: 'competitionPage.tab.fixtures',
  results: 'competitionPage.tab.results',
  squad: 'teamPage.squad',
  stats: 'competitionPage.tab.stats',
};

/** A year as a reader reads it: the locale's digits, never grouped ("1899", not "1,899"). */
export function yearText(locale: string, year: number): string {
  return new Intl.NumberFormat(intlLocale(locale), { useGrouping: false }).format(year);
}

/**
 * The club's band (T-1386, T-1499): the crest, country, kind and founding
 * year, the name in the wide display face, the canonical name when a
 * localised one is shown, the ground, the followers and the manager, where
 * the club stands at the end, then the tabs with follow. The club's colour
 * fills it when one is known, and nowhere else (see `EntityBand`).
 */
export function ClubBand({
  page,
  locale,
  timeZone,
  tab,
  follow,
  territory,
}: {
  page: TeamPage;
  locale: string;
  timeZone: string;
  tab: TeamTab;
  follow: ReactNode;
  /** A guest's territory, kept on the tab links so the Fixtures tab still answers in it. */
  territory: string | undefined;
}) {
  const t = page.team;
  const name = t.localised_name ?? t.name;
  const eyebrow = [
    ...(t.country !== null ? [t.country.name] : []),
    say(locale, t.kind === 'national' ? 'teamPage.national' : 'teamPage.club'),
    ...(t.gender === 'women' ? [say(locale, 'competitionPage.women')] : []),
    ...(t.founded_year !== null
      ? [say(locale, 'teamPage.founded', { year: yearText(locale, t.founded_year) })]
      : []),
  ];
  return (
    <EntityBand
      testId="team-header"
      colour={t.colour}
      media={
        <span className="grid size-16 shrink-0 place-items-center rounded-card border border-default bg-canvas md:size-24">
          <EntityImage media={t.crest} kind="crest" name={name} size={48} aboveFold />
        </span>
      }
      aside={<BandStanding page={page} locale={locale} />}
      eyebrow={eyebrow.join(' · ')}
      title={name}
      details={
        <>
          {t.localised_name !== null && (
            // The name it is a name for. Shown, not hidden: a page that showed
            // only the localised name would have lost the entity (rule 1).
            <p className="text-sm text-muted" data-testid="canonical-name">
              {t.name}
            </p>
          )}
          <p className="mt-2 text-sm font-medium text-muted">
            {/* Each part isolated (T-1561): a ground named in Latin letters on
                /fa would otherwise pull the separators and figures into its
                own direction and scramble the line. */}
            {t.venue !== null ? (
              <>
                <bdi data-testid="team-ground">
                  {t.venue.city !== null
                    ? say(locale, 'teamPage.venueCity', { venue: t.venue.name, city: t.venue.city })
                    : t.venue.name}
                </bdi>
                {t.venue.capacity !== null && (
                  <>
                    {' · '}
                    <bdi>{formatNumber(locale, t.venue.capacity)}</bdi>
                  </>
                )}
              </>
            ) : page.fixture_ground != null ? (
              // No ground recorded: where this season's home matches were
              // played, said to come from them (T-1394, D-209).
              <span data-testid="fixture-ground">
                {say(locale, 'teamPage.groundFromFixtures', {
                  venue:
                    page.fixture_ground.venue.city !== null
                      ? say(locale, 'teamPage.venueCity', {
                          venue: page.fixture_ground.venue.name,
                          city: page.fixture_ground.venue.city,
                        })
                      : page.fixture_ground.venue.name,
                  matches: formatNumber(locale, page.fixture_ground.matches),
                  total: formatNumber(locale, page.fixture_ground.home_matches),
                })}
              </span>
            ) : (
              <Translated locale={locale} message="teamPage.noGround" />
            )}
            {' · '}
            <bdi data-testid="followers">
              <Translated locale={locale} message="team.followerCount" count={page.followers} />
            </bdi>
          </p>
          <Manager page={page} locale={locale} timeZone={timeZone} />
        </>
      }
      actions={follow}
      tabs={
        <SectionTabs
          label={say(locale, 'competitionPage.sections')}
          testId="team-tab"
          tabs={TEAM_TABS.map((key) => ({
            key,
            href: withTerritory(teamTabHref(locale, t.id, key), territory),
            label: say(locale, TAB_KEY[key]),
            current: key === tab,
          }))}
        />
      }
    />
  );
}

/**
 * The head coach and the manager (T-944, T-1439). The head coach is the
 * provider's coaches list's current one (D-230), linked to his page, with
 * the day his spell started. The line-up's coach (D-119) is shown when there
 * is no head coach, or when it names someone else -- the list may be behind a
 * change, and the page says so rather than choosing.
 */
function Manager({ page, locale, timeZone }: { page: TeamPage; locale: string; timeZone: string }) {
  const head = page.head_coach?.data ?? null;
  const { coach, lineup_fixture: fixture } = page.manager;
  return (
    <>
      {head !== null && (
        <p className="text-sm" data-testid="head-coach">
          <span className="text-muted">
            <Translated locale={locale} message="team.headCoach.label" />
          </span>{' '}
          <Link
            href={`/${locale}/coach/${head.person.id}`}
            className={inlineTargetClasses('font-semibold hover:underline')}
          >
            <bdi>{head.person.name}</bdi>
          </Link>
          {head.since !== null && (
            <span className="text-xs text-muted">
              {' · '}
              {say(locale, 'team.headCoach.since', { date: dayText(locale, head.since) })}
            </span>
          )}
        </p>
      )}
      {head !== null && head.lineup_disagrees && coach.data !== null && (
        <p className="text-xs text-muted" data-testid="head-coach-disagrees">
          {say(locale, 'team.headCoach.lineupDisagrees', { name: coach.data.name })}
        </p>
      )}
      {head === null && (
        <p className="text-sm" data-testid="manager">
          {coach.data !== null && fixture !== null ? (
            <>
              <span className="text-muted">
                <Translated locale={locale} message="team.manager.label" />
              </span>{' '}
              <Link
                href={`/${locale}/coach/${coach.data.id}`}
                className={inlineTargetClasses('font-semibold hover:underline')}
              >
                <bdi>{coach.data.name}</bdi>
              </Link>{' '}
              <span className="text-xs text-muted">
                <Translated locale={locale} message="team.manager.named" />{' '}
                <Link
                  href={`/${locale}/match/${fixture.id}`}
                  className={inlineTargetClasses('underline')}
                >
                  {/* The day alone, as the head coach's "since" reads it (T-1562):
                      the full stamp came out in a scrambled order in Persian. */}
                  <time dateTime={fixture.kickoff_at}>
                    {formatDate(locale, fixture.kickoff_at, timeZone, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </time>
                </Link>
              </span>
            </>
          ) : (
            <span className="text-muted" data-testid="manager-none">
              <Translated
                locale={locale}
                message={fixture === null ? 'team.manager.noLineup' : 'team.manager.noCoach'}
              />
            </span>
          )}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

/**
 * One of the club's matches as a row (T-1386): when, the two sides with the
 * score between them -- home first from the inline start, so on `/fa` the
 * home side and its goals are on the right (D-193) -- the competition and
 * any "aet" or shoot-out from the club's side under them, and the result
 * from the club's side as a letter tile (none for a match not played).
 */
export function TeamMatchRow({
  fixture,
  teamId,
  locale,
  timeZone,
  below,
}: {
  fixture: TeamPageFixture;
  teamId: string;
  locale: string;
  timeZone: string;
  /** Under the row: where to watch it (the Fixtures tab). */
  below?: ReactNode;
}) {
  const side = fromTeamSide(fixture, teamId);
  const note = afterTimeNote(locale, fixture, teamId);
  const home = fixture.home.short_name ?? fixture.home.name;
  const away = fixture.away.short_name ?? fixture.away.name;
  return (
    <li className="border-b border-default py-2.5 last:border-b-0" data-testid="match-line">
      <div className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2.5">
        <When fixture={fixture} locale={locale} timeZone={timeZone} />
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/${locale}/match/${fixture.id}`}
            className="flex min-h-7 min-w-0 items-center gap-2 text-sm font-semibold hover:underline focus-visible:underline"
            data-testid="match-link"
          >
            {/* Each side's crest before its name (T-1617). */}
            <span className="hidden sm:contents">
              <EntityImage media={fixture.home.crest} kind="crest" name={home} size={20} />
            </span>
            <bdi className={cx('min-w-0 truncate', side.home && 'font-extrabold')}>{home}</bdi>
            {fixture.score === null ? (
              <span className="shrink-0 font-medium text-caption">
                {say(locale, 'competitionPage.v')}
              </span>
            ) : (
              <Score
                home={fixture.score.home}
                away={fixture.score.away}
                locale={locale}
                separator=" – "
                className="shrink-0 font-sans text-base font-black font-stretch-condensed tabular-nums"
                testId="match-score"
              />
            )}
            <span className="hidden sm:contents">
              <EntityImage media={fixture.away.crest} kind="crest" name={away} size={20} />
            </span>
            <bdi className={cx('min-w-0 truncate', !side.home && 'font-extrabold')}>{away}</bdi>
          </Link>
          <span className="text-xs text-muted">
            <Link
              href={`/${locale}/competition/${fixture.competition.id}?season=${fixture.season.id}`}
              className={inlineTargetClasses('gap-1.5 hover:underline')}
            >
              {/* The competition's logo, only where the API sent one (T-1617). */}
              {fixture.competition.logo !== undefined && (
                <EntityImage
                  media={fixture.competition.logo}
                  kind="logo"
                  name={fixture.competition.name}
                  size={20}
                />
              )}
              {fixture.competition.short_name ?? fixture.competition.name}
            </Link>
            {note !== null && (
              <span data-testid="after-time-note">
                {' · '}
                {note}
              </span>
            )}
          </span>
        </div>
        {side.result !== null ? (
          <span
            data-result={side.result}
            data-testid="result-letter"
            className={`inline-grid size-6 place-items-center rounded-md text-xs font-extrabold ${FORM_LOOK[side.result]}`}
          >
            {say(locale, FORM_KEY[side.result])}
          </span>
        ) : (
          <span aria-hidden="true" className="size-6" />
        )}
      </div>
      {below}
    </li>
  );
}

/**
 * The Fixtures tab (T-1386): every match to come from the club's side, each
 * with where it can be watched in the reader's territory (T-314), as the
 * page always had it.
 */
export function FixturesPanel({
  page,
  locale,
  timeZone,
  viewing,
  signedIn,
  territory,
  freshness,
}: {
  page: TeamPage;
  locale: string;
  timeZone: string;
  viewing: Map<string, MatchViewing>;
  signedIn: boolean;
  territory: string | undefined;
  freshness: ReactNode;
}) {
  return (
    <Panel
      testId="fixtures"
      title={<Translated locale={locale} message="competitionPage.fixtures" />}
      aside={freshness}
    >
      {page.fixtures.length === 0 ? (
        <p className="text-sm text-muted" data-testid="fixtures-empty">
          <Translated locale={locale} message="teamPage.noFixtures" />
        </p>
      ) : (
        <>
          <ul className="flex flex-col">
            {page.fixtures.map((fixture) => (
              <TeamMatchRow
                key={fixture.id}
                fixture={fixture}
                teamId={page.team.id}
                locale={locale}
                timeZone={timeZone}
                // Where to watch it, for a match still to play (T-1560): a
                // cancelled or postponed one has nothing to tune in to.
                below={
                  stillToPlay(fixture.status) && (
                    <div className="ps-[5.625rem]">
                      <ViewingPanel
                        variant="line"
                        locale={locale}
                        timeZone={timeZone}
                        viewing={viewing.get(fixture.id) ?? null}
                        kickoffAt={fixture.kickoff_at}
                        status={fixture.status}
                        signedIn={signedIn}
                        href={withTerritory(`/${locale}/match/${fixture.id}`, territory)}
                      />
                    </div>
                  )
                }
              />
            ))}
          </ul>
          <p className="text-xs text-muted">{zoneWords(locale, timeZone)}</p>
        </>
      )}
    </Panel>
  );
}

/** The Results tab (T-1386): every result on record, newest first, from the club's side. */
export function ResultsPanel({
  page,
  locale,
  timeZone,
}: {
  page: TeamPage;
  locale: string;
  timeZone: string;
}) {
  return (
    <Panel
      testId="results"
      title={<Translated locale={locale} message="competitionPage.results" />}
    >
      {page.results.length === 0 ? (
        <p className="text-sm text-muted" data-testid="results-empty">
          <Translated locale={locale} message="teamPage.noResults" />
        </p>
      ) : (
        <ul className="flex flex-col">
          {page.results.map((fixture) => (
            <TeamMatchRow
              key={fixture.id}
              fixture={fixture}
              teamId={page.team.id}
              locale={locale}
              timeZone={timeZone}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** "No match scheduled", in the next-match card's place, so the page never opens on a blank. */
export function NoNextMatch({ locale }: { locale: string }) {
  return (
    <Panel
      testId="next-match-none"
      title={<Translated locale={locale} message="nextMatch.title" />}
    >
      <p className="text-sm text-muted">
        <Translated locale={locale} message="teamPage.noNext" />
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The season
// ---------------------------------------------------------------------------

/** "Pro League · 2026/27", the season in the reader's digits. */
function competitionSeason(
  locale: string,
  entry: Pick<TeamCompetition, 'competition' | 'season'>,
): string {
  return `${entry.competition.short_name ?? entry.competition.name} · ${localDigits(
    locale,
    entry.season.label,
  )}`;
}

// ---------------------------------------------------------------------------
// The squad
// ---------------------------------------------------------------------------

/** "Goalkeeper · No. 1", or what we have of it; nothing when we have neither. */
function squadRole(locale: string, player: SquadPlayer): string {
  return [
    ...(player.position !== null ? [say(locale, PLAYER_POSITION_KEY[player.position])] : []),
    ...(player.shirt_number !== null
      ? [say(locale, 'playerPage.shirt', { number: formatNumber(locale, player.shirt_number) })]
      : []),
  ].join(' · ');
}

/** One player as a card: photo or initials, name, position and shirt, loan, and minutes where asked. */
function SquadCard({
  player,
  locale,
  minutes,
}: {
  player: SquadPlayer;
  locale: string;
  minutes: boolean;
}) {
  const role = squadRole(locale, player);
  return (
    <li data-testid="player">
      <Link
        href={`/${locale}/player/${player.person.id}`}
        className="flex min-h-touch items-center gap-3 rounded-tile bg-surface-raised p-2.5 hover:underline focus-visible:underline"
      >
        <EntityImage media={player.person.photo} kind="photo" name={player.person.name} size={48} />
        <span className="flex min-w-0 flex-col">
          <b className="truncate font-bold">{player.person.name}</b>
          {(role !== '' || player.on_loan) && (
            <span className="text-xs text-muted">
              {role}
              {player.on_loan && (
                <>
                  {role !== '' && ' · '}
                  <Translated locale={locale} message="teamPage.onLoan" />
                </>
              )}
            </span>
          )}
          {minutes && (
            <MinutesFigure
              locale={locale}
              minutes={player.minutes}
              className="text-xs text-muted"
            />
          )}
        </span>
      </Link>
    </li>
  );
}

const SQUAD_GRID = 'grid grid-cols-[repeat(auto-fit,minmax(min(13rem,100%),1fr))] gap-2.5';

/**
 * The squad (T-1386, from T-036 and T-824). The Overview shows the first
 * `OVERVIEW_SQUAD` in the Squad tab's order as cards; the tab groups everyone
 * by position with their minutes. The badge is the squad's coverage, and a
 * sentence says when positions or shirt numbers are missing for some players
 * rather than leaving a gap that looks like a fact.
 */
export function SquadPanel({
  page,
  locale,
  full,
}: {
  page: TeamPage;
  locale: string;
  /** The Squad tab: every player by position, with minutes. */
  full: boolean;
}) {
  const players = page.squad.data;
  const ordered = players === null ? [] : squadInOrder(locale, players);
  const shown = full ? ordered : ordered.slice(0, OVERVIEW_SQUAD);
  return (
    <Panel
      testId="squad"
      title={<Translated locale={locale} message="teamPage.squad" />}
      aside={<Coverage locale={locale} state={page.squad.coverage} />}
    >
      {players === null ? (
        <p className="text-sm text-muted" data-testid="squad-empty">
          <Translated locale={locale} message="teamPage.noSquad" />
        </p>
      ) : (
        <>
          {squadIncomplete(players) && (
            <p className="text-sm text-muted" data-testid="squad-incomplete">
              <Translated locale={locale} message="teamPage.squadIncomplete" />
            </p>
          )}
          {full ? (
            groupSquad(locale, players).map((group) => (
              <div key={group.position} className="flex flex-col gap-2" data-testid="squad-group">
                <h3 className="border-b border-strong pb-1.5 text-xs font-extrabold text-muted uppercase ltr:tracking-wider">
                  {group.label}
                </h3>
                <ul className={SQUAD_GRID}>
                  {group.players.map((player) => (
                    <SquadCard key={player.person.id} player={player} locale={locale} minutes />
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <ul className={SQUAD_GRID}>
              {shown.map((player) => (
                <SquadCard key={player.person.id} player={player} locale={locale} minutes={false} />
              ))}
            </ul>
          )}
          {full && (
            <p className="text-xs text-muted" data-testid="squad-minutes-note">
              <Translated locale={locale} message="team.squad.minutes" />
            </p>
          )}
          {!full && ordered.length > shown.length && (
            <MoreLink href={teamTabHref(locale, page.team.id, 'squad')}>
              <Translated locale={locale} message="teamPage.wholeSquad" count={ordered.length} />
            </MoreLink>
          )}
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Home and away (the Stats tab)
// ---------------------------------------------------------------------------

/**
 * Home and away (T-632): a panel per competition, a row per figure, a column
 * per split, so the table stays four columns wide at 360px. Averages follow
 * under their own coverage; a short row says why rather than showing a
 * partial figure; a figure never supplied is named once under the table.
 */
export function SplitsPanels({ page, locale }: { page: TeamPage; locale: string }) {
  return (
    <div className="flex flex-col gap-5" data-testid="splits">
      {page.splits.length === 0 ? (
        <Panel
          testId="splits-none"
          title={<Translated locale={locale} message="teamPage.splits" />}
        >
          <p className="text-sm text-muted">
            <Translated locale={locale} message="teamPage.noCompetition" />
          </p>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            {page.splits.map((entry) => (
              <SplitsPanel key={entry.season.id} splits={entry} locale={locale} />
            ))}
          </div>
          <p className="text-xs text-muted" data-testid="splits-footnote">
            <Translated locale={locale} message={SPLITS_FOOTNOTE} />
          </p>
        </>
      )}
    </div>
  );
}

function SplitsPanel({ splits, locale }: { splits: TeamCompetitionSplits; locale: string }) {
  const played = splits.total.played;
  const notes = splitNotes(locale, splits);
  // A figure the feed never supplied for these matches is named once under
  // the table, not given a row of dashes each (T-1205); rule 3 still holds.
  const shown = splits.averages.filter((a) => a.coverage !== 'not_supplied');
  const missing = splits.averages.filter((a) => a.coverage === 'not_supplied');
  return (
    <Panel
      testId="splits-competition"
      id={`splits-${splits.season.id}`}
      title={`${say(locale, 'teamPage.splits')} · ${competitionSeason(locale, splits)}`}
    >
      {played === 0 ? (
        <p className="text-sm text-muted" data-testid="splits-empty">
          <Translated locale={locale} message="teamPage.splitsEmpty" />
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-strong text-xs text-muted">
              <th scope="col" className="py-1.5 pe-2 text-start font-bold">
                <span className="sr-only">
                  <Translated locale={locale} message="teamPage.figure" />
                </span>
              </th>
              {SPLIT_COLUMNS.map((column) => (
                <th key={column} scope="col" className="py-1.5 ps-2 text-end font-bold">
                  <Translated locale={locale} message={SPLIT_COLUMN_KEY[column]} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SPLIT_RECORD_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-default">
                <th scope="row" className="py-1.5 pe-2 text-start font-medium">
                  <Translated locale={locale} message={row.label} />
                </th>
                {SPLIT_COLUMNS.map((column) => (
                  <td key={column} className="py-1.5 ps-2 text-end tabular-nums">
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
                  className="border-b border-default last:border-b-0"
                  data-testid="splits-average"
                  data-coverage={average.coverage}
                >
                  <th scope="row" className="py-1.5 pe-2 text-start font-medium">
                    <Translated locale={locale} message={METRIC_KEY[average.metric]} />
                    <span className="block text-xs font-normal text-muted">
                      {note === null ? say(locale, 'teamPage.perMatch') : note}
                    </span>
                  </th>
                  {SPLIT_COLUMNS.map((column) => (
                    <td key={column} className="py-1.5 ps-2 text-end align-top tabular-nums">
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
    </Panel>
  );
}
