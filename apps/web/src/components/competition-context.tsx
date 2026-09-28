import Link from 'next/link';
import type {
  CompetitionContext,
  CompetitionContextTable,
  CompetitionContextTie,
  ContextStanding,
} from '@fmip/contracts';
import { formatFixtureDate } from '@/lib/competition';
import {
  PLACES_NOTE,
  absenceLine,
  countedLine,
  gapLines,
  legsNote,
  positionLine,
  roundName,
  tableHeading,
  tieLine,
} from '@/lib/competition-context';
import { legLabel, legLine } from '@/lib/bracket';
import { moduleState } from '@/lib/match';
import { formatKickoff } from '@/lib/scores';
import { Notice } from '@/components/ui';

/**
 * The match centre's competition context (T-840, blueprint 4.2): where both
 * sides stood in this competition before kick-off -- their table or group
 * line with competition-only form and the gaps the table supports -- or, in
 * a knockout round, which round it is and the tie's legs. A cup tie is never
 * an empty table, and a match with neither says so in a sentence (rule 3).
 * Everything stacks, so a phone and a right-to-left page need nothing extra.
 */
export function CompetitionContextPanel({
  context,
  locale,
  timeZone,
}: {
  /** Null when the API could not be reached. */
  context: CompetitionContext | null;
  locale: string;
  timeZone: string;
}) {
  if (context === null) {
    return (
      <section
        className="flex flex-col gap-2"
        data-testid="competition-context"
        data-state="unreachable"
      >
        <h2 className="text-lg font-semibold">Competition context</h2>
        <Notice tone="danger">
          The competition service could not be reached, so the table and the round cannot be shown.
        </Notice>
      </section>
    );
  }

  const table = context.table;
  const data = table?.data ?? null;
  return (
    <section
      className="flex flex-col gap-3"
      data-testid="competition-context"
      data-state={data !== null ? 'table' : context.knockout !== null ? 'knockout' : 'none'}
      data-coverage={table?.coverage ?? undefined}
    >
      <h2 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-lg font-semibold">
        <span>Competition context</span>
        {table !== null && (
          <span dir="auto" className="text-xs font-normal uppercase text-muted">
            {moduleState(table)}
          </span>
        )}
      </h2>
      <p className="text-sm text-muted">
        <Link
          href={`/${locale}/competition/${context.competition.id}?season=${context.season.id}`}
          className="underline"
        >
          {context.competition.name}
        </Link>{' '}
        {context.season.label}
      </p>
      {data !== null ? (
        <Table
          table={data}
          locale={locale}
          timeZone={timeZone}
          updatedAt={table?.last_updated_at ?? null}
        />
      ) : context.knockout !== null ? (
        <Tie
          tie={context.knockout}
          fixtureId={context.fixture_id}
          locale={locale}
          timeZone={timeZone}
        />
      ) : (
        <p dir="auto" className="text-sm text-muted" data-testid="competition-context-none">
          {absenceLine(context)}
        </p>
      )}
    </section>
  );
}

function Table({
  table,
  locale,
  timeZone,
  updatedAt,
}: {
  table: CompetitionContextTable;
  locale: string;
  timeZone: string;
  updatedAt: string | null;
}) {
  const sides = [table.home, table.away].filter((s): s is ContextStanding => s !== null);
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="competition-context-table">
      <h3 className="font-medium">{tableHeading(table)}</h3>
      {sides.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sides.map((side) => (
            <Standing key={side.team.id} side={side} teams={table.teams} locale={locale} />
          ))}
        </div>
      )}
      {table.leader !== null && (
        <p>
          First: <bdi>{table.leader.team.name}</bdi>, {table.leader.points} pts
        </p>
      )}
      <p dir="auto" className="text-muted">
        {countedLine(table)}
        {updatedAt !== null && (
          <>
            {' '}
            Last result change{' '}
            <time dateTime={updatedAt}>
              {updatedAt.slice(0, 10)} {formatKickoff(locale, updatedAt, timeZone)}
            </time>
            .
          </>
        )}
      </p>
      <p dir="auto" className="text-xs text-muted" data-testid="competition-context-places">
        {PLACES_NOTE}
      </p>
    </div>
  );
}

function Standing({
  side,
  teams,
  locale,
}: {
  side: ContextStanding;
  teams: number;
  locale: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded border border-default p-3"
      data-testid="competition-context-side"
    >
      <p className="font-medium break-words">
        <Link href={`/${locale}/team/${side.team.id}`} className="underline">
          {side.team.name}
        </Link>
      </p>
      <p>{positionLine(side, teams)}</p>
      <p className="text-muted">
        W {side.won} · D {side.drawn} · L {side.lost} · GD{' '}
        <span dir="ltr">
          {side.goal_difference > 0 ? `+${side.goal_difference}` : side.goal_difference}
        </span>
      </p>
      <p>
        <span className="text-muted">Form in this competition, latest first: </span>
        {side.form.length === 0 ? 'none yet' : <span dir="ltr">{side.form.join(' ')}</span>}
      </p>
      <ul className="flex flex-col text-muted">
        {gapLines(side).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function Tie({
  tie,
  fixtureId,
  locale,
  timeZone,
}: {
  tie: CompetitionContextTie;
  fixtureId: string;
  locale: string;
  timeZone: string;
}) {
  const legs = tie.legs_expected ?? (tie.tie.legs.length === 2 ? 2 : 1);
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="competition-context-tie">
      <h3 className="font-medium">
        {roundName(tie)}
        <span className="ms-2 text-xs font-normal text-muted">{legsNote(tie)}</span>
      </h3>
      <ul className="flex flex-col gap-0.5">
        {tie.tie.legs.map((leg) => (
          <li key={leg.fixture_id} className="flex flex-wrap gap-x-2">
            <span className="text-muted">{legLabel(leg, legs)}</span>
            {leg.fixture_id === fixtureId ? (
              <span className="font-medium">
                {legLine(leg)} <span className="text-muted">(this match)</span>
              </span>
            ) : (
              <Link href={`/${locale}/match/${leg.fixture_id}`} className="underline">
                {legLine(leg)}
              </Link>
            )}
            <span className="text-xs text-muted">
              <time dateTime={leg.kickoff_at}>
                {formatFixtureDate(locale, leg.kickoff_at, timeZone)}
              </time>
            </span>
          </li>
        ))}
      </ul>
      <p dir="auto" className="text-xs text-muted" data-testid="competition-context-outcome">
        {tieLine(tie)}
      </p>
    </div>
  );
}
