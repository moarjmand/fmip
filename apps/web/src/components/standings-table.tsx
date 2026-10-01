import Link from 'next/link';
import type { CompetitionPage, GroupTable, LeagueZones, TableRow } from '@fmip/contracts';
import { zoneOfPlace } from '@fmip/contracts';
import { EntityImage } from '@/components/entity-image';
import { Translated } from '@/components/translated';
import { formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { formLine, listText, say, stageName, ZONE_KEY, ZONE_MARK } from '@/lib/competition';

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

/**
 * One table's grid (T-035, T-1203), the competition page's league table and
 * each of its group tables alike (T-1336). `zones` marks a league's places
 * (T-1167); a group has none, and keeps the blank edge so numbers line up.
 */
export function StandingsTable({
  rows,
  locale,
  zones,
  caption,
}: {
  rows: TableRow[];
  locale: string;
  zones: LeagueZones | null;
  /** A group's name for a screen reader; the league table has its heading. */
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {caption !== undefined && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-default">
            <th scope="col" className="py-1 pe-2 text-start">
              #
            </th>
            <th scope="col" className="py-1 pe-2 text-start">
              <Translated locale={locale} message="competitionPage.col.team" />
            </th>
            {TABLE_COLUMNS.map((c) => (
              <th key={c.label} scope="col" className={cellClass(c.phone, 'py-1 pe-2 text-end')}>
                <abbr title={say(locale, c.title)}>{say(locale, c.label)}</abbr>
              </th>
            ))}
            <th scope="col" className="py-1 pe-2 text-end">
              <abbr title={say(locale, 'competitionPage.col.pointsTitle')}>
                {say(locale, 'competitionPage.col.points')}
              </abbr>
            </th>
            <th scope="col" className="hidden py-1 text-start md:table-cell">
              <Translated locale={locale} message="competitionPage.col.form" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.team.id} className="border-b border-default" data-testid="table-row">
              <PlaceCell locale={locale} position={row.position} zones={zones} />
              <td className="py-1 pe-2">
                <Link
                  href={`/${locale}/team/${row.team.id}`}
                  className="inline-flex items-center gap-2 font-medium hover:underline focus-visible:underline"
                >
                  <EntityImage media={row.team.crest} kind="crest" name={row.team.name} size={20} />
                  {row.team.name}
                </Link>
              </td>
              {TABLE_COLUMNS.map((c) => (
                <td key={c.label} className={cellClass(c.phone, 'py-1 pe-2 text-end tabular-nums')}>
                  {formatNumber(locale, c.value(row))}
                </td>
              ))}
              <td className="py-1 pe-2 text-end font-semibold tabular-nums">
                {formatNumber(locale, row.points)}
              </td>
              <td className="hidden py-1 font-mono text-xs whitespace-nowrap md:table-cell">
                {formLine(locale, row.form)}
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
}: {
  locale: string;
  position: number;
  zones: LeagueZones | null;
}) {
  const zone = zones?.state === 'listed' ? zoneOfPlace(zones.zones, position) : null;
  return (
    <td
      className={`border-s-4 py-1 ps-1 pe-2 tabular-nums ${zone === null ? 'border-s-transparent' : ZONE_MARK[zone.kind]}`}
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
export function GroupTables({ groups, locale }: { groups: GroupTable[]; locale: string }) {
  const stages: { id: string; name: string; groups: GroupTable[] }[] = [];
  for (const g of groups) {
    const last = stages[stages.length - 1];
    if (last !== undefined && last.id === g.stage.id) last.groups.push(g);
    else stages.push({ id: g.stage.id, name: stageName(locale, g.stage.name), groups: [g] });
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
