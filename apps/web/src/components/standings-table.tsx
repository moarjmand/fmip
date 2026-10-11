import Link from 'next/link';
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
import { formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { FORM_KEY, listText, say, stageName, ZONE_KEY, ZONE_MARK } from '@/lib/competition';

/**
 * The table's figure columns (T-1203). On a phone the table keeps position,
 * team, played, goal difference and points, the columns a reader ranks by;
 * won, drawn, lost and the goals, and the form, appear from the tablet width
 * up. At 375 px all eleven columns squeezed the form into a stack of letters
 * and wrapped every club's name onto two lines. The abbreviations are the
 * catalogue's (T-1304): Persian uses short words that fit a phone column, the
 * whole word in the title.
 */
const TABLE_COLUMNS: {
  label: MessageKey;
  title: MessageKey;
  phone: boolean;
  value: (row: TableRow) => number;
}[] = [
  {
    label: 'competitionPage.col.played',
    title: 'competitionPage.col.playedTitle',
    phone: true,
    value: (r) => r.played,
  },
  {
    label: 'competitionPage.col.won',
    title: 'competitionPage.col.wonTitle',
    phone: false,
    value: (r) => r.won,
  },
  {
    label: 'competitionPage.col.drawn',
    title: 'competitionPage.col.drawnTitle',
    phone: false,
    value: (r) => r.drawn,
  },
  {
    label: 'competitionPage.col.lost',
    title: 'competitionPage.col.lostTitle',
    phone: false,
    value: (r) => r.lost,
  },
  {
    label: 'competitionPage.col.goalsFor',
    title: 'competitionPage.col.goalsForTitle',
    phone: false,
    value: (r) => r.goals_for,
  },
  {
    label: 'competitionPage.col.goalsAgainst',
    title: 'competitionPage.col.goalsAgainstTitle',
    phone: false,
    value: (r) => r.goals_against,
  },
  {
    label: 'competitionPage.col.goalDifference',
    title: 'competitionPage.col.goalDifferenceTitle',
    phone: true,
    value: (r) => r.goal_difference,
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

/** A header cell's look (T-1385): small, bold, muted. */
const TH = 'px-1.5 py-2 text-xs font-bold text-muted';

/**
 * The form letters as tiles, oldest to newest in the reading direction
 * (T-1385). Each result has its own letter as well as its own look -- a win
 * filled in the green, a draw on the raised ground, a loss outlined in the
 * danger colour -- so none rests on hue.
 */
const FORM_LOOK: Record<FormResult, string> = {
  W: 'bg-accent text-on-accent',
  D: 'bg-surface-raised text-fg',
  L: 'border border-danger text-danger',
};

export function FormTiles({ locale, form }: { locale: string; form: FormResult[] }) {
  // The contract lists the last five most recent first; a run reads oldest first.
  const run = [...form].reverse();
  return (
    <span className="inline-flex gap-0.75" data-testid="form">
      {run.map((result, i) => (
        <span
          key={i}
          data-result={result}
          className={`inline-grid size-6 place-items-center rounded-md text-xs font-extrabold ${FORM_LOOK[result]}`}
        >
          {say(locale, FORM_KEY[result])}
        </span>
      ))}
    </span>
  );
}

/** The projection slot's three columns (T-1385): planned, not built. */
const PROJECTION: readonly MessageKey[] = [
  'competitionPage.projection.title',
  'competitionPage.projection.topFour',
  'competitionPage.projection.relegation',
];

/** A goal difference with its sign: "+7", "−2", "0", in the locale's digits. */
export function signedGap(locale: string, value: number): string {
  const n = formatNumber(locale, Math.abs(value));
  return value > 0 ? `+${n}` : value < 0 ? `−${n}` : n;
}

/**
 * One table's grid (T-035, T-1203), the competition page's league table and
 * each of its group tables alike (T-1336). `zones` marks a league's places
 * (T-1167); a group has none, and keeps the blank edge so numbers line up.
 *
 * The Hybrid look (T-1385, D-203): tabular figures, the points in the
 * condensed display weight, the form as tiles. `summary` keeps the columns a
 * reader ranks by (played, goal difference, points, form) for the Overview.
 * `projection` adds the model's season projection as a slot that is
 * labelled "coming later" and left empty -- never a figure, never a zero
 * (rule 3) -- from the tablet width up; the sentence under the table says it
 * on a phone.
 */
export function StandingsTable({
  rows,
  locale,
  zones,
  caption,
  summary = false,
  projection = false,
}: {
  rows: TableRow[];
  locale: string;
  zones: LeagueZones | null;
  /** A group's name for a screen reader; the league table has its heading. */
  caption?: string;
  summary?: boolean;
  projection?: boolean;
}) {
  const columns = summary
    ? TABLE_COLUMNS.filter((c) => SUMMARY_LABELS.includes(c.label))
    : TABLE_COLUMNS;
  const formCell = summary ? 'hidden sm:table-cell' : 'hidden md:table-cell';
  // #, team, the figures, points and form: what the projection's header row spans first.
  const before = 2 + columns.length + 2;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">
        {caption !== undefined && <caption className="sr-only">{caption}</caption>}
        <thead>
          {projection && (
            <tr className="hidden md:table-row" data-testid="projection-head">
              <td colSpan={before} />
              <th
                colSpan={PROJECTION.length}
                scope="colgroup"
                className="border-s border-t border-dashed border-strong bg-surface-raised px-1.5 pt-2 pb-1 text-center text-xs font-extrabold text-warning uppercase"
              >
                {say(locale, 'competitionPage.projection.head')}
              </th>
            </tr>
          )}
          <tr className="border-b border-strong">
            <th scope="col" className={`${TH} text-start`}>
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
            <th scope="col" className={`${TH} text-center`}>
              <abbr title={say(locale, 'competitionPage.col.pointsTitle')} className="no-underline">
                {say(locale, 'competitionPage.col.points')}
              </abbr>
            </th>
            <th scope="col" className={`${formCell} ${TH} text-start`}>
              <Translated locale={locale} message="competitionPage.col.form" />
            </th>
            {projection &&
              PROJECTION.map((key, i) => (
                <th
                  key={key}
                  scope="col"
                  className={`hidden bg-surface-raised md:table-cell ${TH} text-center ${i === 0 ? 'border-s border-dashed border-strong' : ''}`}
                >
                  {say(locale, key)}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.team.id} className="border-b border-default" data-testid="table-row">
              <PlaceCell locale={locale} position={row.position} zones={zones} />
              <td className="px-1.5 py-2">
                <Link
                  href={`/${locale}/team/${row.team.id}`}
                  className="inline-flex min-h-7 items-center gap-2.5 font-semibold hover:underline focus-visible:underline"
                >
                  <EntityImage media={row.team.crest} kind="crest" name={row.team.name} size={20} />
                  {row.team.name}
                </Link>
              </td>
              {columns.map((c) => (
                <td
                  key={c.label}
                  className={cellClass(c.phone, 'px-1.5 py-2 text-center text-muted')}
                >
                  {c.label === 'competitionPage.col.goalDifference' ? (
                    <LtrNumeric>{signedGap(locale, c.value(row))}</LtrNumeric>
                  ) : (
                    formatNumber(locale, c.value(row))
                  )}
                </td>
              ))}
              <td className="px-1.5 py-2 text-center font-sans text-xl leading-none font-black font-stretch-condensed">
                {formatNumber(locale, row.points)}
              </td>
              <td className={`${formCell} px-1.5 py-2 whitespace-nowrap`}>
                <FormTiles locale={locale} form={row.form} />
              </td>
              {projection &&
                PROJECTION.map((key, i) => (
                  <td
                    key={key}
                    data-projection="empty"
                    className={`hidden bg-surface-raised md:table-cell ${i === 0 ? 'border-s border-dashed border-strong' : ''}`}
                  />
                ))}
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
}: {
  locale: string;
  position: number;
  zones: LeagueZones | null;
}) {
  const zone = zones?.state === 'listed' ? zoneOfPlace(zones.zones, position) : null;
  return (
    <td
      className={`border-s-4 px-1.5 py-2 text-muted ${zone === null ? 'border-s-transparent' : ZONE_MARK[zone.kind]}`}
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
