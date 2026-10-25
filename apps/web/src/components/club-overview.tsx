import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import type { SquadPlayer, TeamPage, TeamPageFixture } from '@fmip/contracts';
import { Coverage, MoreLink, When, zoneWords } from '@/components/competition-page';
import { EntityImage } from '@/components/entity-image';
import { Score, ScorePair } from '@/components/score';
import { FORM_LOOK } from '@/components/standings-table';
import { Translated } from '@/components/translated';
import { inlineTargetClasses } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { formatDate, formatNumber, localDigits } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { plural } from '@/i18n/messages';
import { FORM_KEY, listText, pageLocale, say } from '@/lib/competition';
import { POSITION_KEY as PLAYER_POSITION_KEY } from '@/lib/player';
import {
  COMING_UP,
  OVERVIEW_SQUAD,
  RECENT_RESULTS,
  SPLIT_COLUMNS,
  SPLIT_COLUMN_KEY,
  SPLIT_RECORD_ROWS,
  afterTimeNote,
  fromTeamSide,
  homeAwayLean,
  mainStanding,
  recordFigures,
  squadIncomplete,
  squadInOrder,
  splitNotes,
  teamTabHref,
  topScorerEntry,
} from '@/lib/team';
import { tabHref } from '@/lib/competition-overview';
import { withTerritory } from '@/lib/viewing';

/**
 * The club page's Overview in the Stadiomind Club board (T-1499, D-267):
 * the main column's recent results and home and away record, the side
 * column's matches coming up, top scorer, squad and the table around the
 * club, and the band's standing. Each module states its coverage where the
 * API declares one (rule 3) and a figure it does not count is a sentence,
 * never a zero; no club colour appears here (D-204). The next match is
 * `NextMatchCard`; the page (`app/[locale]/team/[id]/page.tsx`) composes.
 */

/** A card of the Club board: a heading row over a body, flush lists inside. */
function Card({
  testId,
  title,
  aside,
  children,
  flush = false,
}: {
  testId: string;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  /** A list or a table that runs to the card's edges. */
  flush?: boolean;
}) {
  const headingId = `${testId}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className="flex min-w-0 flex-col overflow-hidden rounded-card border border-default bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-default px-4 py-3 sm:px-5">
        <h2
          id={headingId}
          className="text-base font-extrabold font-stretch-semi-expanded md:text-lg"
        >
          {title}
        </h2>
        {aside !== undefined && aside !== null && (
          <span className="inline-flex flex-wrap items-center gap-2 text-xs text-caption">
            {aside}
          </span>
        )}
      </div>
      <div className={cx('flex min-w-0 flex-col', flush ? '' : 'gap-3 px-4 py-4 sm:px-5')}>
        {children}
      </div>
    </section>
  );
}

/** "v Fulham" at home, "at Barcelona" away: the club's side of a match in a word. */
function opponentText(locale: string, fixture: TeamPageFixture, teamId: string): string {
  const side = fromTeamSide(fixture, teamId);
  const other = side.home ? fixture.away : fixture.home;
  return say(locale, side.home ? 'teamPage.versus' : 'teamPage.at', {
    opponent: other.short_name ?? other.name,
  });
}

const RESULT_WORD: Record<'W' | 'D' | 'L', MessageKey> = {
  W: 'teamPage.row.won',
  D: 'teamPage.row.drawn',
  L: 'teamPage.row.lost',
};

/** The result from the club's side as a letter tile (the letter is the meaning, not the colour). */
function ResultTile({ locale, result }: { locale: string; result: 'W' | 'D' | 'L' }) {
  return (
    <span
      data-result={result}
      data-testid="result-letter"
      className={`inline-grid size-6 shrink-0 place-items-center rounded-md text-xs font-extrabold ${FORM_LOOK[result]}`}
    >
      {say(locale, FORM_KEY[result])}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The band's standing
// ---------------------------------------------------------------------------

/**
 * Where the club stands, at the end of the band (T-1499): the competition,
 * the place as an ordinal in the narrow display face and the points from
 * the matches on that table. Nothing when no table places the club; "Around
 * them" says so.
 */
export function BandStanding({ page, locale }: { page: TeamPage; locale: string }) {
  const standing = mainStanding(page.competitions, page.team.id);
  if (standing === null) return null;
  const { entry, context, played } = standing;
  return (
    <div className="flex flex-col gap-1 sm:items-end" data-testid="band-standing">
      <span className="text-sm text-muted">
        {entry.competition.short_name ?? entry.competition.name}
      </span>
      <span className="font-sans text-display-2 leading-none font-black font-stretch-condensed">
        {plural(pageLocale(locale), 'team.position', context.position).text}
      </span>
      <span className="text-sm text-muted">
        {played === null
          ? say(locale, 'teamPage.contextLine', {
              position: plural(pageLocale(locale), 'team.position', context.position).text,
              total: formatNumber(locale, context.total),
              points: formatNumber(locale, context.points),
            })
          : say(locale, 'teamPage.standing.points', {
              points: formatNumber(locale, context.points),
              played: formatNumber(locale, played),
            })}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent results
// ---------------------------------------------------------------------------

/**
 * "Recent results" (T-1499): the last `RECENT_RESULTS` across competitions,
 * each a link to its match -- the day, the result tile, the opponent with
 * "v" or "at" and "home", the score from the club's side (its goals first,
 * at the line's start, D-267) and the competition. On a phone the day and
 * the competition go under the opponent, and the form leads the card.
 */
export function RecentResults({
  page,
  locale,
  timeZone,
}: {
  page: TeamPage;
  locale: string;
  timeZone: string;
}) {
  const teamId = page.team.id;
  const shown = page.results.slice(0, RECENT_RESULTS);
  const sides = shown.map((fixture) => ({ fixture, side: fromTeamSide(fixture, teamId) }));
  const letters = sides.flatMap(({ side }) => (side.result === null ? [] : [side.result]));
  return (
    <Card
      testId="recent-results"
      title={<Translated locale={locale} message="teamPage.recentResults" />}
      aside={<Translated locale={locale} message="teamPage.allCompetitions" />}
      flush
    >
      {shown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted sm:px-5" data-testid="recent-results-empty">
          <Translated locale={locale} message="teamPage.noResults" />
        </p>
      ) : (
        <>
          {letters.length > 0 && (
            <div
              role="img"
              aria-label={say(locale, 'teamPage.form', {
                results: listText(
                  locale,
                  letters.map((letter) => say(locale, RESULT_WORD[letter])),
                ),
              })}
              className="flex gap-1.5 border-b border-default px-4 py-3 md:hidden"
              data-testid="form-strip"
            >
              {letters.map((letter, i) => (
                <ResultTile key={i} locale={locale} result={letter} />
              ))}
            </div>
          )}
          <ul className="flex flex-col">
            {sides.map(({ fixture, side }) => {
              const note = afterTimeNote(locale, fixture, teamId);
              const day = formatDate(locale, fixture.kickoff_at, timeZone, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              });
              const competition = fixture.competition.short_name ?? fixture.competition.name;
              const mine = fixture.score === null ? null : side.home ? 'home' : 'away';
              return (
                <li
                  key={fixture.id}
                  className="border-b border-default last:border-b-0"
                  data-testid="match-line"
                >
                  <Link
                    href={`/${locale}/match/${fixture.id}`}
                    className="grid min-h-13 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm hover:bg-surface-raised focus-visible:bg-surface-raised sm:px-5 md:grid-cols-[5.5rem_auto_minmax(0,1fr)_4rem_minmax(0,11rem)]"
                    data-testid="match-link"
                  >
                    <time dateTime={fixture.kickoff_at} className="hidden text-caption md:block">
                      {day}
                    </time>
                    {side.result === null ? (
                      <span aria-hidden="true" className="size-6" />
                    ) : (
                      <ResultTile locale={locale} result={side.result} />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="min-w-0 truncate font-semibold">
                        <bdi>{opponentText(locale, fixture, teamId)}</bdi>
                        {side.home && (
                          <span className="font-normal text-caption">
                            {' '}
                            <Translated locale={locale} message="teamPage.atHome" />
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-caption md:hidden">
                        <bdi>{competition}</bdi> · {day}
                        {note !== null && ` · ${note}`}
                      </span>
                      {note !== null && (
                        <span
                          className="hidden text-xs text-caption md:block"
                          data-testid="after-time-note"
                        >
                          {note}
                        </span>
                      )}
                    </span>
                    {fixture.score === null || mine === null ? (
                      <span className="text-caption">–</span>
                    ) : (
                      <Score
                        home={mine === 'home' ? fixture.score.home : fixture.score.away}
                        away={mine === 'home' ? fixture.score.away : fixture.score.home}
                        locale={locale}
                        className="font-sans text-base font-black font-stretch-condensed tabular-nums"
                        testId="match-score"
                      />
                    )}
                    <bdi className="hidden truncate text-caption md:block">{competition}</bdi>
                  </Link>
                </li>
              );
            })}
          </ul>
          {page.results.length > shown.length && (
            <div className="border-t border-default px-4 sm:px-5">
              <MoreLink href={teamTabHref(locale, teamId, 'results')}>
                <Translated locale={locale} message="teamPage.allResults" />
              </MoreLink>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Home and away
// ---------------------------------------------------------------------------

/**
 * "Premier League so far" (T-1499): the home and away record of one
 * competition, a row per split and a column per figure on a desktop (the
 * Club board's table, scrolling in its own box when narrow), tiles and the
 * sentence on which side the club does better on a phone (ClubPhone). The
 * figures are the API's, counted from the stored finished matches (T-632).
 */
export function RecordPanel({ page, locale }: { page: TeamPage; locale: string }) {
  const figures = recordFigures(page.competitions, page.splits);
  if (figures === null) {
    return (
      <Card testId="record" title={<Translated locale={locale} message="teamPage.splits" />}>
        <p className="text-sm text-muted" data-testid="record-empty">
          <Translated locale={locale} message="teamPage.noCompetition" />
        </p>
      </Card>
    );
  }
  const { entry, splits } = figures;
  const competition = entry.competition.short_name ?? entry.competition.name;
  const n = (value: number) => formatNumber(locale, value);
  const counted = splits !== null && splits.total.played > 0;
  const lean = counted ? homeAwayLean(locale, splits) : null;
  return (
    <Card
      testId="record"
      title={say(locale, 'teamPage.soFar', { competition })}
      aside={localDigits(locale, entry.season.label)}
    >
      {!counted ? (
        <p className="text-sm text-muted" data-testid="record-empty">
          <Translated locale={locale} message="teamPage.splitsEmpty" />
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 md:hidden" data-testid="record-tiles">
            <span className="flex flex-col">
              <b className="font-sans text-display-1 leading-none font-black font-stretch-condensed tabular-nums">
                <ScorePair locale={locale}>
                  {n(splits.total.won)}-{n(splits.total.drawn)}-{n(splits.total.lost)}
                </ScorePair>
              </b>
              <span className="text-xs text-caption">
                <Translated locale={locale} message="teamPage.tile.record" />
              </span>
            </span>
            <span className="flex flex-col">
              <b className="font-sans text-display-1 leading-none font-black font-stretch-condensed tabular-nums">
                <ScorePair locale={locale}>
                  {n(splits.total.goals_for)}:{n(splits.total.goals_against)}
                </ScorePair>
              </b>
              <span className="text-xs text-caption">
                <Translated locale={locale} message="teamPage.tile.goals" />
              </span>
            </span>
            <span className="flex flex-col">
              <b className="font-sans text-display-1 leading-none font-black font-stretch-condensed tabular-nums">
                {n(splits.total.clean_sheets)}
              </b>
              <span className="text-xs text-caption">
                <Translated locale={locale} message="teamPage.row.cleanSheets" />
              </span>
            </span>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[32rem] text-center text-sm tabular-nums">
              <caption className="sr-only">
                {say(locale, 'teamPage.record.caption', {
                  name: page.team.localised_name ?? page.team.name,
                  competition,
                })}
              </caption>
              <thead>
                <tr className="text-xs text-caption">
                  <th scope="col" className="py-2 text-start font-semibold">
                    <span className="sr-only">
                      <Translated locale={locale} message="teamPage.figure" />
                    </span>
                  </th>
                  {SPLIT_RECORD_ROWS.map((row) => (
                    <th key={row.key} scope="col" className="px-1 py-2 font-semibold">
                      <Translated locale={locale} message={row.label} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SPLIT_COLUMNS.map((column) => (
                  <tr
                    key={column}
                    className={cx(
                      'border-t border-default',
                      column === 'total' && 'font-extrabold',
                    )}
                    data-testid={`record-${column}`}
                  >
                    <th scope="row" className="py-2.5 text-start font-bold">
                      <Translated locale={locale} message={SPLIT_COLUMN_KEY[column]} />
                    </th>
                    {SPLIT_RECORD_ROWS.map((row) => (
                      <td key={row.key} className="px-1 py-2.5">
                        {n(splits[column][row.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lean !== null && (
            <p className="text-sm text-muted" data-testid="record-lean">
              {lean}
            </p>
          )}
          {splitNotes(locale, splits).map((note) => (
            <p key={note} className="text-xs text-muted">
              {note}
            </p>
          ))}
          <MoreLink href={teamTabHref(locale, page.team.id, 'stats')}>
            <Translated locale={locale} message="teamPage.splits" />
          </MoreLink>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The side column
// ---------------------------------------------------------------------------

/**
 * "Coming up" (T-1499): the `COMING_UP` matches after the next one (the
 * card above has that one), each with its day and kick-off in the reader's
 * zone, "v" or "at" the opponent, and the competition. A club with none
 * after the next says so.
 */
export function ComingUp({
  page,
  locale,
  timeZone,
  territory,
  freshness,
}: {
  page: TeamPage;
  locale: string;
  timeZone: string;
  territory: string | undefined;
  /** Beside the heading: how fresh a live list is (rule 4). */
  freshness: ReactNode;
}) {
  const teamId = page.team.id;
  const nextId = page.next_match?.id;
  const later = page.fixtures.filter((f) => f.id !== nextId);
  const shown = later.slice(0, COMING_UP);
  return (
    <Card
      testId="coming-up"
      title={<Translated locale={locale} message="teamPage.comingUp" />}
      aside={freshness}
      flush
    >
      {shown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted sm:px-5" data-testid="coming-up-empty">
          <Translated locale={locale} message="teamPage.noFixtures" />
        </p>
      ) : (
        <>
          <ul className="flex flex-col">
            {shown.map((fixture) => (
              <li
                key={fixture.id}
                className="border-b border-default last:border-b-0"
                data-testid="match-line"
              >
                <Link
                  href={`/${locale}/match/${fixture.id}`}
                  className="grid min-h-13 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2.5 px-4 py-2 text-sm hover:bg-surface-raised focus-visible:bg-surface-raised"
                  data-testid="match-link"
                >
                  <When fixture={fixture} locale={locale} timeZone={timeZone} />
                  <span className="min-w-0">
                    <b className="font-bold">
                      <bdi>{opponentText(locale, fixture, teamId)}</bdi>
                    </b>{' '}
                    <span className="text-caption">
                      · <bdi>{fixture.competition.short_name ?? fixture.competition.name}</bdi>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-4 pt-2 text-xs text-muted">{zoneWords(locale, timeZone)}</p>
          {later.length > shown.length && (
            <div className="px-4">
              <MoreLink href={withTerritory(teamTabHref(locale, teamId, 'fixtures'), territory)}>
                <Translated locale={locale} message="teamPage.allFixtures" />
              </MoreLink>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * The top scorer (T-1499, T-1528, D-266): the club's leading scorer in one
 * competition from our recorded goals, with the photo we hold, everyone level
 * on the most named. With no goal recorded, or no goals sent, a sentence
 * under the badge -- never a scorer on nought.
 */
export function TopScorerCard({ page, locale }: { page: TeamPage; locale: string }) {
  const entry = topScorerEntry(page);
  const competition =
    entry === null ? null : (entry.competition.short_name ?? entry.competition.name);
  const scorers = entry?.scorers.data ?? null;
  const state = entry?.scorers.coverage ?? 'not_supplied';
  return (
    <section
      aria-labelledby="top-scorer-heading"
      className="flex min-w-0 items-center gap-3.5 rounded-card border border-default bg-surface p-4"
      data-testid="top-scorer"
      data-coverage={state}
    >
      {scorers !== null && scorers.length > 0 && (
        <EntityImage
          media={scorers[0]!.person.photo}
          kind="photo"
          name={scorers[0]!.person.name}
          size={48}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="top-scorer-heading"
            className="text-xs font-extrabold text-caption uppercase ltr:tracking-wider"
          >
            {competition === null ? (
              <Translated locale={locale} message="teamPage.topScorer.title" />
            ) : (
              say(locale, 'teamPage.topScorer', { competition })
            )}
          </h2>
          <Coverage locale={locale} state={state} />
        </div>
        {scorers !== null && scorers.length > 0 ? (
          <>
            <p className="text-base font-extrabold">
              {scorers.map((s, i) => (
                <span key={s.person.id}>
                  {i > 0 && say(locale, 'competitionPage.list.separator')}
                  <Link
                    href={`/${locale}/player/${s.person.id}`}
                    className={inlineTargetClasses('hover:underline')}
                  >
                    <bdi>{s.person.name}</bdi>
                  </Link>
                </span>
              ))}
            </p>
            <p className="text-sm text-muted" data-testid="top-scorer-goals">
              {plural(pageLocale(locale), 'teamPage.topScorer.goals', scorers[0]!.goals).text}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted" data-testid="top-scorer-none">
            {entry === null || scorers === null
              ? say(locale, 'teamPage.topScorer.notSupplied')
              : say(locale, 'teamPage.topScorer.none', { competition: competition! })}
          </p>
        )}
      </div>
    </section>
  );
}

/** "Goalkeeper · No. 1", or what we have of it. */
function squadRole(locale: string, player: SquadPlayer): string {
  return [
    ...(player.position !== null ? [say(locale, PLAYER_POSITION_KEY[player.position])] : []),
    ...(player.shirt_number !== null
      ? [say(locale, 'playerPage.shirt', { number: formatNumber(locale, player.shirt_number) })]
      : []),
  ].join(' · ');
}

/**
 * The squad in the side column (T-1499): its coverage on the badge, the
 * first `OVERVIEW_SQUAD` in the Squad tab's order as links, and the whole
 * squad a tab away; with none on record the sentence the board shows, under
 * the badge.
 */
export function SquadCard({ page, locale }: { page: TeamPage; locale: string }) {
  const players = page.squad.data;
  const ordered = players === null ? [] : squadInOrder(locale, players);
  const shown = ordered.slice(0, OVERVIEW_SQUAD);
  return (
    <Card
      testId="squad"
      title={<Translated locale={locale} message="teamPage.squad" />}
      aside={<Coverage locale={locale} state={page.squad.coverage} />}
      flush={players !== null && players.length > 0}
    >
      {players === null || players.length === 0 ? (
        <p className="text-sm text-muted" data-testid="squad-empty">
          <Translated locale={locale} message="teamPage.noSquad" />
        </p>
      ) : (
        <>
          {squadIncomplete(players) && (
            <p className="px-4 pt-3 text-xs text-muted" data-testid="squad-incomplete">
              <Translated locale={locale} message="teamPage.squadIncomplete" />
            </p>
          )}
          <ul className="flex flex-col">
            {shown.map((player) => (
              <li
                key={player.person.id}
                className="border-b border-default last:border-b-0"
                data-testid="player"
              >
                <Link
                  href={`/${locale}/player/${player.person.id}`}
                  className="flex min-h-touch items-center justify-between gap-3 px-4 py-1.5 text-sm hover:bg-surface-raised focus-visible:bg-surface-raised"
                >
                  <b className="min-w-0 truncate font-semibold">
                    <bdi>{player.person.name}</bdi>
                  </b>
                  <span className="shrink-0 text-xs text-caption">
                    {squadRole(locale, player)}
                    {player.on_loan && (
                      <>
                        {squadRole(locale, player) !== '' && ' · '}
                        <Translated locale={locale} message="teamPage.onLoan" />
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-4">
            <MoreLink href={teamTabHref(locale, page.team.id, 'squad')}>
              <Translated locale={locale} message="teamPage.wholeSquad" count={ordered.length} />
            </MoreLink>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * "Around them" (T-1499, from T-036): the club's row on each current table
 * and its neighbours -- place, name, points -- its own row tinted and in
 * bold, the table's coverage on the badge, the whole table a link away. A
 * competition whose table does not place the club says so.
 */
export function AroundThem({ page, locale }: { page: TeamPage; locale: string }) {
  const teamId = page.team.id;
  return (
    <div className="flex flex-col gap-5" data-testid="competitions">
      {page.competitions.map((entry) => {
        const competition = entry.competition.short_name ?? entry.competition.name;
        const context = entry.context.data;
        const rows = context?.rows ?? [];
        return (
          <section
            key={entry.season.id}
            id={`table-${entry.season.id}`}
            aria-labelledby={`table-${entry.season.id}-heading`}
            className="flex min-w-0 flex-col overflow-hidden rounded-card border border-default bg-surface"
            data-testid="competition"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-4 py-3">
              <h2 id={`table-${entry.season.id}-heading`} className="text-sm font-extrabold">
                <Translated locale={locale} message="teamPage.aroundThem" />
                <span className="font-semibold text-caption">
                  {' · '}
                  <bdi>{competition}</bdi>
                </span>
              </h2>
              <Coverage locale={locale} state={entry.context.coverage} />
            </div>
            {context === null || rows.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">
                <Translated locale={locale} message="teamPage.noPosition" />
              </p>
            ) : (
              <table className="w-full text-sm tabular-nums">
                <caption className="sr-only">
                  {say(locale, 'teamPage.places', {
                    competition,
                    from: formatNumber(locale, rows[0]!.position),
                    to: formatNumber(locale, rows[rows.length - 1]!.position),
                  })}
                </caption>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">
                      <Translated locale={locale} message="competitionPage.col.team" />
                    </th>
                    <th scope="col">
                      <Translated locale={locale} message="competitionPage.col.pointsTitle" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const own = row.team.id === teamId;
                    return (
                      <tr
                        key={row.team.id}
                        className={cx(
                          'border-b border-default last:border-b-0',
                          own && 'bg-accent/10 font-extrabold',
                        )}
                        aria-current={own ? 'true' : undefined}
                      >
                        <td className="w-10 py-2 ps-4 text-caption">
                          {formatNumber(locale, row.position)}
                        </td>
                        <td className="py-2 pe-2">
                          {own ? (
                            <bdi>{row.team.name}</bdi>
                          ) : (
                            <Link
                              href={`/${locale}/team/${row.team.id}`}
                              className={inlineTargetClasses('hover:underline')}
                            >
                              <bdi>{row.team.name}</bdi>
                            </Link>
                          )}
                        </td>
                        <td className="py-2 pe-4 text-end font-black font-stretch-condensed">
                          {formatNumber(locale, row.points)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="border-t border-default px-4">
              <MoreLink href={tabHref(locale, entry.competition.id, entry.season, 'table')}>
                <Translated locale={locale} message="competitionPage.fullTable" />
              </MoreLink>
            </div>
          </section>
        );
      })}
    </div>
  );
}
