import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import type { CompetitionPage, CoverageState, Covered, SeasonFixture } from '@fmip/contracts';
import { ACCURACY_MINIMUM_MATCHES } from '@fmip/contracts';
import { Coverage, LiveFreshness, ZoneLegend, zoneWords } from '@/components/competition-page';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import type { FreshnessWords } from '@/components/freshness-stamp';
import { MatchesFreshness } from '@/components/matches-freshness';
import { MessageText } from '@/components/message-text';
import { ModelVersions } from '@/components/model-version';
import { NAME } from '@/components/score-card';
import { RowForecast } from '@/components/score-card-forecast';
import { Stamp } from '@/components/stamp';
import { StandingsTable } from '@/components/standings-table';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { formatDate, formatGregorianMonth, formatNumber } from '@/i18n/format';
import { type MessageKey, message } from '@/i18n/messages';
import { STATUS_KEY, pageLocale, say } from '@/lib/competition';
import {
  type LeagueModel,
  MATCH_VIEWS,
  type MatchDay,
  type MatchList,
  type MatchView,
  type SeasonRound,
  dayKey,
  matchesHref,
  roundDays,
  stillToCome,
} from '@/lib/competition-overview';
import { awaitingUpdate } from '@/lib/live';
import { pickCardPath, pickOpen } from '@/lib/pick';
import type { CardForecast } from '@/lib/score-card-products';
import { filled, formatFixed, formatPercent } from '@/lib/words';
import { type ScoresWords, scoresWords } from '@/lib/words-server';

/**
 * The competition page's modules in the Stadiomind design (T-1498, D-274):
 * a surface card with its name in the wide cut and a hairline under it, and
 * what goes in it -- the table, a round of matches in the scores list's row
 * (D-374, with the model's bar on a match to come; T-1762) and a picker for
 * the season's other rounds (T-1636), the Matches tab's two lists one round
 * at a time (D-378), a day of results, the model in this league. Every module
 * says its coverage (rule 3); a list with a match in play says how fresh it
 * is (rule 4). Server components only: nothing here reaches the browser's
 * bundle. Beside the page because only this page uses them.
 */

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function Card({
  testId,
  title,
  aside,
  flush = false,
  footer,
  children,
}: {
  testId: string;
  title: ReactNode;
  /** At the heading's inline end: the stamp, the coverage, "model %". */
  aside?: ReactNode;
  /** The body runs to the card's edges (a table, a list of rows). */
  flush?: boolean;
  /** Under a hairline: a legend, a note, a link. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const heading = `${testId}-heading`;
  return (
    <section
      id={testId}
      aria-labelledby={heading}
      data-testid={testId}
      className="flex min-w-0 scroll-mt-4 flex-col overflow-hidden rounded-tile border border-default bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-default px-4 py-3 sm:px-4.5">
        <h2 id={heading} className="text-base font-extrabold font-stretch-semi-expanded sm:text-lg">
          {title}
        </h2>
        {aside !== undefined && (
          <span className="inline-flex flex-wrap items-center gap-2">{aside}</span>
        )}
      </div>
      <div className={cx('flex flex-col', !flush && 'gap-3 p-4 sm:px-4.5')}>{children}</div>
      {footer !== undefined && (
        <div className="flex flex-col gap-1.5 border-t border-default px-4 py-3 text-xs text-muted sm:px-4.5">
          {footer}
        </div>
      )}
    </section>
  );
}

/** "updated 24 Oct 2026, 19:25", the canvas's machine stamp: mono, small, muted. */
export function UpdatedStamp({
  locale,
  timeZone,
  iso,
}: {
  locale: string;
  timeZone: string;
  iso: string;
}) {
  return (
    <span className="font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
      <Translated locale={locale} message="competitionPage.updated" />{' '}
      <Stamp iso={iso} locale={locale} timeZone={timeZone} />
    </span>
  );
}

/** The sentence an empty module says instead of drawing rows (rule 3). */
export function Empty({
  testId,
  locale,
  coverage,
  children,
}: {
  testId: string;
  locale: string;
  coverage?: CoverageState;
  children?: ReactNode;
}) {
  return (
    <p className="text-sm text-muted" data-testid={`${testId}-empty`}>
      {children ??
        (coverage === 'delayed' ? (
          <Translated locale={locale} message="competitionPage.delayed" />
        ) : (
          <Translated locale={locale} message="competitionPage.notSupplied" />
        ))}
    </p>
  );
}

/**
 * A module the API covers (`Covered<T[]>`): its stamp and coverage beside
 * the name, its rows, or the sentence that says why there are none.
 */
export function CoveredCard<T>({
  testId,
  title,
  module,
  locale,
  timeZone,
  intro,
  empty,
  footer,
  flush,
  children,
}: {
  testId: string;
  title: ReactNode;
  module: Covered<T[]>;
  locale: string;
  timeZone: string;
  intro?: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  children: (data: T[]) => ReactNode;
}) {
  const rows = module.data ?? [];
  return (
    <Card
      testId={testId}
      title={title}
      flush={flush === true && rows.length > 0 && intro === undefined}
      footer={footer}
      aside={
        <>
          {module.last_updated_at !== null && (
            <UpdatedStamp locale={locale} timeZone={timeZone} iso={module.last_updated_at} />
          )}
          <Coverage locale={locale} state={module.coverage} />
        </>
      }
    >
      {intro}
      {rows.length === 0 ? (
        <Empty testId={testId} locale={locale} coverage={module.coverage}>
          {empty}
        </Empty>
      ) : (
        children(rows)
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * The league table with every column and the form (T-1498). Zone marks are
 * drawn only where the feed lists the places (`zones.state === 'listed'`,
 * T-1167); otherwise the footer says they are not listed and no place has a
 * colour (rule 3). Beside a league's conference tables it is the overall
 * table and says so (T-1672, D-319).
 */
export function TableCard({
  page,
  locale,
  timeZone,
  overall = false,
}: {
  page: CompetitionPage;
  locale: string;
  timeZone: string;
  overall?: boolean;
}) {
  const rows = page.table.data ?? [];
  return (
    <CoveredCard
      testId="table"
      title={
        <Translated
          locale={locale}
          message={overall ? 'competitionPage.overallTable' : 'competitionPage.table'}
        />
      }
      module={page.table}
      locale={locale}
      timeZone={timeZone}
      flush
      footer={
        rows.length > 0 ? (
          <>
            <ZoneLegend locale={locale} zones={page.zones} />
            {/* On a phone the line under the table says to swipe for the form (T-1760). */}
            <p data-testid="form-order" className="max-sm:hidden">
              <Translated locale={locale} message="competitionPage.formLatestFirst" />
            </p>
          </>
        ) : undefined
      }
    >
      {(data) => (
        <StandingsTable
          rows={data}
          locale={locale}
          zones={page.zones}
          flush
          caption={say(locale, 'competitionPage.tableCaption', {
            name: page.competition.localised_name ?? page.competition.name,
          })}
        />
      )}
    </CoveredCard>
  );
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

/**
 * The scores row's words the model's cell reads (`RowForecast`), resolved
 * once per locale: the catalogues do not change while the server runs.
 */
const ROW_WORDS = new Map<string, ScoresWords>();
function rowWords(locale: string): ScoresWords {
  let words = ROW_WORDS.get(locale);
  if (words === undefined) {
    words = scoresWords(locale);
    ROW_WORDS.set(locale, words);
  }
  return words;
}

/** What stands in the time column: the kick-off, "FT" and its day, "Live", or what happened instead. */
function MatchState({
  fixture,
  locale,
  timeZone,
}: {
  fixture: SeasonFixture;
  locale: string;
  timeZone: string;
}) {
  const status = fixture.status;
  if (status === 'finished') {
    return (
      <>
        <Translated locale={locale} message="status.fullTime" />
        <span className="block font-normal text-muted">
          {formatDate(locale, fixture.kickoff_at, timeZone, { day: 'numeric', month: 'short' })}
        </span>
      </>
    );
  }
  // Still scheduled long after its kick-off (T-1710, D-343), as the API
  // derived it: the word, never a kick-off time that reads as still to come.
  const word: MessageKey | undefined = awaitingUpdate(fixture)
    ? 'status.awaitingUpdate'
    : STATUS_KEY[status as keyof typeof STATUS_KEY];
  if (word !== undefined) {
    return (
      <span
        className={cx('font-extrabold', status === 'live' ? 'text-live' : 'text-warning')}
        data-testid="fixture-status"
      >
        {say(locale, word)}
      </span>
    );
  }
  return (
    <time dateTime={fixture.kickoff_at}>
      {formatDate(locale, fixture.kickoff_at, timeZone, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })}
    </time>
  );
}

/**
 * One match as a row (T-1762, D-378): the scores list's 72px row of D-374,
 * drawn by the server with the same pieces -- the `match-row` grid and
 * `match-row-pick` in `globals.css`, the names' class (`NAME`) and the
 * model's cell (`RowForecast`, the one `ForecastBar` of D-368 in the 104px
 * column, "Not supplied" for a match it has no forecast for) -- so the
 * competition page adds no script. The status and both teams stacked, home
 * above away (so on `/fa` each score still sits beside its own side, D-193),
 * each with its crest and, once the match has started, its own goals at the
 * line's end; names whole, wrapped, never cut. A match still open for picks
 * has Pick under its time (to the match page's pick card). A finished match
 * has no bar and is 56px: "FT" and its day, the winner bold, the loser muted.
 * The row is the link to the match centre, where every forecast version has
 * its receipt. `forecast` absent: the page did not ask, and no cell is drawn.
 */
export function MatchLine({
  fixture,
  locale,
  timeZone,
  forecast,
  now,
}: {
  fixture: SeasonFixture;
  locale: string;
  timeZone: string;
  forecast?: CardForecast;
  /** The moment of the render: with it, a match still open for picks offers Pick. */
  now?: number;
}) {
  const done = fixture.status === 'finished';
  const live = fixture.status === 'live';
  const score = fixture.score;
  const words = rowWords(locale);
  const home = fixture.home.short_name ?? fixture.home.name;
  const away = fixture.away.short_name ?? fixture.away.name;
  // At full time the winner is bold and the loser muted; a draw keeps both in ink.
  const weight = (side: 'home' | 'away'): string => {
    if (!done || score === null || score.home === score.away) return 'font-semibold';
    const won = side === 'home' ? score.home > score.away : score.away > score.home;
    return won ? 'font-extrabold' : 'font-medium text-muted';
  };
  const team = (side: 'home' | 'away') => {
    const t = fixture[side];
    const name = side === 'home' ? home : away;
    return (
      <span className="flex min-h-6 min-w-0 items-center gap-1.5" data-testid={`${side}-team`}>
        <EntityImage media={t.crest} kind="crest" name={name} size={20} />
        <bdi className={cx(NAME, weight(side))}>{name}</bdi>
        {score !== null && (
          <span
            className={cx(
              'ms-auto shrink-0 ps-2 tabular-nums',
              done ? weight(side) : 'font-bold',
              live && 'text-live',
            )}
            data-testid={`${side}-score`}
          >
            {formatNumber(locale, score[side])}
          </span>
        )}
      </span>
    );
  };
  const pick = !done && now !== undefined && pickOpen(fixture, now);
  return (
    <li
      className={cx('match-row', done && 'match-row-done')}
      data-testid="fixture"
      data-status={fixture.status}
    >
      <Link
        href={`/${locale}/match/${fixture.id}`}
        className="col-span-2 col-start-1 row-span-2 row-start-1 grid min-h-11 grid-cols-subgrid grid-rows-subgrid items-center hover:[&_bdi]:underline"
        data-testid="fixture-link"
      >
        <span
          className={cx(
            'text-xs leading-tight font-bold tabular-nums font-stretch-semi-condensed hyphens-auto [overflow-wrap:anywhere] @xl:row-span-2 @xl:self-center @xl:text-sm',
            pick ? 'self-end' : 'row-span-2',
          )}
          data-testid="fixture-state"
        >
          <MatchState fixture={fixture} locale={locale} timeZone={timeZone} />
        </span>
        <span className="row-span-2 flex min-w-0 flex-col gap-1" data-testid="fixture-teams">
          {team('home')}
          {team('away')}
        </span>
      </Link>
      {!done && forecast !== undefined && (
        <RowForecast
          forecast={forecast}
          home={home}
          away={away}
          locale={locale}
          words={words}
          className="col-start-3 row-span-2 row-start-1"
        />
      )}
      {pick && (
        <Link
          href={pickCardPath(locale, fixture.id)}
          aria-label={
            filled(words.m['scores.row.pickLabel'], {
              home: fixture.home.name,
              away: fixture.away.name,
            }).text
          }
          className="match-row-pick inline-flex border border-default hover:bg-surface-raised"
          data-testid="row-pick"
        >
          <MessageText message={words.m['scores.row.pick']} />
        </Link>
      )}
    </li>
  );
}

/** "Sunday 25 October" in the reader's calendar and zone. */
function dayName(locale: string, day: string, timeZone: string): string {
  // Noon UTC of that day lands on the same calendar day in every zone we serve.
  return formatDate(locale, `${day}T12:00:00Z`, timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** A round's name, or its dates when we cannot name it: "31 Oct – 2 Nov", one day in full. */
export function roundTitle(locale: string, round: SeasonRound, timeZone: string): string {
  if (round.label !== null) return round.label;
  const first = dayKey(round.first, timeZone);
  const last = dayKey(round.last, timeZone);
  if (first === last) return dayName(locale, first, timeZone);
  const short = (day: string) =>
    formatDate(locale, `${day}T12:00:00Z`, timeZone, { day: 'numeric', month: 'short' });
  return `${short(first)} – ${short(last)}`;
}

/** The round's dates for the picker's list: "31 Oct – 2 Nov", "31 Oct". */
function roundDates(locale: string, round: SeasonRound, timeZone: string): string {
  const short = (iso: string) =>
    formatDate(locale, iso, timeZone, { day: 'numeric', month: 'short' });
  const first = short(round.first);
  const last = short(round.last);
  return first === last ? first : `${first} – ${last}`;
}

/** The ‹ and › of the picker: the round's name as the link's name, an arrow drawn. */
function StepLink({
  href,
  label,
  rel,
  testId,
}: {
  href: string | null;
  label: string;
  rel: 'prev' | 'next';
  testId: string;
}) {
  // ‹ before, › after, in the reading direction: mirrored on a right-to-left page.
  const arrow = (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="rtl:-scale-x-100"
    >
      <path d={rel === 'prev' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
    </svg>
  );
  const box =
    'flex size-touch shrink-0 items-center justify-center rounded-control border border-default';
  if (href === null) {
    // The season's first or last round: nothing to step to, and nothing to focus.
    return (
      <span
        className={cx(box, 'border-dashed text-caption')}
        data-testid={testId}
        aria-hidden="true"
      >
        {arrow}
      </span>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      rel={rel}
      aria-label={label}
      title={label}
      className={cx(box, 'text-fg hover:border-strong hover:bg-surface-raised')}
      data-testid={testId}
    >
      {arrow}
    </Link>
  );
}

/**
 * The round picker (T-1636, D-298): the previous round, every round of the
 * season under a disclosure, the next round. Links, so a round has an
 * address, Back steps back, and it works without a script; the page keeps
 * its scroll on a step. The disclosure is `<details>`: Enter or Space opens
 * it, Tab walks its rounds, the shown one is `aria-current`. It opens in the
 * card's flow, as tall as its list allows, so the card's edge never cuts it.
 * On the Matches tab (T-1762) it lists and steps through only the rounds of
 * the list shown (`listed`), while the position stays the season's ("10 of
 * 38"); a step with no round of that list beyond it is inert.
 */
export function RoundPicker({
  rounds,
  listed = rounds,
  shown,
  href,
  locale,
  timeZone,
}: {
  rounds: readonly SeasonRound[];
  /** The rounds the picker offers, in the season's order; every round by default. */
  listed?: readonly SeasonRound[];
  /**
   * The round on the card; null when none is (Upcoming with only postponed,
   * cancelled or awaiting matches left): the menu still lists their rounds,
   * none current, and neither step goes anywhere.
   */
  shown: SeasonRound | null;
  /** A round's address (`roundHref`). */
  href: (round: number) => string;
  locale: string;
  timeZone: string;
}) {
  const at = shown === null ? -1 : listed.findIndex((r) => r.number === shown.number);
  const before = at > 0 ? listed[at - 1]! : null;
  const after = at >= 0 ? (listed[at + 1] ?? null) : null;
  const name = (round: SeasonRound) => roundTitle(locale, round, timeZone);
  return (
    <nav
      aria-label={say(locale, 'competitionPage.rounds.nav')}
      className="flex items-start gap-2 border-b border-default px-4 py-2 sm:px-4.5"
      data-testid="round-picker"
    >
      <StepLink
        href={before === null ? null : href(before.number)}
        label={say(locale, 'competitionPage.rounds.previous', {
          round: before === null ? '' : name(before),
        })}
        rel="prev"
        testId="round-prev"
      />
      {/* Closed again on every step: a new round is a new disclosure. */}
      <details
        key={shown?.number ?? 0}
        className="group/rounds min-w-0 flex-1"
        data-testid="round-menu"
      >
        <summary className="flex min-h-touch cursor-pointer list-none items-center justify-center gap-1.5 rounded-control px-2 text-sm font-semibold hover:bg-surface-raised [&::-webkit-details-marker]:hidden">
          <span>{say(locale, 'competitionPage.rounds.all')}</span>
          {shown !== null && (
            <span
              className="text-xs font-normal text-muted tabular-nums"
              data-testid="round-position"
            >
              {say(locale, 'competitionPage.rounds.position', {
                position: formatNumber(locale, shown.number),
                total: formatNumber(locale, rounds.length),
              })}
            </span>
          )}
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="text-muted transition-transform group-open/rounds:rotate-180"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <ol
          className="mt-2 flex max-h-72 flex-col overflow-y-auto rounded-control border border-default"
          data-testid="round-list"
        >
          {listed.map((round) => {
            const current = round.number === shown?.number;
            return (
              <li key={round.number} className="border-b border-default last:border-b-0">
                <Link
                  href={href(round.number)}
                  scroll={false}
                  aria-current={current ? 'true' : undefined}
                  className={cx(
                    // The dates go under the name when the column is narrow (a phone).
                    'flex min-h-touch flex-wrap items-center justify-between gap-x-3 px-3 py-1 text-sm hover:bg-surface-raised',
                    current && 'border-s-2 border-accent bg-surface-raised font-bold',
                  )}
                  data-testid="round-option"
                >
                  <span>{name(round)}</span>
                  {round.label !== null && (
                    <span className="text-xs font-normal whitespace-nowrap text-muted">
                      {roundDates(locale, round, timeZone)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      </details>
      <StepLink
        href={after === null ? null : href(after.number)}
        label={say(locale, 'competitionPage.rounds.next', {
          round: after === null ? '' : name(after),
        })}
        rel="next"
        testId="round-next"
      />
    </nav>
  );
}

/**
 * A list of `MatchLine` rows: the container its rows' columns follow (the
 * scores list's `@container`, D-374), a hairline between rows.
 */
const ROWS = '@container flex flex-col divide-y divide-default';

/**
 * The matches of a round with the model's bar (T-1498; a round rather than a
 * day since T-1636, D-298; D-374's row since T-1762, D-378): the round the
 * page opens on is the one being played or played next (`defaultRound`), and
 * the picker steps to any other. Every match of the round under its day, with
 * its state -- the kick-off in the reader's zone, the minute, the result --
 * and, for a match still to be played, the model's last pre-kick-off
 * forecast. With a match in play the card says how fresh its list is; with
 * no match stored for the season it says so. A round we cannot name is
 * headed by its dates and says once, under the picker, that the names are
 * not supplied (D-378's D12; never a made-up "First Round", D-193).
 *
 * The Matches tab (T-1762) draws each of its two lists with it: `listed` the
 * rounds of that list, `fixtures` the shown round's matches of that list,
 * `intro` its lines under the picker (its freshness, how much of the round it
 * holds), `model` off for Results, which shows no bar.
 */
export function MatchweekCard({
  rounds,
  listed = rounds,
  round,
  fixtures,
  href,
  forecasts,
  page,
  locale,
  timeZone,
  now,
  freshnessWords,
  testId = 'match-day',
  intro,
  empty,
  model = true,
  leftovers = false,
}: {
  rounds: readonly SeasonRound[];
  /** The rounds the picker offers; every round by default. */
  listed?: readonly SeasonRound[];
  /** The round shown, one of `listed`; null when there is none. */
  round: SeasonRound | null;
  /** The shown round's matches to list; all of them by default. */
  fixtures?: readonly SeasonFixture[];
  href: (round: number) => string;
  forecasts: Record<string, CardForecast>;
  page: CompetitionPage;
  locale: string;
  timeZone: string;
  now: number;
  freshnessWords: FreshnessWords;
  testId?: string;
  /** Lines under the picker. */
  intro?: ReactNode;
  /** The sentence for no round at all; "Nothing is left to play" by default. */
  empty?: ReactNode;
  /** The model's bar on the rows still to be played, its "model %" and its receipt. */
  model?: boolean;
  /**
   * With no round shown, still offer `listed` in the picker (Upcoming: rounds
   * of postponed, cancelled or awaiting matches alone, which never open it).
   */
  leftovers?: boolean;
}) {
  const versions = [
    ...new Set(
      Object.values(forecasts).flatMap((f) => (f.state === 'available' ? [f.model_version] : [])),
    ),
  ];
  const shown = round === null ? [] : (fixtures ?? round.fixtures);
  return (
    <Card
      testId={testId}
      title={
        round === null ? (
          <Translated locale={locale} message="competitionPage.day.title" />
        ) : (
          <span data-testid="round-title">{roundTitle(locale, round, timeZone)}</span>
        )
      }
      flush={round !== null}
      aside={
        round === null ? undefined : (
          <>
            <LiveFreshness
              fixtures={shown}
              checkedAt={page.last_updated_at}
              now={now}
              locale={locale}
              words={freshnessWords}
            />
            {model && (
              <span className="text-xs font-semibold text-model">
                <Translated locale={locale} message="competitionPage.day.modelHead" />
              </span>
            )}
          </>
        )
      }
      footer={
        round === null ? undefined : (
          <p data-testid={`${testId}-receipt`}>
            {model && versions.length > 0 ? (
              // Each version an element, never "name@x.y.z" as one run (T-1580).
              <FilledMessage
                message={message(pageLocale(locale), 'competitionPage.day.receipt')}
                params={{
                  versions: <ModelVersions versions={versions} />,
                  zone: zoneWords(locale, timeZone),
                }}
              />
            ) : (
              zoneWords(locale, timeZone)
            )}
          </p>
        )
      }
    >
      {round === null ? (
        <>
          {/* Rounds of this list with no round to open on (only postponed or
              awaiting matches left): still a menu away, none shown. */}
          {leftovers && listed.length > 0 && (
            <RoundPicker
              rounds={rounds}
              listed={listed}
              shown={null}
              href={href}
              locale={locale}
              timeZone={timeZone}
            />
          )}
          <Empty testId={testId} locale={locale}>
            {empty ?? <Translated locale={locale} message="competitionPage.day.none" />}
          </Empty>
        </>
      ) : (
        <>
          <RoundPicker
            rounds={rounds}
            listed={listed}
            shown={round}
            href={href}
            locale={locale}
            timeZone={timeZone}
          />
          {(round.label === null || intro !== undefined) && (
            <div className="flex flex-col gap-1 border-b border-default px-4 py-2 text-xs text-muted sm:px-4.5">
              {round.label === null && (
                <p data-testid="round-names-absent">
                  <Translated locale={locale} message="competitionPage.rounds.unnamed" />
                </p>
              )}
              {intro}
            </div>
          )}
          {roundDays({ fixtures: [...shown] }, timeZone).map((day) => (
            <div key={day.day} className="flex flex-col" data-testid="round-day">
              <h3 className="border-b border-default bg-surface-raised px-4 py-2 text-xs font-bold text-muted sm:px-4.5">
                {dayName(locale, day.day, timeZone)}
              </h3>
              <ul className={ROWS}>
                {day.fixtures.map((f) => (
                  <MatchLine
                    key={f.id}
                    fixture={f}
                    locale={locale}
                    timeZone={timeZone}
                    forecast={
                      // Only a match being played or still to come has a model slot
                      // (T-1710); a postponed or awaiting one shows its status alone.
                      model && stillToCome(f) ? (forecasts[f.id] ?? { state: 'none' }) : undefined
                    }
                    now={now}
                  />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

/** The latest day of results before the match day (T-1498), or the sentence that there are none. */
export function ResultsCard({
  day,
  locale,
  timeZone,
}: {
  day: MatchDay | null;
  locale: string;
  timeZone: string;
}) {
  return (
    <Card
      testId="results-day"
      title={
        day === null ? (
          <Translated locale={locale} message="competitionPage.results" />
        ) : (
          say(locale, 'competitionPage.day.results', { day: dayName(locale, day.day, timeZone) })
        )
      }
      flush={day !== null}
    >
      {day === null ? (
        <Empty testId="results-day" locale={locale}>
          <Translated locale={locale} message="competitionPage.noResults" />
        </Empty>
      ) : (
        <ul className={ROWS}>
          {day.fixtures.map((f) => (
            <MatchLine key={f.id} fixture={f} locale={locale} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * A continental cup's season whose league-phase or group table we do not
 * hold (D-378's D13): one line with its coverage, never a page that silently
 * opens on the knockout rounds (rule 3).
 */
export function TableMissingCard({ locale }: { locale: string }) {
  return (
    <Card
      testId="table-missing"
      title={say(locale, 'competitionPage.tab.table')}
      aside={<Coverage locale={locale} state="not_supplied" />}
    >
      <Empty testId="table-missing" locale={locale}>
        <Translated locale={locale} message="competitionPage.tableMissing" />
      </Empty>
    </Card>
  );
}

/**
 * The Matches tab (T-1762, D-378's D4-D6): one round of one list at a time.
 * A two-way switch, Upcoming and Results, each with its count (links:
 * `?tab=matches&view=`), then the round picker of the Overview listing only
 * that list's rounds, its freshness line (rule 4) and how much of the round
 * it holds when it is not all of it (rule 3: a short list says why), then the
 * round by day in D-374's row. Upcoming opens at the Overview's round,
 * Results at the round of the latest result. No script: server markup and
 * links.
 */
export function MatchesTab({
  page,
  locale,
  timeZone,
  now,
  freshnessWords,
  rounds,
  list,
  forecasts,
}: {
  page: CompetitionPage;
  locale: string;
  timeZone: string;
  now: number;
  freshnessWords: FreshnessWords;
  rounds: readonly SeasonRound[];
  list: MatchList;
  forecasts: Record<string, CardForecast>;
}) {
  const href = (view: MatchView, n: number | null) =>
    matchesHref(locale, page.competition.id, page.season, view, n);
  const total = list.round?.fixtures.length ?? 0;
  const held = list.fixtures.length;
  const asked = Object.keys(forecasts).length;
  const upcoming = list.view === 'upcoming';
  const intro =
    list.round === null ? undefined : (
      <>
        {page.last_updated_at !== null && (
          <p data-testid="matches-freshness">
            <MatchesFreshness
              changedAt={page.last_updated_at}
              checkedAt={page.last_checked_at}
              locale={locale}
              timeZone={timeZone}
              now={now}
            />
          </p>
        )}
        {held < total && (
          <p data-testid="matches-partial">
            {upcoming ? (
              <Translated
                locale={locale}
                message="competitionPage.matches.partialUpcoming"
                count={total - held}
              />
            ) : (
              <Translated
                locale={locale}
                message="competitionPage.matches.partialResults"
                count={total - held}
                params={{ played: formatNumber(locale, held), total: formatNumber(locale, total) }}
              />
            )}
          </p>
        )}
        {upcoming && list.fixtures.filter(stillToCome).length > asked && (
          <p data-testid="matches-model-first">
            {say(locale, 'competitionPage.matches.modelFirst', {
              number: formatNumber(locale, asked),
            })}
          </p>
        )}
      </>
    );
  return (
    <div className="flex w-full max-w-4xl flex-col gap-3">
      <nav
        aria-label={say(locale, 'competitionPage.matches.views')}
        className="flex gap-1 self-start rounded-control border border-default bg-surface p-1"
        data-testid="matches-views"
      >
        {MATCH_VIEWS.map((view) => {
          const current = view === list.view;
          const count = view === 'upcoming' ? page.fixtures.length : page.results.length;
          return (
            <Link
              key={view}
              href={href(view, null)}
              aria-current={current ? 'true' : undefined}
              className={cx(
                'inline-flex min-h-touch items-center gap-1.5 rounded-control px-3.5 text-sm font-bold',
                current ? 'bg-fg text-canvas' : 'text-muted hover:text-fg',
              )}
              data-testid={`matches-view-${view}`}
            >
              <Translated
                locale={locale}
                message={
                  view === 'upcoming'
                    ? 'competitionPage.matches.upcoming'
                    : 'competitionPage.matches.results'
                }
              />
              <span className="text-xs font-semibold tabular-nums">
                {formatNumber(locale, count)}
              </span>
            </Link>
          );
        })}
      </nav>
      <MatchweekCard
        testId={upcoming ? 'fixtures' : 'results'}
        rounds={rounds}
        listed={list.rounds}
        round={list.round}
        fixtures={list.fixtures}
        href={(n) => href(list.view, n)}
        forecasts={forecasts}
        page={page}
        locale={locale}
        timeZone={timeZone}
        now={now}
        freshnessWords={freshnessWords}
        intro={intro}
        empty={
          <Translated
            locale={locale}
            message={
              !upcoming
                ? 'competitionPage.noResults'
                : list.rounds.length > 0
                  ? // Only postponed, cancelled or awaiting matches left (code review, 2026-11-07).
                    'competitionPage.matches.noneToCome'
                  : 'competitionPage.noFixtures'
            }
          />
        }
        model={upcoming}
        leftovers={upcoming}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The model in this league
// ---------------------------------------------------------------------------

/** The canvas's MODEL tag: mono capitals on the model's tint. */
function ModelTag({ locale }: { locale: string }) {
  return (
    <span className="rounded-md border border-model px-2 py-0.5 font-mono text-xs font-semibold text-model [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
      <Translated locale={locale} message="competitionPage.model.tag" />
    </span>
  );
}

function Figure({ value, label }: { value: string; label: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-3xl leading-none font-extrabold font-stretch-condensed tabular-nums">
        {value}
      </span>
      <span className="text-xs text-caption">{label}</span>
    </div>
  );
}

const monthOf = (locale: string, period: string): string => formatGregorianMonth(locale, period);

/**
 * "The model in this league" (T-1498): how the statistical model's
 * published pre-kick-off forecasts scored here in the newest month with a
 * scored match -- how often its favourite won, its RPS beside a blind
 * guess's, and the matches it is over -- with the coverage badge: limited
 * below `ACCURACY_MINIMUM_MATCHES`, and no figure at all with none scored
 * (rule 3). Only the model (rule 6).
 */
export function ModelCard({
  model,
  locale,
  timeZone,
  pastSeason = false,
  more,
}: {
  model: LeagueModel;
  locale: string;
  timeZone: string;
  /** An older season: nothing scored in it is said of that season (T-1556). */
  pastSeason?: boolean;
  /** The link under the card: to the Model tab on the Overview, to the full record on the tab. */
  more: { href: string; label: MessageKey };
}) {
  const coverage: CoverageState = model.state === 'scored' ? model.latest.coverage : 'not_supplied';
  return (
    <section
      aria-labelledby="league-model-heading"
      data-testid="league-model"
      data-state={model.state}
      className="flex min-w-0 flex-col gap-3 rounded-tile border border-default bg-surface p-4 sm:p-4.5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <ModelTag locale={locale} />
        <h2 id="league-model-heading" className="text-sm font-extrabold">
          {model.state === 'scored'
            ? say(locale, 'competitionPage.model.title', {
                month: monthOf(locale, model.latest.period),
              })
            : say(locale, 'competitionPage.model.heading')}
        </h2>
        {model.state !== 'unreachable' && (
          <span className="ms-auto">
            <Coverage locale={locale} state={coverage} />
          </span>
        )}
      </div>
      {model.state === 'unreachable' && (
        <p className="text-sm text-muted" data-testid="league-model-unreachable">
          <Translated locale={locale} message="modelAccuracy.unreachable" />
        </p>
      )}
      {model.state === 'not_supplied' && (
        <p className="text-sm text-muted" data-testid="league-model-empty">
          <Translated
            locale={locale}
            message={
              pastSeason
                ? 'competitionPage.model.notSuppliedSeason'
                : 'competitionPage.model.notSupplied'
            }
          />
        </p>
      )}
      {model.state === 'scored' && (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            {model.latest.accuracy !== null && (
              <Figure
                value={formatPercent(locale, model.latest.accuracy * 100, 0)}
                label={<Translated locale={locale} message="competitionPage.model.favouriteWon" />}
              />
            )}
            {model.latest.rps !== null && (
              <Figure
                value={formatFixed(locale, model.latest.rps, 3)}
                label={
                  model.latest.uniform_rps !== null
                    ? say(locale, 'competitionPage.model.rpsBlind', {
                        rps: formatFixed(locale, model.latest.uniform_rps, 3),
                      })
                    : say(locale, 'modelAccuracy.table.rps')
                }
              />
            )}
            <Figure
              value={formatNumber(locale, model.latest.matches)}
              label={<Translated locale={locale} message="competitionPage.model.matches" />}
            />
          </div>
          {model.latest.coverage === 'limited' && (
            <p className="text-xs text-muted" data-testid="league-model-limited">
              {say(locale, 'competitionPage.model.limited', {
                minimum: formatNumber(locale, ACCURACY_MINIMUM_MATCHES),
              })}
            </p>
          )}
          {model.lastUpdatedAt !== null && (
            <UpdatedStamp locale={locale} timeZone={timeZone} iso={model.lastUpdatedAt} />
          )}
        </>
      )}
      <Link
        href={more.href}
        className="inline-flex min-h-touch items-center self-start text-sm font-bold text-accent hover:underline focus-visible:underline"
      >
        <Translated locale={locale} message={more.label} />
      </Link>
    </section>
  );
}

/**
 * The Model tab's months (T-1498): every month with a scored match in this
 * league, newest first, then all of them together -- the matches each
 * figure is over beside it and each row's coverage (rule 3).
 */
export function ModelMonths({ model, locale }: { model: LeagueModel; locale: string }) {
  if (model.state !== 'scored') return null;
  const th = 'px-2 py-2 text-xs font-semibold text-caption';
  const rows = [
    ...model.months.map((m) => ({ key: m.period, name: monthOf(locale, m.period), m })),
    {
      key: 'all',
      name: say(locale, 'modelAccuracy.table.all'),
      m: model.total,
    },
  ];
  return (
    <Card
      testId="league-model-months"
      title={<Translated locale={locale} message="competitionPage.model.months" />}
      flush
      footer={
        <>
          <p>
            <Translated locale={locale} message="modelAccuracy.table.caption" />
          </p>
          <p data-testid="league-model-versions">
            <FilledMessage
              message={message(pageLocale(locale), 'modelAccuracy.versions')}
              params={{ versions: <ModelVersions versions={model.modelVersions} /> }}
            />
          </p>
          <p>
            <Translated locale={locale} message="competitionPage.model.only" />
          </p>
        </>
      }
    >
      {/* Wider than a phone: its own scrolling box, reachable from the keyboard (T-1558). */}
      <div
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-focus"
        role="region"
        aria-labelledby="league-model-months-heading"
        tabIndex={0}
        data-testid="league-model-months-scroll"
      >
        <table className="w-full min-w-120 border-collapse text-sm tabular-nums">
          <caption className="sr-only">
            <Translated locale={locale} message="competitionPage.model.months" />
          </caption>
          <thead>
            <tr>
              <th scope="col" className={`${th} ps-4 text-start sm:ps-4.5`}>
                <Translated locale={locale} message="modelAccuracy.table.month" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={locale} message="modelAccuracy.table.matches" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={locale} message="competitionPage.model.favouriteWon" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={locale} message="modelAccuracy.table.rps" />
              </th>
              <th scope="col" className={`${th} text-end`}>
                <Translated locale={locale} message="modelAccuracy.table.rpsGuess" />
              </th>
              <th scope="col" className={`${th} pe-4 text-end sm:pe-4.5`}>
                <Translated locale={locale} message="modelAccuracy.table.coverage" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, name, m }) => (
              <tr
                key={key}
                className={cx('border-t border-default', key === 'all' && 'font-bold')}
                data-testid="league-model-month"
              >
                <th scope="row" className="px-2 py-2.5 ps-4 text-start font-semibold sm:ps-4.5">
                  {name}
                </th>
                <td className="px-2 text-end">{formatNumber(locale, m.matches)}</td>
                <td className="px-2 text-end">
                  {m.accuracy === null ? '' : formatPercent(locale, m.accuracy * 100, 0)}
                </td>
                <td className="px-2 text-end">
                  {m.rps === null ? '' : formatFixed(locale, m.rps, 3)}
                </td>
                <td className="px-2 text-end text-muted">
                  {m.uniform_rps === null ? '' : formatFixed(locale, m.uniform_rps, 3)}
                </td>
                <td className="px-2 pe-4 text-end sm:pe-4.5">
                  <Coverage locale={locale} state={m.coverage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
