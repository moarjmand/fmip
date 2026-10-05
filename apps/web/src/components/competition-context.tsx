import Link from 'next/link';
import type {
  CompetitionContext,
  CompetitionContextTable,
  CompetitionContextTie,
  ContextStanding,
} from '@fmip/contracts';
import { formatFixtureDate } from '@/lib/competition';
import {
  absenceLine,
  countedLine,
  gapLines,
  legsNote,
  placesNote,
  pointsLabel,
  positionLine,
  roundName,
  tableHeading,
  tieLine,
} from '@/lib/competition-context';
import { legLabel, legLine } from '@/lib/bracket';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { message } from '@/i18n/messages';
import { formatKickoff } from '@/lib/scores';
import { FilledMessage } from '@/components/filled-message';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';

/** A form letter in the reader's words (T-1303). */
const RESULT_KEY = {
  W: 'matchCentre.form.won',
  D: 'matchCentre.form.drawn',
  L: 'matchCentre.form.lost',
} as const;

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
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="matchCentre.context.title" />
        </h2>
        <Notice tone="danger">
          <Translated locale={locale} message="matchCentre.context.unreachable" />
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
        <span>
          <Translated locale={locale} message="matchCentre.context.title" />
        </span>
        {table !== null && (
          <span dir="auto" className="text-xs font-normal uppercase text-muted">
            <Translated locale={locale} message={COVERAGE_KEY[table.coverage]} />
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
          {absenceLine(context, locale)}
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
  const l = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="competition-context-table">
      <h3 className="font-medium">{tableHeading(table, locale)}</h3>
      {sides.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sides.map((side) => (
            <Standing key={side.team.id} side={side} teams={table.teams} locale={locale} />
          ))}
        </div>
      )}
      {sides.length > 0 && (
        // The form here is this competition's only, so a side early in a cup
        // shows one result; Recent form is the last five anywhere (T-1364).
        <p dir="auto" className="text-xs text-muted" data-testid="competition-context-form-scope">
          <Translated locale={locale} message="matchCentre.context.formScope" />
        </p>
      )}
      {table.leader !== null && (
        <p>
          <FilledMessage
            message={message(l, 'matchCentre.context.first')}
            params={{
              team: <bdi>{table.leader.team.name}</bdi>,
              points: pointsLabel(table.leader.points, l),
            }}
          />
        </p>
      )}
      <p dir="auto" className="text-muted">
        {countedLine(table, locale)}
        {updatedAt !== null && (
          <>
            {' '}
            <FilledMessage
              message={message(l, 'matchCentre.context.lastChange')}
              params={{
                time: (
                  <time dateTime={updatedAt}>
                    {updatedAt.slice(0, 10)} {formatKickoff(locale, updatedAt, timeZone)}
                  </time>
                ),
              }}
            />
          </>
        )}
      </p>
      <p dir="auto" className="text-xs text-muted" data-testid="competition-context-places">
        {placesNote(locale)}
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
  const l = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const n = (value: number): string => formatNumber(l, value);
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
      <p>{positionLine(side, teams, locale)}</p>
      <p className="text-muted">
        <FilledMessage
          message={message(l, 'matchCentre.context.record')}
          params={{
            won: n(side.won),
            drawn: n(side.drawn),
            lost: n(side.lost),
            difference: (
              <span dir="ltr">
                {side.goal_difference > 0
                  ? `+${n(side.goal_difference)}`
                  : side.goal_difference < 0
                    ? `-${n(-side.goal_difference)}`
                    : n(0)}
              </span>
            ),
          }}
        />
      </p>
      <p>
        <span className="text-muted">
          <Translated locale={locale} message="matchCentre.context.form" />{' '}
        </span>
        {side.form.length === 0 ? (
          <Translated locale={locale} message="matchCentre.context.noForm" />
        ) : (
          <span dir="auto">{side.form.map((r) => message(l, RESULT_KEY[r]).text).join(' ')}</span>
        )}
      </p>
      <ul className="flex flex-col text-muted">
        {gapLines(side, locale).map((line) => (
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
        {roundName(tie, locale)}
        <span className="ms-2 text-xs font-normal text-muted">{legsNote(tie, locale)}</span>
      </h3>
      <ul className="flex flex-col gap-0.5">
        {tie.tie.legs.map((leg) => (
          <li key={leg.fixture_id} className="flex flex-wrap gap-x-2">
            <span className="text-muted">{legLabel(leg, legs, locale)}</span>
            {leg.fixture_id === fixtureId ? (
              <span className="font-medium">
                {legLine(leg, locale)}{' '}
                <span className="text-muted">
                  <Translated locale={locale} message="matchCentre.context.thisMatch" />
                </span>
              </span>
            ) : (
              <Link href={`/${locale}/match/${leg.fixture_id}`} className="underline">
                {legLine(leg, locale)}
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
        {tieLine(tie, locale)}
      </p>
    </div>
  );
}
