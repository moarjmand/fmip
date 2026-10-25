import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import type {
  CompetitionPage,
  FormResult,
  GroupTable,
  LeagueZones,
  TableRow,
} from '@fmip/contracts';
import { zoneOfPlace } from '@fmip/contracts';
import { EntityImage } from '@/components/entity-image';
import { LtrNumeric } from '@/components/score';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import {
  FORM_KEY,
  formLine,
  listText,
  say,
  stageName,
  ZONE_KEY,
  ZONE_MARK,
} from '@/lib/competition';

/**
 * The table's figure columns (T-1203). On a phone the table keeps position,
 * team, played, goal difference and points, the columns a reader ranks by;
 * won, drawn, lost and the goals appear from the tablet width up, the form
 * from the desktop width. The abbreviations are the catalogue's (T-1304):
 * Persian uses short words that fit a phone column, the whole word in the
 * title. The goals are one column, scored and conceded as "20:9" (T-1498,
 * the Stadiomind canvas).
 */
const TABLE_COLUMNS: {
  label: MessageKey;
  title: MessageKey;
  phone: boolean;
  value: (locale: string, row: TableRow) => ReactNode;
}[] = [
  {
    label: 'competitionPage.col.played',
    title: 'competitionPage.col.playedTitle',
    phone: true,
    value: (l, r) => formatNumber(l, r.played),
  },
  {
    label: 'competitionPage.col.won',
    title: 'competitionPage.col.wonTitle',
    phone: false,
    value: (l, r) => formatNumber(l, r.won),
  },
  {
    label: 'competitionPage.col.drawn',
    title: 'competitionPage.col.drawnTitle',
    phone: false,
    value: (l, r) => formatNumber(l, r.drawn),
  },
  {
    label: 'competitionPage.col.lost',
    title: 'competitionPage.col.lostTitle',
    phone: false,
    value: (l, r) => formatNumber(l, r.lost),
  },
  {
    label: 'competitionPage.col.goals',
    title: 'competitionPage.col.goalsTitle',
    phone: false,
    // Scored first: the pair keeps its order on a right-to-left page.
    value: (l, r) => (
      <LtrNumeric>{`${formatNumber(l, r.goals_for)}:${formatNumber(l, r.goals_against)}`}</LtrNumeric>
    ),
  },
  {
    label: 'competitionPage.col.goalDifference',
    title: 'competitionPage.col.goalDifferenceTitle',
    phone: true,
    value: (l, r) => <LtrNumeric>{signedGap(l, r.goal_difference)}</LtrNumeric>,
  },
];

function cellClass(phone: boolean, base: string): string {
  return phone ? base : `hidden sm:table-cell ${base}`;
}

/** The summary's columns (T-1385): played and goal difference, beside the points. */
const SUMMARY_LABELS: readonly MessageKey[] = [
  'competitionPage.col.played',
  'competitionPage.col.goalDifference',
];

/** A header cell's look: small, semibold, in the caption colour (the canvas's). */
const TH = 'px-1.5 py-2.5 text-xs font-semibold text-caption';

/**
 * A table that runs to its card's edges keeps the card's inner margin in
 * its first and last cells (T-1498). The last cell is the points until the
 * form appears at the desktop width (or the tablet width in a summary).
 */
const EDGE = {
  start: 'ps-4 sm:ps-4.5',
  pointsEnd: 'max-sm:pe-4 sm:max-md:pe-4.5',
  pointsEndSummary: 'max-sm:pe-4',
  formEnd: 'pe-4 sm:pe-4.5',
};

/**
 * A club's form in a match row of its own page (T-1386): each result its
 * own letter as well as its own look, so none rests on hue.
 */
export const FORM_LOOK: Record<FormResult, string> = {
  W: 'bg-accent text-on-accent',
  D: 'bg-surface-raised text-fg',
  L: 'border border-danger text-danger',
};

/**
 * The form as the canvas writes it (T-1498): the letters in Geist Mono, the
 * most recent first, as the contract lists them and the note under the
 * table says. Letters, not colours (D-263); the run is read out once, in
 * words.
 */
export function FormLetters({ locale, form }: { locale: string; form: FormResult[] }) {
  return (
    <span
      className="font-mono text-xs tracking-[0.2em] [:root:is(:lang(fa),:lang(ar))_&]:font-sans [:root:is(:lang(fa),:lang(ar))_&]:tracking-normal"
      data-testid="form"
    >
      <span aria-hidden="true">
        {form.map((result, i) => (
          <span key={i} data-result={result}>
            {say(locale, FORM_KEY[result])}
          </span>
        ))}
      </span>
      <span className="sr-only">{formLine(locale, form)}</span>
    </span>
  );
}

/** A goal difference with its sign: "+7", "−2", "0", in the locale's digits. */
export function signedGap(locale: string, value: number): string {
  const n = formatNumber(locale, Math.abs(value));
  return value > 0 ? `+${n}` : value < 0 ? `−${n}` : n;
}

/**
 * One table's grid (T-035, T-1203), the competition page's league table and
 * each of its group tables alike (T-1336). `zones` marks a league's places
 * (T-1167) only where the feed lists them; a group has none, and keeps the
 * blank edge so the numbers line up.
 *
 * The Stadiomind look (T-1498): tabular figures, hairlines between rows, the
 * points in the heavy weight, the form in letters. `summary` keeps the
 * columns a reader ranks by; `flush` is a table that runs to its card's
 * edges.
 */
export function StandingsTable({
  rows,
  locale,
  zones,
  caption,
  summary = false,
  flush = false,
}: {
  rows: TableRow[];
  locale: string;
  zones: LeagueZones | null;
  /** The table's name for a screen reader. */
  caption?: string;
  summary?: boolean;
  flush?: boolean;
}) {
  const columns = summary
    ? TABLE_COLUMNS.filter((c) => SUMMARY_LABELS.includes(c.label))
    : TABLE_COLUMNS;
  const formCell = summary ? 'hidden sm:table-cell' : 'hidden md:table-cell';
  const start = flush ? EDGE.start : '';
  const pointsEnd = flush ? (summary ? EDGE.pointsEndSummary : EDGE.pointsEnd) : '';
  const formEnd = flush ? EDGE.formEnd : '';
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">
        {caption !== undefined && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            <th scope="col" className={cx(TH, start, 'text-start')}>
              #
            </th>
            <th scope="col" className={`${TH} text-start`}>
              <Translated locale={locale} message="competitionPage.col.team" />
            </th>
            {columns.map((c) => (
              <th key={c.label} scope="col" className={cellClass(c.phone, `${TH} text-center`)}>
                <abbr title={say(locale, c.title)} className="no-underline">
                  {say(locale, c.label)}
                </abbr>
              </th>
            ))}
            <th scope="col" className={cx(TH, pointsEnd, 'text-center')}>
              <abbr title={say(locale, 'competitionPage.col.pointsTitle')} className="no-underline">
                {say(locale, 'competitionPage.col.points')}
              </abbr>
            </th>
            <th scope="col" className={cx(formCell, TH, formEnd, 'text-start')}>
              <Translated locale={locale} message="competitionPage.col.form" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.team.id} className="border-t border-default" data-testid="table-row">
              <PlaceCell locale={locale} position={row.position} zones={zones} start={start} />
              <td className="px-1.5 py-1">
                <Link
                  href={`/${locale}/team/${row.team.id}`}
                  className="inline-flex min-h-8 items-center gap-2 font-bold hover:underline focus-visible:underline"
                >
                  <EntityImage media={row.team.crest} kind="crest" name={row.team.name} size={20} />
                  {row.team.name}
                </Link>
              </td>
              {columns.map((c) => (
                <td key={c.label} className={cellClass(c.phone, 'px-1.5 py-1 text-center')}>
                  {c.value(locale, row)}
                </td>
              ))}
              <td className={cx('px-1.5 py-1 text-center font-extrabold', pointsEnd)}>
                {formatNumber(locale, row.points)}
              </td>
              <td className={cx(formCell, 'px-1.5 py-1 whitespace-nowrap', formEnd)}>
                <FormLetters locale={locale} form={row.form} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The place, with its zone's start-edge mark and its name for a screen
 * reader (T-1167, D-171). A place in no zone, or a season with none listed,
 * keeps a blank edge of the same width so the numbers stay in line.
 */
function PlaceCell({
  locale,
  position,
  zones,
  start,
}: {
  locale: string;
  position: number;
  zones: LeagueZones | null;
  /** The card's inner margin, when the table runs to its edges. */
  start: string;
}) {
  const zone = zones?.state === 'listed' ? zoneOfPlace(zones.zones, position) : null;
  return (
    <td
      className={cx(
        'border-s-4 px-1.5 py-1 text-caption',
        start,
        zone === null ? 'border-s-transparent' : ZONE_MARK[zone.kind],
      )}
      data-zone={zone?.kind}
    >
      {formatNumber(locale, position)}
      {zone !== null && <span className="sr-only"> ({say(locale, ZONE_KEY[zone.kind])})</span>}
    </td>
  );
}

/**
 * Every group's table of a season's group stages (T-1336), in the API's
 * order. With several group stages (the Nations League's League A..D) each
 * stage is a heading of its own and its groups sit under it; with one, the
 * stage's name ("Group Stage") would only repeat the section's, so it is
 * left out. A group none of whose matches is played has no positions yet:
 * a sentence and its teams, never a grid of noughts. Groups sit two abreast
 * from the desktop width, one per row on a phone.
 */
export function GroupTables({
  groups,
  locale,
  summary = false,
}: {
  groups: GroupTable[];
  locale: string;
  /** The Overview's columns (T-1385). */
  summary?: boolean;
}) {
  const stages: { id: string; name: string; groups: GroupTable[] }[] = [];
  for (const g of groups) {
    const last = stages[stages.length - 1];
    if (last !== undefined && last.id === g.stage.id) last.groups.push(g);
    else
      stages.push({
        id: g.stage.id,
        // A stage we cannot name is headed by what it holds: groups (T-1375).
        name: stageName(locale, g.stage.name) ?? say(locale, 'stage.name.groups'),
        groups: [g],
      });
  }
  const several = stages.length > 1;
  return (
    <div className="flex flex-col gap-4">
      {stages.map((stage) => (
        <div key={stage.id} className="flex flex-col gap-2" data-testid="group-stage">
          {several && <h3 className="text-base font-semibold">{stage.name}</h3>}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {stage.groups.map((g) => {
              const name = say(locale, 'matchCentre.group', { group: g.group });
              const Heading = several ? 'h4' : 'h3';
              return (
                <div
                  key={g.group}
                  className="flex min-w-0 flex-col gap-1"
                  data-testid="group-table"
                  data-group={g.group}
                >
                  <Heading className="text-sm font-semibold">{name}</Heading>
                  {g.rows.length === 0 ? (
                    <p className="text-sm text-muted" data-testid="group-not-started">
                      <Translated locale={locale} message="competitionPage.groupNotStarted" />{' '}
                      {listText(
                        locale,
                        g.teams.map((t) => t.name),
                      )}
                    </p>
                  ) : (
                    <StandingsTable
                      rows={g.rows}
                      locale={locale}
                      zones={null}
                      caption={several ? `${stage.name}, ${name}` : name}
                      summary={summary}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Whether the competition page shows its league table (T-1336): always for
 * a season without a group stage, exactly as before; beside the group tables
 * only when the league table has rows of its own, so a group competition is
 * not headed by a league table that can only say "not supplied".
 */
export function showsLeagueTable(page: Pick<CompetitionPage, 'table' | 'group_tables'>): boolean {
  return page.group_tables === null || (page.table.data ?? []).length > 0;
}
