import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
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
import { formatNumber, formatVersionStamp, localDigits } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, message, t } from '@/i18n/messages';
import { zoneWords } from '@/lib/reader-time-zone';
import { FilledMessage } from '@/components/filled-message';
import { FORM_SQUARE } from '@/components/form-squares';
import { LtrNumeric } from '@/components/score';
import { COVERAGE_KEY } from '@/components/score-card';
import { signedGap } from '@/components/standings-table';
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
 * The table is a compact two-row one since T-1746 (`Table`), fit for the
 * 340px side column and a phone alike.
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
        <bdi>{localDigits(locale, context.season.label)}</bdi>
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

/**
 * The table context as a compact two-team table (T-1746, D-367; board P2-5):
 * a row per side -- position, played, won-drawn-lost, goal difference,
 * points -- then each side's form in this competition as squares that carry
 * their letter and differ in shape (filled, outlined, dashed), never in
 * colour alone; the leader; and the gaps the table supports behind a native
 * `<details>`. Two rows, not the neighbours: the page's data holds the two
 * sides, the leader and the gaps, and nothing more is fetched. Every
 * sentence the card had is kept. The table scrolls in its own box if a
 * narrow column cannot hold it.
 */
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
  const n = (value: number): string => formatNumber(l, value);
  const column = (short: MessageKey, long: MessageKey) => (
    <abbr title={t(l, long)} className="no-underline">
      <Translated locale={l} message={short} />
    </abbr>
  );
  /** Three figures in reading order, each its own box so a right-to-left page keeps the order. */
  const triple = (a: ReactNode, b: ReactNode, c: ReactNode) => (
    <span className="inline-flex gap-0.5">
      <span>{a}</span>
      <span aria-hidden="true">-</span>
      <span>{b}</span>
      <span aria-hidden="true">-</span>
      <span>{c}</span>
    </span>
  );
  const head = 'py-1 text-xs font-semibold text-muted';
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="competition-context-table">
      <h3 className="font-medium">{tableHeading(table, locale)}</h3>
      {sides.length > 0 && (
        <div className="scroll-cue overflow-x-auto">
          <table className="w-full tabular-nums" data-testid="competition-context-standings">
            <caption className="sr-only">{tableHeading(table, locale)}</caption>
            <thead>
              <tr>
                <th scope="col" className={`${head} w-7 text-start`}>
                  #
                </th>
                <th scope="col" className={`${head} text-start`}>
                  <Translated locale={l} message="competitionPage.col.team" />
                </th>
                <th scope="col" className={`${head} ps-2 text-end`}>
                  {column('competitionPage.col.played', 'competitionPage.col.playedTitle')}
                </th>
                <th scope="col" className={`${head} ps-2 text-end`}>
                  {triple(
                    column('competitionPage.col.won', 'competitionPage.col.wonTitle'),
                    column('competitionPage.col.drawn', 'competitionPage.col.drawnTitle'),
                    column('competitionPage.col.lost', 'competitionPage.col.lostTitle'),
                  )}
                </th>
                <th scope="col" className={`${head} ps-2 text-end`}>
                  {column(
                    'competitionPage.col.goalDifference',
                    'competitionPage.col.goalDifferenceTitle',
                  )}
                </th>
                <th scope="col" className={`${head} ps-2 text-end`}>
                  {column('competitionPage.col.points', 'competitionPage.col.pointsTitle')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sides.map((side) => (
                <tr
                  key={side.team.id}
                  className="border-t border-default"
                  data-testid="competition-context-side"
                >
                  <td className="py-2 text-caption">{n(side.position)}</td>
                  <th scope="row" className="py-2 text-start font-semibold break-words">
                    <Link href={`/${locale}/team/${side.team.id}`} className="underline">
                      {side.team.name}
                    </Link>
                  </th>
                  <td className="py-2 ps-2 text-end">{n(side.played)}</td>
                  <td className="py-2 ps-2 text-end whitespace-nowrap">
                    {triple(n(side.won), n(side.drawn), n(side.lost))}
                  </td>
                  <td className="py-2 ps-2 text-end">
                    <LtrNumeric>{signedGap(l, side.goal_difference)}</LtrNumeric>
                  </td>
                  <td className="py-2 ps-2 text-end font-extrabold">{n(side.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      {sides.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="competition-context-form">
          <h4 className="text-xs font-semibold text-muted">
            <Translated locale={locale} message="matchCentre.context.form" />
          </h4>
          {sides.map((side) => (
            <p key={side.team.id} className="flex items-center justify-between gap-3">
              <bdi className="min-w-0 truncate">{side.team.name}</bdi>
              {side.form.length === 0 ? (
                <span className="text-muted">
                  <Translated locale={locale} message="matchCentre.context.noForm" />
                </span>
              ) : (
                <span
                  className="inline-flex shrink-0 gap-1"
                  data-testid="competition-context-squares"
                >
                  {side.form.map((result, index) => (
                    <span
                      key={index}
                      className={`inline-grid size-6 place-items-center rounded-xs text-xs font-extrabold ${FORM_SQUARE[result]}`}
                      data-result={result}
                    >
                      {message(l, RESULT_KEY[result]).text}
                    </span>
                  ))}
                </span>
              )}
            </p>
          ))}
        </div>
      )}
      {sides.length > 0 && (
        <details data-testid="competition-context-gaps">
          <summary className="inline-flex min-h-touch cursor-pointer items-center font-semibold underline md:min-h-0">
            <Translated locale={locale} message="matchCentre.context.gaps" />
          </summary>
          <ul className="mt-1 flex flex-col gap-1 text-muted">
            {sides.map((side) => (
              <li key={side.team.id}>
                <bdi className="font-semibold text-fg">{side.team.name}</bdi>
                {': '}
                {[positionLine(side, table.teams, locale), ...gapLines(side, locale)].join(' · ')}
              </li>
            ))}
          </ul>
        </details>
      )}
      {sides.length > 0 && (
        // The form here is this competition's only, so a side early in a cup
        // shows one result; Recent form is the last five anywhere (T-1364).
        <p dir="auto" className="text-xs text-muted" data-testid="competition-context-form-scope">
          <Translated locale={locale} message="matchCentre.context.formScope" />
        </p>
      )}
      <p dir="auto" className="text-xs text-muted">
        {countedLine(table, locale)}
        {updatedAt !== null && (
          <>
            {' '}
            <FilledMessage
              message={message(l, 'matchCentre.context.lastChange')}
              params={{
                time: (
                  <time dateTime={updatedAt}>
                    {formatVersionStamp(locale, updatedAt, timeZone)} {zoneWords(locale, timeZone)}
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
