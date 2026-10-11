import type {
  CoverageModule,
  CoverageState,
  Covered,
  FormEntry,
  MatchCentre,
} from '@fmip/contracts';
import { formatDate } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import { NOT_YET } from '@/lib/match';
import { filled } from '@/lib/words';
import type { MatchWords } from '@/lib/words-server';
import { FilledMessage } from '@/components/filled-message';
import {
  CARD,
  COVERAGE_KEY,
  Card,
  MODULE_HEADING,
  Module,
  TITLE,
} from '@/components/match-centre-cards';
import { MessageText } from '@/components/message-text';
import { Score } from '@/components/score';
import { CoverageBadge } from '@/components/ui/coverage-badge';

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
        <ul className="flex flex-col divide-y divide-default text-sm">
          {meetings.map((meeting) => (
            <li
              key={meeting.fixture_id}
              className="grid grid-cols-[6.5rem_1fr] items-start gap-x-3 py-1.5"
            >
              <time dateTime={meeting.kickoff_at} className="text-xs text-muted tabular-nums">
                {formatShortDate(locale, meeting.kickoff_at, timeZone)}
              </time>
              <span className="flex min-w-0 flex-col">
                <span>
                  <bdi>{meeting.home.name}</bdi>{' '}
                  <Score
                    home={meeting.full_time.home}
                    away={meeting.full_time.away}
                    className="font-bold"
                    locale={locale}
                  />{' '}
                  <bdi>{meeting.away.name}</bdi>
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

/** The season's declared coverage per module, each with its badge. */
export function Coverage({ centre, words }: { centre: MatchCentre; words: MatchWords }) {
  const m = words.m;
  const moduleState = (coverage: CoverageState): Message => m[COVERAGE_KEY[coverage]];
  return (
    <section className={CARD} data-testid="coverage">
      <h2 className={MODULE_HEADING}>
        <span className={TITLE}>
          <MessageText message={m['matchCentre.coverage']} />
        </span>
      </h2>
      <ul className="flex flex-wrap gap-2 text-xs">
        {(Object.entries(centre.coverage) as [CoverageModule, CoverageState][]).map(
          ([module, state]) => (
            <li
              key={module}
              dir="auto"
              className="inline-flex items-center gap-2 rounded-control border border-default px-2 py-1"
              data-coverage={state}
            >
              {/* The sentence for a screen reader and a search; the badge for the eye (T-1388). */}
              <span className="sr-only">
                <MessageText
                  message={filled(m['matchCentre.moduleCoverage'], {
                    module: m[MODULE_KEY[module]].text,
                    state: moduleState(state).text,
                  })}
                />
              </span>
              <span aria-hidden="true">
                <MessageText message={m[MODULE_KEY[module]]} />
              </span>
              <span aria-hidden="true">
                <CoverageBadge state={state} label={<MessageText message={moduleState(state)} />} />
              </span>
            </li>
          ),
        )}
      </ul>
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
    </section>
  );
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
