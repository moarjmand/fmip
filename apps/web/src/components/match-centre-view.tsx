import type { Covered, FormEntry, MatchCentre, MatchLineupPlayer } from '@fmip/contracts';
import Link from 'next/link';
import {
  INCIDENT_LABEL,
  NOT_YET,
  STAT_LABEL,
  minuteLabel,
  moduleState,
  statValue,
} from '@/lib/match';
import { formatKickoff } from '@/lib/scores';

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
}: {
  centre: MatchCentre;
  timeZone: string;
  locale: string;
}) {
  const f = centre.fixture;
  const headline =
    f.status === 'finished' ? (f.scores.full_time ?? f.scores.current) : f.scores.current;
  const status =
    f.status === 'live'
      ? f.minute === null
        ? 'Live'
        : `${f.minute}′`
      : f.status === 'finished'
        ? f.scores.penalties !== null
          ? 'Pens'
          : f.scores.extra_time !== null
            ? 'AET'
            : 'FT'
        : f.status === 'scheduled'
          ? formatKickoff(f.kickoff_at, timeZone)
          : f.status.charAt(0).toUpperCase() + f.status.slice(1);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2" data-testid="match-header">
        <p className="text-sm opacity-70">
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
        <div className="flex items-center gap-4">
          <h1 className="flex-1 text-end text-2xl font-semibold" data-testid="home-team">
            <Link href={`/${locale}/team/${f.home.id}`}>{f.home.name}</Link>
          </h1>
          <div className="flex flex-col items-center">
            <span className="text-3xl font-semibold tabular-nums" data-testid="score">
              {headline === null ? '–' : `${headline.home} – ${headline.away}`}
            </span>
            <span className="text-sm" data-testid="match-status">
              {status}
            </span>
          </div>
          <h1 className="flex-1 text-2xl font-semibold" data-testid="away-team">
            <Link href={`/${locale}/team/${f.away.id}`}>{f.away.name}</Link>
          </h1>
        </div>
        <ul className="flex flex-wrap gap-x-4 text-xs opacity-70">
          {f.scores.half_time !== null && (
            <li>
              HT {f.scores.half_time.home}–{f.scores.half_time.away}
            </li>
          )}
          {f.scores.aggregate !== null && (
            <li>
              Agg {f.scores.aggregate.home}–{f.scores.aggregate.away}
            </li>
          )}
          {f.scores.penalties !== null && (
            <li>
              Pens {f.scores.penalties.home}–{f.scores.penalties.away}
            </li>
          )}
          <li>
            Kick-off <time dateTime={f.kickoff_at}>{formatKickoff(f.kickoff_at, timeZone)}</time>
          </li>
          {f.venue !== null && (
            <li>
              {f.venue.name}
              {f.venue.city !== null ? `, ${f.venue.city}` : ''}
              {f.is_neutral_venue ? ' (neutral)' : ''}
            </li>
          )}
          <li>Referee: {f.referee === null ? 'not supplied' : f.referee.name}</li>
          {f.attendance !== null && <li>Attendance {f.attendance.toLocaleString('en-GB')}</li>}
          <li>
            Last data update{' '}
            <time dateTime={f.last_updated_at}>{formatKickoff(f.last_updated_at, timeZone)}</time>
          </li>
        </ul>
      </header>

      <Module title="Live timeline" module={centre.timeline} testId="timeline">
        {(incidents) => (
          <ol className="flex flex-col gap-1 text-sm">
            {incidents.map((i) => (
              <li key={i.id} className="flex gap-3">
                <span className="w-14 shrink-0 tabular-nums opacity-70">
                  {minuteLabel(i.minute, i.added_time)}
                </span>
                <span className="w-24 shrink-0">{INCIDENT_LABEL[i.kind]}</span>
                <span>
                  {i.player !== null && (
                    <Link href={`/${locale}/player/${i.player.id}`} className="underline">
                      {i.player.name}
                    </Link>
                  )}
                  {i.related_player !== null && (
                    <>
                      {i.kind === 'substitution' ? ' ↔ ' : ' (assist '}
                      <Link href={`/${locale}/player/${i.related_player.id}`} className="underline">
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

      <Module title="Statistics" module={centre.statistics} testId="statistics">
        {(rows) => (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.metric} className="border-t border-current/10">
                  <td className="py-1 text-end tabular-nums">{statValue(row.metric, row.home)}</td>
                  <th scope="row" className="px-3 py-1 text-center font-normal opacity-70">
                    {STAT_LABEL[row.metric]}
                  </th>
                  <td className="py-1 tabular-nums">{statValue(row.metric, row.away)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Module>

      <Module title="Line-ups" module={centre.lineups} testId="lineups">
        {(lineups) => (
          <div className="grid grid-cols-2 gap-4 text-sm">
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

      <section className="flex flex-col gap-2" data-testid="form">
        <h2 className="text-lg font-semibold">Recent form</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Form name={f.home.name} module={centre.form.home} timeZone={timeZone} />
          <Form name={f.away.name} module={centre.form.away} timeZone={timeZone} />
        </div>
      </section>

      <Module title="Head-to-head" module={centre.head_to_head} testId="head-to-head">
        {(meetings) => (
          <ul className="flex flex-col gap-1 text-sm">
            {meetings.map((m) => (
              <li key={m.fixture_id} className="flex flex-wrap gap-x-3">
                <time dateTime={m.kickoff_at} className="opacity-70">
                  {m.kickoff_at.slice(0, 10)}
                </time>
                <span>
                  {m.home.name} {m.full_time.home}–{m.full_time.away} {m.away.name}
                </span>
                <span className="opacity-70">
                  {m.competition.name}
                  {m.venue !== null ? ` · ${m.venue}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Module>

      <section className="flex flex-col gap-2" data-testid="coverage">
        <h2 className="text-lg font-semibold">Coverage for this season</h2>
        <ul className="flex flex-wrap gap-2 text-xs">
          {Object.entries(centre.coverage).map(([module, state]) => (
            <li key={module} className="rounded border border-current/20 px-2 py-1">
              {module.replace('_', ' ')}:{' '}
              {moduleState({ coverage: state, last_updated_at: null, data: null })}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" data-testid="not-yet">
        <h2 className="text-lg font-semibold">Not on this page yet</h2>
        <ul className="flex flex-wrap gap-2 text-xs opacity-70">
          {NOT_YET.map(([name, why]) => (
            <li key={name} className="rounded border border-current/20 px-2 py-1">
              {name}: {why}
            </li>
          ))}
        </ul>
      </section>
    </div>
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
      <h2 className="text-lg font-semibold">
        {title}
        <span className="ms-2 text-xs font-normal uppercase opacity-60">{moduleState(module)}</span>
      </h2>
      {module.data === null ? (
        <p className="text-sm opacity-70">
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
      <h3 className="font-medium">
        {name}
        {formation !== null ? <span className="ms-2 opacity-70">{formation}</span> : null}
      </h3>
      <p className="text-xs opacity-70">Coach: {coach ?? 'not supplied'}</p>
      <ul>
        {starters.map((p) => (
          <li key={p.id}>{line(p)}</li>
        ))}
      </ul>
      {bench.length > 0 && (
        <>
          <p className="mt-1 text-xs uppercase opacity-60">Bench</p>
          <ul className="opacity-80">
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
}: {
  name: string;
  module: Covered<FormEntry[]>;
  timeZone: string;
}) {
  return (
    <div className="flex flex-col gap-1" data-coverage={module.coverage}>
      <h3 className="font-medium">
        {name}
        <span className="ms-2 text-xs font-normal uppercase opacity-60">{moduleState(module)}</span>
      </h3>
      {module.data === null ? (
        <p className="text-xs opacity-70">No competitive results held.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {module.data.map((e) => (
            <li key={e.fixture_id} className="flex gap-2">
              <span className="w-4 font-semibold">{e.result}</span>
              <span>
                {e.goals_for}–{e.goals_against} {e.home ? 'v' : 'at'} {e.opponent.name}
              </span>
              <span className="opacity-70">
                {e.competition.name} ·{' '}
                <time dateTime={e.kickoff_at}>{formatKickoff(e.kickoff_at, timeZone)}</time>{' '}
                {e.kickoff_at.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
