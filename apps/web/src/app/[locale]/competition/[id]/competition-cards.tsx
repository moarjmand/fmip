import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import type { CompetitionPage, CoverageState, Covered, SeasonFixture } from '@fmip/contracts';
import { ACCURACY_MINIMUM_MATCHES } from '@fmip/contracts';
import { Coverage, LiveFreshness, ZoneLegend, zoneWords } from '@/components/competition-page';
import { FilledMessage } from '@/components/filled-message';
import type { FreshnessWords } from '@/components/freshness-stamp';
import { ModelVersions } from '@/components/model-version';
import { Score } from '@/components/score';
import { Stamp } from '@/components/stamp';
import { StandingsTable } from '@/components/standings-table';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { formatDate, formatGregorianMonth, formatNumber } from '@/i18n/format';
import { type MessageKey, message } from '@/i18n/messages';
import { STATUS_KEY, pageLocale, say } from '@/lib/competition';
import type { LeagueModel, MatchDay, RoundGroup } from '@/lib/competition-overview';
import type { CardForecast } from '@/lib/score-card-products';
import { wholePercentages } from '@/lib/triple';
import { formatFixed, formatPercent } from '@/lib/words';

/**
 * The competition page's modules in the Stadiomind design (T-1498, D-274):
 * a surface card with its name in the wide cut and a hairline under it, and
 * what goes in it -- the table, a day of matches with the model's three
 * percentages, a day of results, the model in this league. Every module
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
 * colour (rule 3).
 */
export function TableCard({
  page,
  locale,
  timeZone,
}: {
  page: CompetitionPage;
  locale: string;
  timeZone: string;
}) {
  const rows = page.table.data ?? [];
  return (
    <CoveredCard
      testId="table"
      title={<Translated locale={locale} message="competitionPage.table" />}
      module={page.table}
      locale={locale}
      timeZone={timeZone}
      flush
      footer={
        rows.length > 0 ? (
          <>
            <ZoneLegend locale={locale} zones={page.zones} />
            <p data-testid="form-order">
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
 * The model's three percentages for one match, the canvas's "48 · 25 · 27"
 * in the model's turquoise, whole and totalling 100 (blueprint 6.2, T-1555),
 * read out whole for a screen reader. A match
 * the model has no forecast for says so in words; so does an answer that
 * did not come (rule 3). `undefined`: the page did not ask, and the cell is
 * left out rather than drawn empty.
 */
export function ModelFigures({ locale, forecast }: { locale: string; forecast: CardForecast }) {
  if (forecast.state === 'available') {
    const whole = wholePercentages(forecast);
    const home = formatNumber(locale, whole.home);
    const draw = formatNumber(locale, whole.draw);
    const away = formatNumber(locale, whole.away);
    return (
      <span
        className="font-mono text-xs whitespace-nowrap text-model tabular-nums [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
        data-testid="model-figures"
        data-forecast="available"
      >
        <span aria-hidden="true">
          {home} · {draw} · {away}
        </span>
        <span className="sr-only">
          {say(locale, 'competitionPage.day.forecastLabel', { home, draw, away })}
        </span>
      </span>
    );
  }
  const key: MessageKey =
    forecast.state === 'unreachable'
      ? 'competitionPage.day.forecastUnreachable'
      : 'competitionPage.day.noForecast';
  return (
    <span
      className="inline-flex min-h-6 items-center rounded-md border border-dashed border-caption px-1.5 text-xs whitespace-nowrap text-caption"
      data-testid="model-figures"
      data-forecast={forecast.state}
    >
      <Translated locale={locale} message={key} />
    </span>
  );
}

/** What stands in the time column: the kick-off, "Live", "FT", or what happened instead. */
function MatchState({
  fixture,
  locale,
  timeZone,
  withDay,
}: {
  fixture: SeasonFixture;
  locale: string;
  timeZone: string;
  withDay: boolean;
}) {
  const status = fixture.status;
  if (status === 'finished') {
    return (
      <span className="text-xs font-bold text-muted">
        <Translated locale={locale} message="status.fullTime" />
        {withDay && (
          <span className="block font-normal">
            {formatDate(locale, fixture.kickoff_at, timeZone, { day: 'numeric', month: 'short' })}
          </span>
        )}
      </span>
    );
  }
  const word = STATUS_KEY[status as keyof typeof STATUS_KEY];
  if (word !== undefined) {
    return (
      <span
        className={cx('text-xs font-extrabold', status === 'live' ? 'text-live' : 'text-warning')}
        data-testid="fixture-status"
      >
        {say(locale, word)}
      </span>
    );
  }
  return (
    <time dateTime={fixture.kickoff_at} className="text-sm font-bold tabular-nums">
      {withDay && (
        <span className="block text-xs font-normal text-muted">
          {formatDate(locale, fixture.kickoff_at, timeZone, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          })}
        </span>
      )}
      {formatDate(locale, fixture.kickoff_at, timeZone, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })}
    </time>
  );
}

/** The row's grid: the state column is wider when it carries the day too. */
const COLUMNS: Record<string, string> = {
  'time-plain': 'grid-cols-[3.25rem_minmax(0,1fr)]',
  'time-model': 'grid-cols-[3.25rem_minmax(0,1fr)_auto]',
  'day-plain': 'grid-cols-[5.5rem_minmax(0,1fr)]',
  'day-model': 'grid-cols-[5.5rem_minmax(0,1fr)_auto]',
};

/**
 * One match as a row (T-1498): when or what state it is in, the two sides
 * -- home first from the inline start, so on `/fa` the home side is on the
 * right (D-193) -- with "v" or the score between them, and the model's
 * percentages at the end when the page asked for them. The row opens the
 * match centre, where every forecast version has its receipt. 44 px tall.
 */
export function MatchLine({
  fixture,
  locale,
  timeZone,
  forecast,
  withDay = false,
}: {
  fixture: SeasonFixture;
  locale: string;
  timeZone: string;
  forecast?: CardForecast;
  withDay?: boolean;
}) {
  const home = fixture.home.short_name ?? fixture.home.name;
  const away = fixture.away.short_name ?? fixture.away.name;
  const winner =
    fixture.status === 'finished' && fixture.score !== null
      ? fixture.score.home > fixture.score.away
        ? 'home'
        : fixture.score.away > fixture.score.home
          ? 'away'
          : null
      : null;
  return (
    <li className="border-b border-default last:border-b-0" data-testid="fixture">
      <Link
        href={`/${locale}/match/${fixture.id}`}
        className={cx(
          'grid min-h-touch items-center gap-x-2.5 px-4 py-1.5 text-sm hover:bg-surface-raised sm:px-4.5',
          COLUMNS[`${withDay ? 'day' : 'time'}-${forecast === undefined ? 'plain' : 'model'}`],
        )}
        data-testid="fixture-link"
      >
        <MatchState fixture={fixture} locale={locale} timeZone={timeZone} withDay={withDay} />
        {/* Running text, not a flex row: a long name wraps to a second line
            rather than being cut to "Bren…" in a narrow column (T-1555). */}
        <span
          className="min-w-0 font-semibold break-words font-stretch-semi-condensed"
          data-testid="fixture-teams"
        >
          <bdi className={cx(winner === 'away' && 'text-muted')}>{home}</bdi>
          {fixture.score === null ? (
            <span className="mx-2 font-medium text-caption">
              {say(locale, 'competitionPage.v')}
            </span>
          ) : (
            <Score
              home={fixture.score.home}
              away={fixture.score.away}
              locale={locale}
              separator="–"
              className="mx-2 font-extrabold whitespace-nowrap font-stretch-condensed tabular-nums"
              testId="fixture-score"
            />
          )}
          <bdi className={cx(winner === 'home' && 'text-muted')}>{away}</bdi>
        </span>
        {forecast !== undefined && <ModelFigures locale={locale} forecast={forecast} />}
      </Link>
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

/**
 * The day's matches with the model's percentages (T-1498): the next day the
 * competition plays, every match that day with its state and the model's
 * last pre-kick-off forecast. With a match in play the card says how fresh
 * its list is; with nothing left to play this season it says so.
 */
export function DayCard({
  day,
  forecasts,
  page,
  locale,
  timeZone,
  now,
  freshnessWords,
}: {
  day: MatchDay | null;
  forecasts: Record<string, CardForecast>;
  page: CompetitionPage;
  locale: string;
  timeZone: string;
  now: number;
  freshnessWords: FreshnessWords;
}) {
  const versions = [
    ...new Set(
      Object.values(forecasts).flatMap((f) => (f.state === 'available' ? [f.model_version] : [])),
    ),
  ];
  return (
    <Card
      testId="match-day"
      title={
        day === null ? (
          <Translated locale={locale} message="competitionPage.day.title" />
        ) : (
          dayName(locale, day.day, timeZone)
        )
      }
      flush={day !== null}
      aside={
        day === null ? undefined : (
          <>
            <LiveFreshness
              fixtures={day.fixtures}
              checkedAt={page.last_updated_at}
              now={now}
              locale={locale}
              words={freshnessWords}
            />
            <span className="text-xs font-semibold text-model">
              <Translated locale={locale} message="competitionPage.day.modelHead" />
            </span>
          </>
        )
      }
      footer={
        day === null ? undefined : (
          <p data-testid="match-day-receipt">
            {versions.length > 0 ? (
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
      {day === null ? (
        <Empty testId="match-day" locale={locale}>
          <Translated locale={locale} message="competitionPage.day.none" />
        </Empty>
      ) : (
        <ul className="flex flex-col">
          {day.fixtures.map((f) => (
            <MatchLine
              key={f.id}
              fixture={f}
              locale={locale}
              timeZone={timeZone}
              forecast={forecasts[f.id] ?? { state: 'none' }}
            />
          ))}
        </ul>
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
        <ul className="flex flex-col">
          {day.fixtures.map((f) => (
            <MatchLine key={f.id} fixture={f} locale={locale} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Fixtures or results by round for the Matches tab (T-1498), each round
 * headed in our words or not at all (D-193), each row with its day; the
 * fixtures the page asked the model about carry its percentages.
 */
export function RoundsCard({
  testId,
  title,
  groups,
  empty,
  locale,
  timeZone,
  forecasts,
  aside,
  footer,
}: {
  testId: string;
  title: ReactNode;
  groups: RoundGroup[];
  empty: ReactNode;
  locale: string;
  timeZone: string;
  forecasts?: Record<string, CardForecast>;
  aside?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card
      testId={testId}
      title={title}
      aside={aside}
      flush={groups.length > 0}
      footer={groups.length > 0 ? (footer ?? zoneWords(locale, timeZone)) : undefined}
    >
      {groups.length === 0 ? (
        <Empty testId={testId} locale={locale}>
          {empty}
        </Empty>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="flex flex-col" data-testid="round">
            {group.label !== null && (
              <h3 className="border-b border-default bg-surface-raised px-4 py-2 text-xs font-bold text-muted sm:px-4.5">
                {group.label}
              </h3>
            )}
            <ul className="flex flex-col">
              {group.fixtures.map((f) => (
                <MatchLine
                  key={f.id}
                  fixture={f}
                  locale={locale}
                  timeZone={timeZone}
                  withDay
                  forecast={forecasts?.[f.id]}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </Card>
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
