import type {
  CoverageModule,
  Covered,
  FormEntry,
  MatchAbsenceGap,
  MatchCentre,
  MatchLineupPlayer,
  MatchPlayerStats,
  PlayerMatchMetric,
} from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import Link from 'next/link';
import { INCIDENT_KEY, NOT_YET, STAT_KEY, statValue } from '@/lib/match';
import { isBehind } from '@/lib/live';
import { formatKickoff, statusLabel } from '@/lib/scores';
import { fill, filled, formatFixed, formatMinute } from '@/lib/words';
import { stageAndRound, stageLabel } from '@/lib/stage-label';
import type { MatchWords } from '@/lib/words-server';
import { formatDate, formatDateTime } from '@/i18n/format';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { COVERAGE_KEY } from '@/components/score-card';
import { Score } from '@/components/score';

/** The server-rendered panels the page slots between the live modules (T-605). */
export type MatchSlot =
  | 'summary'
  | 'context'
  | 'players'
  | 'forecast'
  | 'analysis'
  | 'community'
  | 'discussion'
  | 'watch'
  | 'news';
export type MatchSlots = Partial<Record<MatchSlot, React.ReactNode>>;

type Key = keyof MatchWords['m'];

/** The sections this view always has, whatever the page passes. */
const BUILT_IN = { timeline: true, stats: true, lineups: true } as const;

/**
 * The in-page nav, in page order, each with its label's catalogue key
 * (T-1303). The statistical model, the founder's analysis and the community
 * are three entries with three names (rule 6).
 */
export const SECTIONS: readonly [
  key: keyof typeof BUILT_IN | Exclude<MatchSlot, 'summary'>,
  label: Key,
][] = [
  ['timeline', 'matchCentre.nav.timeline'],
  ['stats', 'matchCentre.nav.stats'],
  ['context', 'matchCentre.nav.context'],
  ['lineups', 'matchCentre.lineups'],
  ['players', 'matchCentre.keyPlayers.title'],
  ['forecast', 'forecast.title'],
  ['analysis', 'matchCentre.nav.analysis'],
  ['community', 'matchCentre.nav.community'],
  ['discussion', 'matchCentre.nav.discussion'],
  ['watch', 'nav.watch'],
  ['news', 'nav.news'],
];

/** The per-player columns the match centre shows (T-101), in reading order. */
const PLAYER_COLUMNS: readonly [PlayerMatchMetric, Key][] = [
  ['minutes', 'matchCentre.player.minutes'],
  ['rating', 'matchCentre.player.rating'],
  ['goals', 'matchCentre.player.goals'],
  ['assists', 'matchCentre.player.assists'],
  ['shots', 'matchCentre.player.shots'],
  ['key_passes', 'matchCentre.player.keyPasses'],
  ['tackles', 'matchCentre.player.tackles'],
];

const MODULE_KEY = {
  scores: 'matchCentre.module.scores',
  incidents: 'matchCentre.module.incidents',
  lineups: 'matchCentre.module.lineups',
  statistics: 'matchCentre.module.statistics',
  standings: 'matchCentre.module.standings',
  availability: 'matchCentre.module.availability',
  advanced_statistics: 'matchCentre.module.advancedStatistics',
} as const satisfies Record<CoverageModule, Key>;

/** Why the absence list is empty (T-1364): each reason its own sentence. */
const ABSENCE_GAP_KEY = {
  not_covered: 'matchCentre.absencesNotCovered',
  not_yet: 'matchCentre.absencesNotYet',
  not_asked: 'matchCentre.moduleNotSupplied',
} as const satisfies Record<MatchAbsenceGap, Key>;

const RESULT_KEY = {
  W: 'matchCentre.form.won',
  D: 'matchCentre.form.drawn',
  L: 'matchCentre.form.lost',
} as const satisfies Record<FormEntry['result'], Key>;

/** One player cell: the provider's rating to one decimal, a count as it is, `–` when not supplied. */
function playerCell(locale: string, player: MatchPlayerStats, metric: PlayerMatchMetric): string {
  const value = player.stats[metric];
  if (value === undefined) return '–';
  return metric === 'rating' ? formatFixed(locale, value, 1) : formatNumber(locale, value);
}

/**
 * One section of the page, the target of a nav anchor. Its top clears the
 * sticky nav when jumped to; with nothing in it, it is not rendered.
 */
function Region({ id, children }: { id: string; children?: React.ReactNode }) {
  if (children === undefined || children === null || children === false) return null;
  return (
    <div id={id} className="flex scroll-mt-14 flex-col gap-6" data-testid={`section-${id}`}>
      {children}
    </div>
  );
}

/**
 * The match centre as blueprint 4.2 lays it out, from one `MatchCentre`
 * payload (T-034). Every module renders its coverage state beside its name;
 * a module without data says so; modules the platform does not have yet are
 * named at the end rather than left as empty boxes (rule 3). Pure rendering:
 * the server page and the live client component both use it, which is why
 * its words arrive resolved (`words`, T-1303) rather than from the catalogue.
 */
export function MatchCentreView({
  centre,
  timeZone,
  locale,
  now,
  slots = {},
  words,
}: {
  centre: MatchCentre;
  timeZone: string;
  locale: string;
  /** The client clock, ms since epoch, so a feed that stops is caught (T-083). */
  now?: number;
  /** Server-rendered panels, each placed in its own section. */
  slots?: MatchSlots;
  /** The reader's words, resolved by the page on the server (T-1303). */
  words: MatchWords;
}) {
  const m = words.m;
  const n = (value: number): string => formatNumber(locale, value);
  const stage = (text: string): string => stageLabel(text, (key) => m[key].text, locale);
  const f = centre.fixture;
  const headline =
    f.status === 'finished' ? (f.scores.full_time ?? f.scores.current) : f.scores.current;
  const behind = now !== undefined && isBehind(f, now);
  const status = statusLabel(f, locale, timeZone, now, m);
  const at = (iso: string) => <time dateTime={iso}>{formatKickoff(locale, iso, timeZone)}</time>;
  const venue =
    f.venue === null ? null : `${f.venue.name}${f.venue.city !== null ? `, ${f.venue.city}` : ''}`;
  const moduleState = (coverage: Covered<unknown>['coverage']): Message =>
    m[COVERAGE_KEY[coverage]];

  // The in-page sections (T-605): plain anchors, so the nav works with no
  // script, and only for what this page holds. The model, the founder and the
  // community are three entries, never one (rule 6).
  const nav = SECTIONS.filter(
    ([key]) => key in BUILT_IN || (slots[key as MatchSlot] ?? null) !== null,
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2" data-testid="match-header">
        <p className="text-xs text-muted sm:text-sm">
          <Link
            href={`/${locale}/competition/${f.competition.id}?season=${f.season.id}`}
            className="inline-flex items-center gap-1.5 align-middle underline"
            data-testid="competition-link"
          >
            <EntityImage
              media={f.competition.logo}
              kind="logo"
              name={f.competition.name}
              size={20}
              aboveFold
            />
            {f.competition.name}
          </Link>{' '}
          · {f.season.label}
          {stageAndRound(f.stage?.name, f.round).map((text) => ` · ${stage(text)}`)}
          {f.group_name !== null
            ? ` · ${fill(m['matchCentre.group'].text, { group: f.group_name })}`
            : ''}
          {f.leg !== null ? ` · ${fill(m['scores.card.leg'].text, { leg: n(f.leg) })}` : ''}
        </p>
        {/* Names wrap rather than push the score off a phone's screen. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <h1
            className="text-end text-base font-semibold hyphens-auto [overflow-wrap:anywhere] sm:text-2xl"
            data-testid="home-team"
          >
            <Link
              href={`/${locale}/team/${f.home.id}`}
              className="inline-flex flex-col items-end gap-1"
            >
              <EntityImage
                media={f.home.crest}
                kind="crest"
                name={f.home.name}
                size={48}
                aboveFold
              />
              <bdi>{f.home.name}</bdi>
            </Link>
          </h1>
          <div className="flex flex-col items-center">
            {headline === null ? (
              <span className="text-2xl font-semibold tabular-nums sm:text-3xl" data-testid="score">
                –
              </span>
            ) : (
              <Score
                home={headline.home}
                away={headline.away}
                separator=" – "
                className="text-2xl font-semibold whitespace-nowrap tabular-nums sm:text-3xl"
                testId="score"
                locale={locale}
              />
            )}
            <span
              className={`text-sm ${f.status === 'live' && !behind ? 'font-semibold text-live' : ''}`}
              data-testid="match-status"
            >
              {status}
            </span>
          </div>
          <h1
            className="text-base font-semibold hyphens-auto [overflow-wrap:anywhere] sm:text-2xl"
            data-testid="away-team"
          >
            <Link
              href={`/${locale}/team/${f.away.id}`}
              className="inline-flex flex-col items-start gap-1"
            >
              <EntityImage
                media={f.away.crest}
                kind="crest"
                name={f.away.name}
                size={48}
                aboveFold
              />
              <bdi>{f.away.name}</bdi>
            </Link>
          </h1>
        </div>
        {behind && (
          <p role="status" className="text-sm font-medium" data-testid="feed-behind">
            <FilledMessage
              message={m['matchCentre.behind']}
              params={{ time: at(f.last_updated_at) }}
            />
          </p>
        )}
        <ul className="flex flex-wrap gap-x-4 text-xs text-muted">
          {f.scores.half_time !== null && (
            <li>
              <MessageText message={m['status.halfTime']} />{' '}
              <Score
                home={f.scores.half_time.home}
                away={f.scores.half_time.away}
                locale={locale}
              />
            </li>
          )}
          {f.scores.aggregate !== null && (
            <li>
              <MessageText message={m['status.aggregate']} />{' '}
              <Score
                home={f.scores.aggregate.home}
                away={f.scores.aggregate.away}
                locale={locale}
              />
            </li>
          )}
          {f.scores.penalties !== null && (
            <li>
              <MessageText message={m['status.penalties']} />{' '}
              <Score
                home={f.scores.penalties.home}
                away={f.scores.penalties.away}
                locale={locale}
              />
            </li>
          )}
          <li>
            <FilledMessage
              message={m['scores.card.kickoff']}
              params={{
                time: (
                  <time dateTime={f.kickoff_at}>
                    {formatDateTime(locale, f.kickoff_at, timeZone)}
                  </time>
                ),
              }}
            />
          </li>
          {venue !== null && (
            <li>
              {f.is_neutral_venue ? (
                <MessageText message={filled(m['matchCentre.neutralVenue'], { venue })} />
              ) : (
                venue
              )}
            </li>
          )}
          <li>
            <MessageText
              message={filled(m['matchCentre.referee'], {
                name: f.referee === null ? m['status.coverage.notSupplied'].text : f.referee.name,
              })}
            />
          </li>
          {f.attendance !== null && (
            <li>
              <MessageText
                message={filled(m['matchCentre.attendance'], { count: n(f.attendance) })}
              />
            </li>
          )}
          <li>
            <FilledMessage
              message={m['matchCentre.lastUpdate']}
              params={{ time: at(f.last_updated_at) }}
            />
          </li>
        </ul>
      </header>

      <nav
        aria-label={m['matchCentre.onThisPage'].text}
        className="sticky top-0 z-20 -mx-4 overflow-x-auto border-b border-default bg-canvas px-4 sm:mx-0 sm:px-0"
        data-testid="section-nav"
      >
        <ul className="flex gap-1 text-sm">
          {nav.map(([key, label]) => (
            <li key={key} className="shrink-0">
              <a
                href={`#${key}`}
                className="inline-flex min-h-11 items-center px-3 whitespace-nowrap underline"
              >
                <MessageText message={m[label]} />
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Region id="timeline">
        {slots.summary}
        <Module
          title={m['matchCentre.timeline']}
          module={centre.timeline}
          testId="timeline"
          words={words}
        >
          {(incidents) => (
            <ol className="flex flex-col gap-1 text-sm">
              {incidents.map((i) => (
                <li key={i.id} className="flex gap-3">
                  <span className="w-12 shrink-0 tabular-nums text-muted">
                    <span dir="ltr">{formatMinute(locale, i.minute, i.added_time)}</span>
                  </span>
                  <span className="w-24 shrink-0 max-sm:w-auto max-sm:font-medium">
                    <MessageText message={m[INCIDENT_KEY[i.kind]]} />
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {i.player !== null && (
                      <Link href={`/${locale}/player/${i.player.id}`} className="underline">
                        {i.player.name}
                      </Link>
                    )}
                    {i.related_player !== null &&
                      (i.kind === 'substitution' ? (
                        <>
                          {' ↔ '}
                          <Link
                            href={`/${locale}/player/${i.related_player.id}`}
                            className="underline"
                          >
                            {i.related_player.name}
                          </Link>
                        </>
                      ) : (
                        <>
                          {' '}
                          <FilledMessage
                            message={m['matchCentre.assist']}
                            params={{
                              player: (
                                <Link
                                  href={`/${locale}/player/${i.related_player.id}`}
                                  className="underline"
                                >
                                  {i.related_player.name}
                                </Link>
                              ),
                            }}
                          />
                        </>
                      ))}
                    {i.side !== null ? ` · ${i.side === 'home' ? f.home.name : f.away.name}` : ''}
                    {i.detail !== null ? ` · ${i.detail}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Module>
      </Region>

      <Region id="stats">
        <Module
          title={m['matchCentre.statistics']}
          module={centre.statistics}
          testId="statistics"
          words={words}
        >
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.metric} className="border-t border-default">
                      <td className="py-1 text-end tabular-nums">
                        <span dir="ltr">{statValue(row.metric, row.home, locale)}</span>
                      </td>
                      <th scope="row" className="px-3 py-1 text-center font-normal text-muted">
                        <MessageText message={m[STAT_KEY[row.metric]]} />
                      </th>
                      <td className="py-1 tabular-nums">
                        <span dir="ltr">{statValue(row.metric, row.away, locale)}</span>
                      </td>
                    </tr>
                  ))}
                  {rows.some((row) => row.metric === 'expected_goals') ? null : (
                    <tr className="border-t border-default" data-testid="xg-not-supplied">
                      <td colSpan={3} className="py-1 text-center text-muted">
                        <MessageText message={m['matchCentre.xgNotSupplied']} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Module>

        <Module
          title={m['matchCentre.playerStatistics']}
          module={centre.player_statistics}
          testId="player-statistics"
          words={words}
        >
          {(players) => (
            <div className="flex flex-col gap-3 text-sm">
              {(
                [
                  ['home', f.home.name],
                  ['away', f.away.name],
                ] as const
              ).map(([side, team]) => {
                const rows = players.filter((p) => p.side === side);
                if (rows.length === 0) return null;
                return (
                  <div key={side} className="overflow-x-auto">
                    <table className="w-full">
                      <caption className="text-start font-medium">{team}</caption>
                      <thead>
                        <tr>
                          <th scope="col" className="py-1 text-start font-normal text-muted">
                            <MessageText message={m['matchCentre.playerColumn']} />
                          </th>
                          {PLAYER_COLUMNS.map(([metric, label]) => (
                            <th
                              key={metric}
                              scope="col"
                              className="px-2 py-1 text-end font-normal text-muted"
                            >
                              <MessageText message={m[label]} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((player) => (
                          <tr key={player.id} className="border-t border-default">
                            <th scope="row" className="py-1 text-start font-normal">
                              <Link href={`/${locale}/player/${player.id}`}>{player.name}</Link>
                            </th>
                            {PLAYER_COLUMNS.map(([metric]) => (
                              <td key={metric} className="px-2 py-1 text-end tabular-nums">
                                {playerCell(locale, player, metric)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              <p className="text-muted">
                <MessageText message={m['matchCentre.playerXgNotSupplied']} />
              </p>
            </div>
          )}
        </Module>

        <section className="flex flex-col gap-2" data-testid="form">
          <h2 className="text-lg font-semibold">
            <MessageText message={m['matchCentre.recentForm']} />
          </h2>
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
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
        </section>

        <Module
          title={m['matchCentre.headToHead']}
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
      </Region>

      <Region id="context">{slots.context}</Region>

      <Region id="lineups">
        <Module
          title={m['matchCentre.lineups']}
          module={centre.lineups}
          testId="lineups"
          words={words}
          empty={f.status === 'scheduled' ? 'matchCentre.lineupsNotYet' : null}
        >
          {(lineups) => (
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <Side
                name={f.home.name}
                formation={f.home.formation}
                coach={f.home.coach?.name ?? null}
                players={lineups.home}
                locale={locale}
                words={words}
              />
              <Side
                name={f.away.name}
                formation={f.away.formation}
                coach={f.away.coach?.name ?? null}
                players={lineups.away}
                locale={locale}
                words={words}
              />
            </div>
          )}
        </Module>

        <Module
          title={m['player.availability.title']}
          module={centre.availability}
          testId="availability"
          words={words}
          empty={ABSENCE_GAP_KEY[centre.availability.gap ?? 'not_asked']}
        >
          {(absences) =>
            absences.length === 0 ? (
              <p className="text-sm">
                {centre.availability.last_updated_at === null ? (
                  <MessageText message={m['matchCentre.noAbsences']} />
                ) : (
                  <MessageText
                    message={filled(m['matchCentre.noAbsencesAsked'], {
                      time: formatKickoff(locale, centre.availability.last_updated_at, timeZone),
                    })}
                  />
                )}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                {(
                  [
                    ['home', f.home.name],
                    ['away', f.away.name],
                  ] as const
                ).map(([side, team]) => (
                  <div key={side} className="flex flex-col gap-1">
                    <h3 className="font-medium">{team}</h3>
                    <ul className="flex flex-col gap-1">
                      {absences
                        .filter((a) => a.side === side)
                        .map((a) => (
                          <li key={a.id}>
                            <Link href={`/${locale}/player/${a.id}`}>{a.name}</Link>{' '}
                            <span className="text-muted">
                              <MessageText
                                message={
                                  m[a.status === 'out' ? 'matchCentre.out' : 'matchCentre.doubtful']
                                }
                              />
                              {a.reason === null ? '' : ` · ${a.reason}`}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          }
        </Module>
      </Region>

      <Region id="players">{slots.players}</Region>

      <Region id="forecast">{slots.forecast}</Region>
      <Region id="analysis">{slots.analysis}</Region>
      <Region id="community">{slots.community}</Region>
      <Region id="discussion">{slots.discussion}</Region>
      <Region id="watch">{slots.watch}</Region>
      <Region id="news">{slots.news}</Region>

      <section className="flex flex-col gap-2" data-testid="coverage">
        <h2 className="text-lg font-semibold">
          <MessageText message={m['matchCentre.coverage']} />
        </h2>
        <ul className="flex flex-wrap gap-2 text-xs">
          {(
            Object.entries(centre.coverage) as [CoverageModule, Covered<unknown>['coverage']][]
          ).map(([module, state]) => (
            <li key={module} dir="auto" className="rounded border border-default px-2 py-1">
              <MessageText
                message={filled(m['matchCentre.moduleCoverage'], {
                  module: m[MODULE_KEY[module]].text,
                  state: moduleState(state).text,
                })}
              />
            </li>
          ))}
        </ul>
      </section>

      {NOT_YET.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="not-yet">
          <h2 className="text-lg font-semibold">
            <MessageText message={m['matchCentre.notYet']} />
          </h2>
          <ul className="flex flex-wrap gap-2 text-xs text-muted">
            {NOT_YET.map(([name, why]) => (
              <li key={name} dir="auto" className="rounded border border-default px-2 py-1">
                {name}: {why}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A module's title and its coverage tag, a gap between them in either direction. */
const MODULE_HEADING = 'flex flex-wrap items-baseline gap-x-2 gap-y-1 text-lg font-semibold';

/**
 * A coverage state beside a heading, and every sentence that says why a
 * module is empty, carry `dir="auto"` (T-605): a fallback English sentence in
 * a right-to-left paragraph has its full stop resolved by the paragraph, so it
 * rendered as ".Data for this module is delayed". With its own direction it
 * reads as the sentence it is.
 */
function CoverageTag({ children }: { children: React.ReactNode }) {
  return (
    <span dir="auto" className="text-xs font-normal uppercase text-muted">
      {children}
    </span>
  );
}

function Module<T>({
  title,
  module,
  testId,
  words,
  empty,
  children,
}: {
  title: Message;
  module: Covered<T>;
  testId: string;
  words: MatchWords;
  /** Says why a `not_supplied` module is empty, where more is known (T-1364). */
  empty?: Key | null;
  children: (data: T) => React.ReactNode;
}) {
  const m = words.m;
  const why: Key =
    module.coverage === 'delayed'
      ? 'matchCentre.moduleDelayed'
      : (empty ?? 'matchCentre.moduleNotSupplied');
  return (
    <section className="flex flex-col gap-2" data-testid={testId} data-coverage={module.coverage}>
      <h2 className={MODULE_HEADING}>
        <span>
          <MessageText message={title} />
        </span>
        <CoverageTag>
          <MessageText message={m[COVERAGE_KEY[module.coverage]]} />
        </CoverageTag>
      </h2>
      {module.data === null ? (
        <p dir="auto" className="text-sm text-muted">
          <MessageText message={m[why]} />
        </p>
      ) : (
        children(module.data)
      )}
    </section>
  );
}

function Side({
  name,
  formation,
  coach,
  players,
  locale,
  words,
}: {
  name: string;
  formation: string | null;
  coach: string | null;
  players: MatchLineupPlayer[];
  locale: string;
  words: MatchWords;
}) {
  const m = words.m;
  const starters = players.filter((p) => p.role === 'starter');
  const bench = players.filter((p) => p.role === 'bench');
  // Every line-up name links to the player page (blueprint 5.3, T-037).
  const line = (p: MatchLineupPlayer): React.ReactNode => (
    <>
      <EntityImage media={p.photo} kind="photo" name={p.name} size={40} />
      <span className="min-w-0">
        {p.shirt_number !== null ? `${formatNumber(locale, p.shirt_number)} ` : ''}
        <Link href={`/${locale}/player/${p.id}`} className="underline">
          {p.name}
        </Link>
        {p.is_captain ? ` ${m['matchCentre.captain'].text}` : ''}
      </span>
    </>
  );
  return (
    <div className="flex flex-col gap-1">
      <h3 className="flex flex-wrap items-baseline gap-x-2 font-medium">
        <bdi>{name}</bdi>
        {formation !== null ? (
          <span dir="ltr" className="text-muted">
            {formation}
          </span>
        ) : null}
      </h3>
      <p className="text-xs text-muted">
        <MessageText
          message={filled(m['matchCentre.coach'], {
            name: coach ?? m['status.coverage.notSupplied'].text,
          })}
        />
      </p>
      <ul>
        {starters.map((p) => (
          <li key={p.id} className={LINEUP_ROW}>
            {line(p)}
          </li>
        ))}
      </ul>
      {bench.length > 0 && (
        <>
          <p className="mt-1 text-xs uppercase text-muted">
            <MessageText message={m['matchCentre.bench']} />
          </p>
          <ul className="text-muted">
            {bench.map((p) => (
              <li key={p.id} className={LINEUP_ROW}>
                {line(p)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** A line-up row: the photo, then the shirt number and the name on one line (T-1321). */
const LINEUP_ROW = 'flex items-center gap-2 py-0.5';

/** A form letter's badge: won, drawn, lost in the theme's own tones (T-1204). */
const RESULT_TONE: Record<FormEntry['result'], string> = {
  W: 'bg-success text-canvas',
  D: 'bg-surface-raised text-fg',
  L: 'bg-danger text-canvas',
};

/** "13 Sept 2026" in the viewer's zone. */
function formatShortDate(locale: string, iso: string, timeZone: string): string {
  return formatDate(locale, iso, timeZone, { day: 'numeric', month: 'short', year: 'numeric' });
}

function Form({
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
      <h3 className="flex flex-wrap items-baseline gap-x-2 font-medium">
        <bdi>{name}</bdi>
        <CoverageTag>
          <MessageText message={m[COVERAGE_KEY[module.coverage]]} />
        </CoverageTag>
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
