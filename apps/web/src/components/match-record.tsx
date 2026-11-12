import type {
  CoverageModule,
  CoverageState,
  Covered,
  FormEntry,
  MatchCentre,
} from '@fmip/contracts';
import { Fragment } from 'react';
import { formatDate, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type Message, type MessageKey, message, t } from '@/i18n/messages';
import { NOT_YET } from '@/lib/match';
import { filled } from '@/lib/words';
import type { MatchWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import { COVERAGE_KEY, Card, Module } from '@/components/match-centre-cards';
import { MessageText } from '@/components/message-text';
import { ProductRow } from '@/components/product-row';
import { Score } from '@/components/score';
import { Translated } from '@/components/translated';
import { CoverageBadge, CoverageGlyph } from '@/components/ui/coverage-badge';

/**
 * The parts of the match centre that do not move during a match (T-1384,
 * D-202): recent form, head-to-head and the season's coverage.
 * Rendered by the page on the server and handed to the live view as slots,
 * so their code is not in the page's client bundle (the route's first-load
 * budget, `perf-budgets.json`); the live stream replaces what changes in
 * play -- score, events, statistics, line-ups, absences -- and these stand
 * as the page drew them.
 */

type Key = keyof MatchWords['m'];

const MODULE_KEY = {
  scores: 'matchCentre.module.scores',
  incidents: 'matchCentre.module.incidents',
  lineups: 'matchCentre.module.lineups',
  statistics: 'matchCentre.module.statistics',
  standings: 'matchCentre.module.standings',
  availability: 'matchCentre.module.availability',
  advanced_statistics: 'matchCentre.module.advancedStatistics',
} as const satisfies Record<CoverageModule, Key>;

const RESULT_KEY = {
  W: 'matchCentre.form.won',
  D: 'matchCentre.form.drawn',
  L: 'matchCentre.form.lost',
} as const satisfies Record<FormEntry['result'], Key>;

export function HeadToHead({
  centre,
  locale,
  timeZone,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  words: MatchWords;
}) {
  return (
    <Module
      title={words.m['matchCentre.headToHead']}
      module={centre.head_to_head}
      testId="head-to-head"
      words={words}
    >
      {(meetings) => (
        <ul className="flex flex-col divide-y divide-default text-sm tabular-nums">
          {meetings.map((meeting) => (
            <li
              key={meeting.fixture_id}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 py-2"
            >
              <time dateTime={meeting.kickoff_at} className="text-xs text-muted tabular-nums">
                {formatShortDate(locale, meeting.kickoff_at, timeZone)}
              </time>
              <span className="flex min-w-0 flex-col">
                {/* The winner in bold, so the row reads without its colour. */}
                <span>
                  <bdi className={winner(meeting.full_time, 'home')}>{meeting.home.name}</bdi>{' '}
                  <Score
                    home={meeting.full_time.home}
                    away={meeting.full_time.away}
                    className="font-bold"
                    locale={locale}
                  />{' '}
                  <bdi className={winner(meeting.full_time, 'away')}>{meeting.away.name}</bdi>
                </span>
                <span className="text-xs text-muted">
                  {meeting.competition.name}
                  {meeting.venue !== null ? ` · ${meeting.venue}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Module>
  );
}

/** The side that won a meeting, set in bold; a draw sets neither. */
function winner(score: { home: number; away: number }, side: 'home' | 'away'): string | undefined {
  const margin = side === 'home' ? score.home - score.away : score.away - score.home;
  return margin > 0 ? 'font-bold text-fg' : undefined;
}

/**
 * The data footer (the canvas's "Data on this page", T-1497): the season's
 * declared coverage per module, said once (T-1776, D-384; board P6-3). When
 * every module is available it is one folded 48px line, "All 7 available
 * this season", the count from the data, and opened it names them. When any
 * is limited, delayed or not supplied the line is the exception instead:
 * each such state as its badge (a glyph and a word, rule 3), "6 of 7
 * available", and behind the tap each such module with its state and why,
 * then the available ones. The repetition of the good news is what goes,
 * never a state: the API still sends one per module, and a module header
 * keeps its badge whenever its state is not "available". A native
 * `<details>` (`ProductRow` folded), so no client JavaScript.
 */
export function Coverage({
  centre,
  words,
  locale,
}: {
  centre: MatchCentre;
  words: MatchWords;
  locale: string;
}) {
  const m = words.m;
  const l = asLocale(locale);
  const moduleState = (coverage: CoverageState): Message => m[COVERAGE_KEY[coverage]];
  const entries = Object.entries(centre.coverage) as [CoverageModule, CoverageState][];
  const available = entries.filter(([, state]) => state === 'available');
  const exceptions = entries.filter(
    (entry): entry is [CoverageModule, Exclude<CoverageState, 'available'>] =>
      entry[1] !== 'available',
  );
  const states = [...new Set(exceptions.map(([, state]) => state))];
  const count = formatNumber(l, entries.length);
  const separator = t(l, 'shared.listSeparator');
  return (
    <>
      <ProductRow
        folded
        labelledBy="match-coverage-title"
        testId="coverage"
        state={exceptions.length === 0 ? 'available' : 'exception'}
        name={
          <h2
            id="match-coverage-title"
            className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg"
          >
            {exceptions.length === 0 && (
              <span className="text-caption">
                <CoverageGlyph state="available" />
              </span>
            )}
            {/* The block's name for a screen reader; the line says the rest. */}
            <span className="sr-only">
              <MessageText message={m['matchCentre.coverage']} />
              {': '}
            </span>
            <span dir="auto">
              {exceptions.length === 0 ? (
                <FilledMessage
                  message={message(l, 'matchCentre.coverage.all')}
                  params={{ count }}
                />
              ) : (
                <FilledMessage
                  message={message(l, 'matchCentre.coverage.some')}
                  params={{ available: formatNumber(l, available.length), count }}
                />
              )}
            </span>
          </h2>
        }
        status={
          states.length === 0 ? undefined : (
            <span className="flex flex-wrap justify-end gap-1">
              {states.map((state) => (
                <CoverageBadge
                  key={state}
                  state={state}
                  label={<MessageText message={moduleState(state)} />}
                />
              ))}
            </span>
          )
        }
      >
        {exceptions.length > 0 && (
          <ul className="flex flex-col gap-1" data-testid="coverage-exceptions">
            {exceptions.map(([module, state]) => (
              <li key={module} dir="auto" data-coverage={state}>
                <b className="font-semibold text-fg">
                  <MessageText
                    message={filled(m['matchCentre.moduleCoverage'], {
                      module: m[MODULE_KEY[module]].text,
                      state: moduleState(state).text,
                    })}
                  />
                </b>
                {' · '}
                <Translated locale={l} message={WHY[state]} />
              </li>
            ))}
          </ul>
        )}
        {available.length > 0 && (
          <p dir="auto" data-testid="coverage-available">
            {exceptions.length > 0 && (
              <>
                <MessageText message={moduleState('available')} />
                {': '}
              </>
            )}
            {available.map(([module], index) => (
              <Fragment key={module}>
                {index > 0 && separator}
                <MessageText message={m[MODULE_KEY[module]]} />
              </Fragment>
            ))}
          </p>
        )}
      </ProductRow>
      {/* Blueprint 4.2 modules not built yet, named rather than hidden (empty now). */}
      {NOT_YET.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs text-muted" data-testid="not-yet">
          {NOT_YET.map(([name, why]) => (
            <li key={name} dir="auto" className="rounded-control border border-default px-2 py-1">
              {name}: {why}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Why a module of the season is not available, behind the coverage line (D-384). */
const WHY = {
  limited: 'matchCentre.coming.limitedWhy',
  delayed: 'matchCentre.moduleDelayed',
  not_supplied: 'matchCentre.coverage.notSuppliedWhy',
} as const satisfies Record<Exclude<CoverageState, 'available'>, MessageKey>;

function asLocale(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/** "13 Sept 2026" in the viewer's zone. */
function formatShortDate(locale: string, iso: string, timeZone: string): string {
  return formatDate(locale, iso, timeZone, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A form letter's badge: won, drawn, lost in the theme's own tones (T-1204). */
const RESULT_TONE: Record<FormEntry['result'], string> = {
  W: 'bg-success text-canvas',
  D: 'bg-canvas text-fg',
  L: 'bg-danger text-canvas',
};

export function Form({
  name,
  module,
  timeZone,
  locale,
  words,
}: {
  name: string;
  module: Covered<FormEntry[]>;
  timeZone: string;
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  return (
    <div className="flex flex-col gap-1" data-coverage={module.coverage}>
      <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold">
        <bdi>{name}</bdi>
        <CoverageBadge
          state={module.coverage}
          label={<MessageText message={m[COVERAGE_KEY[module.coverage]]} />}
        />
      </h3>
      {module.data === null ? (
        <p dir="auto" className="text-xs text-muted">
          <MessageText message={m['matchCentre.noForm']} />
        </p>
      ) : (
        // Result, match and date in fixed columns, the competition under the
        // match, so the rows line up whatever the opponent's name (T-1204).
        <ul className="flex flex-col divide-y divide-default">
          {module.data.map((e) => (
            <li
              key={e.fixture_id}
              className="grid grid-cols-[1.75rem_1fr_auto] items-start gap-x-2 py-1.5"
            >
              <span
                className={`flex size-6 items-center justify-center rounded text-xs font-semibold ${RESULT_TONE[e.result]}`}
              >
                <MessageText message={m[RESULT_KEY[e.result]]} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span>
                  <Score
                    home={e.goals_for}
                    away={e.goals_against}
                    className="font-semibold tabular-nums"
                    locale={locale}
                  />{' '}
                  <FilledMessage
                    message={m[e.home ? 'matchCentre.form.versus' : 'matchCentre.form.at']}
                    params={{ opponent: <bdi>{e.opponent.name}</bdi> }}
                  />
                </span>
                <span className="text-xs text-muted">{e.competition.name}</span>
              </span>
              <time dateTime={e.kickoff_at} className="text-xs text-muted tabular-nums">
                {formatShortDate(locale, e.kickoff_at, timeZone)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Both sides' recent form, in one card. */
export function MatchForm({
  centre,
  timeZone,
  locale,
  words,
}: {
  centre: MatchCentre;
  timeZone: string;
  locale: string;
  words: MatchWords;
}) {
  const f = centre.fixture;
  return (
    <Card testId="form" title={words.m['matchCentre.recentForm']}>
      <div className="grid grid-cols-1 gap-4 text-sm @lg:grid-cols-2">
        <Form
          name={f.home.name}
          module={centre.form.home}
          timeZone={timeZone}
          locale={locale}
          words={words}
        />
        <Form
          name={f.away.name}
          module={centre.form.away}
          timeZone={timeZone}
          locale={locale}
          words={words}
        />
      </div>
    </Card>
  );
}
