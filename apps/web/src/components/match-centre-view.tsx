import type { Covered, FormEntry, MatchCentre, MatchLineupPlayer } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import Link from 'next/link';
import {
  INCIDENT_LABEL,
  NOT_YET,
  absenceLine,
  PLAYER_COLUMNS,
  PLAYER_XG_NOTICE,
  STAT_LABEL,
  minuteLabel,
  moduleState,
  playerCell,
  statValue,
  xgNotice,
} from '@/lib/match';
import { isBehind } from '@/lib/live';
import { formatKickoff } from '@/lib/scores';
import { formatDateTime } from '@/i18n/format';
import { Score } from '@/components/score';

/** The server-rendered panels the page slots between the live modules (T-605). */
export type MatchSlot =
  'summary' | 'players' | 'forecast' | 'analysis' | 'community' | 'discussion' | 'watch' | 'news';
export type MatchSlots = Partial<Record<MatchSlot, React.ReactNode>>;

/** The sections this view always has, whatever the page passes. */
const BUILT_IN = { timeline: true, stats: true, lineups: true } as const;

/**
 * The in-page nav, in page order. The statistical model, the founder's
 * analysis and the community are three entries with three names (rule 6).
 */
export const SECTIONS: readonly [
  key: keyof typeof BUILT_IN | Exclude<MatchSlot, 'summary'>,
  label: string,
][] = [
  ['timeline', 'Timeline'],
  ['stats', 'Stats'],
  ['lineups', 'Line-ups'],
  ['players', 'Key players'],
  ['forecast', 'Model forecast'],
  ['analysis', "Founder's analysis"],
  ['community', 'Community'],
  ['discussion', 'Discussion'],
  ['watch', 'Watch'],
  ['news', 'News'],
];

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
 * the server page and the live client component both use it.
 */
export function MatchCentreView({
  centre,
  timeZone,
  locale,
  now,
  slots = {},
}: {
  centre: MatchCentre;
  timeZone: string;
  locale: string;
  /** The client clock, ms since epoch, so a feed that stops is caught (T-083). */
  now?: number;
  /** Server-rendered panels, each placed in its own section. */
  slots?: MatchSlots;
}) {
  const f = centre.fixture;
  const headline =
    f.status === 'finished' ? (f.scores.full_time ?? f.scores.current) : f.scores.current;
  const behind = now !== undefined && isBehind(f, now);
  const status =
    f.status === 'live'
      ? behind
        ? 'Behind'
        : f.minute === null
          ? 'Live'
          : `${f.minute}′`
      : f.status === 'finished'
        ? f.scores.penalties !== null
          ? 'Pens'
          : f.scores.extra_time !== null
            ? 'AET'
            : 'FT'
        : f.status === 'scheduled'
          ? formatKickoff(locale, f.kickoff_at, timeZone)
          : f.status.charAt(0).toUpperCase() + f.status.slice(1);

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
            className="underline"
            data-testid="competition-link"
          >
            {f.competition.name}
          </Link>{' '}
          · {f.season.label}
          {f.stage !== null ? ` · ${f.stage.name}` : ''}
          {f.round !== null ? ` · ${f.round}` : ''}
          {f.group_name !== null ? ` · Group ${f.group_name}` : ''}
          {f.leg !== null ? ` · Leg ${f.leg}` : ''}
        </p>
        {/* Names wrap rather than push the score off a phone's screen. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <h1
            className="text-end text-base font-semibold hyphens-auto [overflow-wrap:anywhere] sm:text-2xl"
            data-testid="home-team"
          >
            <Link href={`/${locale}/team/${f.home.id}`}>
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
            <Link href={`/${locale}/team/${f.away.id}`}>
              <bdi>{f.away.name}</bdi>
            </Link>
          </h1>
        </div>
        {behind && (
          <p role="status" className="text-sm font-medium" data-testid="feed-behind">
            The data for this match is behind: nothing has changed since{' '}
            <time dateTime={f.last_updated_at}>
              {formatKickoff(locale, f.last_updated_at, timeZone)}
            </time>
            . The score and minute shown are the last known, not the current ones.
          </p>
        )}
        <ul className="flex flex-wrap gap-x-4 text-xs text-muted">
          {f.scores.half_time !== null && (
            <li>
              HT <Score home={f.scores.half_time.home} away={f.scores.half_time.away} />
            </li>
          )}
          {f.scores.aggregate !== null && (
            <li>
              Agg <Score home={f.scores.aggregate.home} away={f.scores.aggregate.away} />
            </li>
          )}
          {f.scores.penalties !== null && (
            <li>
              Pens <Score home={f.scores.penalties.home} away={f.scores.penalties.away} />
            </li>
          )}
          <li>
            Kick-off{' '}
            <time dateTime={f.kickoff_at}>{formatDateTime(locale, f.kickoff_at, timeZone)}</time>
          </li>
          {f.venue !== null && (
            <li>
              {f.venue.name}
              {f.venue.city !== null ? `, ${f.venue.city}` : ''}
              {f.is_neutral_venue ? ' (neutral)' : ''}
            </li>
          )}
          <li>Referee: {f.referee === null ? 'not supplied' : f.referee.name}</li>
          {f.attendance !== null && <li>Attendance {formatNumber(locale, f.attendance)}</li>}
          <li>
            Last data update{' '}
            <time dateTime={f.last_updated_at}>
              {formatKickoff(locale, f.last_updated_at, timeZone)}
            </time>
          </li>
        </ul>
      </header>

      <nav
        aria-label="On this page"
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
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Region id="timeline">
        {slots.summary}
        <Module title="Live timeline" module={centre.timeline} testId="timeline">
          {(incidents) => (
            <ol className="flex flex-col gap-1 text-sm">
              {incidents.map((i) => (
                <li key={i.id} className="flex gap-3">
                  <span className="w-12 shrink-0 tabular-nums text-muted">
                    {minuteLabel(i.minute, i.added_time)}
                  </span>
                  <span className="w-24 shrink-0 max-sm:w-auto max-sm:font-medium">
                    {INCIDENT_LABEL[i.kind]}
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {i.player !== null && (
                      <Link href={`/${locale}/player/${i.player.id}`} className="underline">
                        {i.player.name}
                      </Link>
                    )}
                    {i.related_player !== null && (
                      <>
                        {i.kind === 'substitution' ? ' ↔ ' : ' (assist '}
                        <Link
                          href={`/${locale}/player/${i.related_player.id}`}
                          className="underline"
                        >
                          {i.related_player.name}
                        </Link>
                        {i.kind === 'substitution' ? '' : ')'}
                      </>
                    )}
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
        <Module title="Statistics" module={centre.statistics} testId="statistics">
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.metric} className="border-t border-default">
                      <td className="py-1 text-end tabular-nums">
                        {statValue(row.metric, row.home)}
                      </td>
                      <th scope="row" className="px-3 py-1 text-center font-normal text-muted">
                        {STAT_LABEL[row.metric]}
                      </th>
                      <td className="py-1 tabular-nums">{statValue(row.metric, row.away)}</td>
                    </tr>
                  ))}
                  {xgNotice(rows.map((row) => row.metric)) === null ? null : (
                    <tr className="border-t border-default" data-testid="xg-not-supplied">
                      <td colSpan={3} className="py-1 text-center text-muted">
                        {xgNotice(rows.map((row) => row.metric))}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Module>

        <Module
          title="Player statistics"
          module={centre.player_statistics}
          testId="player-statistics"
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
                            Player
                          </th>
                          {PLAYER_COLUMNS.map(([metric, label]) => (
                            <th
                              key={metric}
                              scope="col"
                              className="px-2 py-1 text-end font-normal text-muted"
                            >
                              {label}
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
                                {playerCell(player, metric)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              <p className="text-muted">{PLAYER_XG_NOTICE}</p>
            </div>
          )}
        </Module>

        <section className="flex flex-col gap-2" data-testid="form">
          <h2 className="text-lg font-semibold">Recent form</h2>
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <Form
              name={f.home.name}
              module={centre.form.home}
              timeZone={timeZone}
              locale={locale}
            />
            <Form
              name={f.away.name}
              module={centre.form.away}
              timeZone={timeZone}
              locale={locale}
            />
          </div>
        </section>

        <Module title="Head-to-head" module={centre.head_to_head} testId="head-to-head">
          {(meetings) => (
            <ul className="flex flex-col gap-1 text-sm">
              {meetings.map((m) => (
                <li key={m.fixture_id} className="flex flex-wrap gap-x-3">
                  <time dateTime={m.kickoff_at} className="text-muted">
                    {m.kickoff_at.slice(0, 10)}
                  </time>
                  <span>
                    {m.home.name} <Score home={m.full_time.home} away={m.full_time.away} />{' '}
                    {m.away.name}
                  </span>
                  <span className="text-muted">
                    {m.competition.name}
                    {m.venue !== null ? ` · ${m.venue}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Module>
      </Region>

      <Region id="lineups">
        <Module title="Line-ups" module={centre.lineups} testId="lineups">
          {(lineups) => (
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <Side
                name={f.home.name}
                formation={f.home.formation}
                coach={f.home.coach?.name ?? null}
                players={lineups.home}
                locale={locale}
              />
              <Side
                name={f.away.name}
                formation={f.away.formation}
                coach={f.away.coach?.name ?? null}
                players={lineups.away}
                locale={locale}
              />
            </div>
          )}
        </Module>

        <Module title="Availability" module={centre.availability} testId="availability">
          {(absences) =>
            absences.length === 0 ? (
              <p className="text-sm">
                Nobody is reported missing or doubtful
                {centre.availability.last_updated_at === null
                  ? '.'
                  : ` (asked ${formatKickoff(locale, centre.availability.last_updated_at, timeZone)}).`}
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
                            <span className="text-muted">{absenceLine(a)}</span>
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
        <h2 className="text-lg font-semibold">Coverage for this season</h2>
        <ul className="flex flex-wrap gap-2 text-xs">
          {Object.entries(centre.coverage).map(([module, state]) => (
            <li key={module} dir="auto" className="rounded border border-default px-2 py-1">
              {module.replace('_', ' ')}:{' '}
              {moduleState({ coverage: state, last_updated_at: null, data: null })}
            </li>
          ))}
        </ul>
      </section>

      {NOT_YET.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="not-yet">
          <h2 className="text-lg font-semibold">Not on this page yet</h2>
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
 * module is empty, carry `dir="auto"` (T-605): the wording is English on
 * every page today, and an English sentence in a right-to-left paragraph has
 * its full stop resolved by the paragraph, so it rendered as ".Data for this
 * module is delayed". With its own direction it reads as the sentence it is.
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
  children,
}: {
  title: string;
  module: Covered<T>;
  testId: string;
  children: (data: T) => React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId} data-coverage={module.coverage}>
      <h2 className={MODULE_HEADING}>
        <span>{title}</span>
        <CoverageTag>{moduleState(module)}</CoverageTag>
      </h2>
      {module.data === null ? (
        <p dir="auto" className="text-sm text-muted">
          {module.coverage === 'delayed'
            ? 'Data for this module is delayed.'
            : 'Not supplied for this match.'}
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
}: {
  name: string;
  formation: string | null;
  coach: string | null;
  players: MatchLineupPlayer[];
  locale: string;
}) {
  const starters = players.filter((p) => p.role === 'starter');
  const bench = players.filter((p) => p.role === 'bench');
  // Every line-up name links to the player page (blueprint 5.3, T-037).
  const line = (p: MatchLineupPlayer): React.ReactNode => (
    <>
      {p.shirt_number !== null ? `${p.shirt_number} ` : ''}
      <Link href={`/${locale}/player/${p.id}`} className="underline">
        {p.name}
      </Link>
      {p.is_captain ? ' (c)' : ''}
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
      <p className="text-xs text-muted">Coach: {coach ?? 'not supplied'}</p>
      <ul>
        {starters.map((p) => (
          <li key={p.id}>{line(p)}</li>
        ))}
      </ul>
      {bench.length > 0 && (
        <>
          <p className="mt-1 text-xs uppercase text-muted">Bench</p>
          <ul className="text-muted">
            {bench.map((p) => (
              <li key={p.id}>{line(p)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Form({
  name,
  module,
  timeZone,
  locale,
}: {
  name: string;
  module: Covered<FormEntry[]>;
  timeZone: string;
  locale: string;
}) {
  return (
    <div className="flex flex-col gap-1" data-coverage={module.coverage}>
      <h3 className="flex flex-wrap items-baseline gap-x-2 font-medium">
        <bdi>{name}</bdi>
        <CoverageTag>{moduleState(module)}</CoverageTag>
      </h3>
      {module.data === null ? (
        <p dir="auto" className="text-xs text-muted">
          No competitive results held.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {module.data.map((e) => (
            <li key={e.fixture_id} className="flex gap-2">
              <span className="w-4 font-semibold">{e.result}</span>
              <span>
                {e.goals_for}–{e.goals_against} {e.home ? 'v' : 'at'} {e.opponent.name}
              </span>
              <span className="text-muted">
                {e.competition.name} ·{' '}
                <time dateTime={e.kickoff_at}>{formatKickoff(locale, e.kickoff_at, timeZone)}</time>{' '}
                {e.kickoff_at.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
