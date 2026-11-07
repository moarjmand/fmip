import Link from '@/components/ui/link';
import { Fragment, type ReactNode } from 'react';
import type {
  CompetitionPage,
  ConferenceTable,
  FormResult,
  GroupTable,
  LeagueZone,
  LeagueZoneKind,
  LeagueZones,
  TableRow,
} from '@fmip/contracts';
import { zoneOfPlace, zonesOfTable } from '@fmip/contracts';
import { EntityImage } from '@/components/entity-image';
import { FormSquares } from '@/components/form-squares';
import { LtrNumeric } from '@/components/score';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { formatNumber } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { listText, say, stageName, ZONE_KEY, ZONE_MARK, zoneBand } from '@/lib/competition';

/**
 * The table's figure columns (T-1203). The abbreviations are the catalogue's
 * (T-1304): Persian uses short words that fit a phone column, the whole word
 * in the title. The goals are one column, scored and conceded as "20:9"
 * (T-1498, the Stadiomind canvas). Since T-1760 (D-377) every column is in
 * the table at every width: on a phone the place and team stay fixed at the
 * start edge and the rest slides under them. `phone` now matters only to a
 * summary, which keeps the columns a reader ranks by.
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

/**
 * The fixed start column (T-1760, D-377; board P5-2): the place and the team
 * stick to the start edge of the table's own sideways scroll -- the right
 * edge in Persian -- and paint the surface so the sliding figures never show
 * through. 120px on a phone (place 30, team 90, names whole on two lines, a
 * hairline on the fixed edge); from the tablet width the place is the 44px
 * "#" column. Horizontal only: nothing sticks to the top, so the sticky site
 * header (D-376) is never fought.
 */
const FIXED = {
  place: 'sticky start-0 z-1 bg-surface w-[30px] min-w-[30px] ps-1 pe-0 sm:w-11 sm:min-w-11',
  team: 'sticky start-[30px] z-1 bg-surface sm:start-11 max-sm:w-[90px] max-sm:min-w-[90px] max-sm:max-w-[90px] max-sm:border-e max-sm:border-e-default',
};

/** A row's hairline, on its cells: a separated table draws no border on a row. */
const HAIRLINE = 'border-t border-t-default';

/**
 * The line a divider draws in the colour of the band above it (T-1761,
 * D-381): the same tokens as `ZONE_MARK`, none new.
 */
const ZONE_RULE: Record<LeagueZoneKind, string> = {
  champions_league: 'border-y-accent',
  afc_champions_league: 'border-y-accent',
  afc_champions_league_elite: 'border-y-accent',
  copa_libertadores: 'border-y-accent',
  title_playoffs: 'border-y-accent',
  title_playoffs_wild_card: 'border-y-strong',
  promotion: 'border-y-accent',
  promotion_playoff: 'border-y-strong',
  relegation_playoff: 'border-y-warning',
  relegation: 'border-y-danger',
  league_phase_round_of_16: 'border-y-accent',
  league_phase_playoff: 'border-y-strong',
  league_phase_out: 'border-y-default',
};

/** Where a cup's league phase stands (T-1761, D-381), read from the rows' `played`. */
export type LeaguePhase =
  | { state: 'provisional'; least: number; most: number; matches: number }
  | { state: 'final'; matches: number };

/**
 * Whether a cup's league phase is over: final once every club the entry
 * counts has played the entry's `matches`, provisional while any match
 * remains (rule 4). Never a date. Null for a league, whose entry has no
 * `matches`, and where no zones are listed.
 */
export function leaguePhase(
  zones: LeagueZones | null,
  rows: readonly TableRow[],
): LeaguePhase | null {
  if (zones?.state !== 'listed' || zones.matches === undefined || zones.matches === null)
    return null;
  const matches = zones.matches;
  const played = rows.map((r) => r.played);
  // A club the table does not list yet has played none.
  const least = rows.length < zones.teams ? 0 : Math.min(...played, matches);
  const most = Math.max(0, ...played);
  return least >= matches
    ? { state: 'final', matches }
    : { state: 'provisional', least, most, matches };
}

/**
 * The band above and below the line after a row (T-1761, D-381): drawn only
 * on a cup's league phase, whose bands cover every place, where one band ends
 * and the next begins. Null for every other row and every league.
 */
export function zoneDivider(
  zones: LeagueZones | null,
  conference: string | null,
  position: number,
  next: number | undefined,
): { above: LeagueZone; below: LeagueZone } | null {
  if (zones?.state !== 'listed' || zones.matches === undefined || zones.matches === null)
    return null;
  if (next === undefined) return null;
  const own = zonesOfTable(zones.zones, conference);
  const above = zoneOfPlace(own, position);
  const below = zoneOfPlace(own, next);
  return above !== null && below !== null && above !== below ? { above, below } : null;
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
 * its first and last cells (T-1498). On a phone the fixed place cell sits at
 * the card's edge with its zone mark (T-1760, board P5-2); from the tablet
 * width it keeps the margin. The last cell is the form, at every width
 * since T-1760; a summary's last is the points until its form appears.
 */
const EDGE = {
  start: 'sm:ps-4.5',
  pointsEndSummary: 'max-sm:pe-4',
  formEnd: 'pe-4 sm:pe-4.5',
  /** A line under a table that runs to its card's edges. */
  line: 'px-4 sm:px-4.5',
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

/** A goal difference with its sign: "+7", "−2", "0", in the locale's digits. */
export function signedGap(locale: string, value: number): string {
  const n = formatNumber(locale, Math.abs(value));
  return value > 0 ? `+${n}` : value < 0 ? `−${n}` : n;
}

/**
 * One table's grid (T-035, T-1203), the competition page's league table and
 * each of its group tables alike (T-1336). `zones` marks a league's places
 * (T-1167) only where the feed lists them; a group has none, and keeps the
 * blank edge so the numbers line up. A conference's table (`conference`)
 * marks the places listed for that conference only, the league's one table
 * those listed for no conference (T-1674, D-323).
 *
 * The Stadiomind look (T-1498): tabular figures, hairlines between rows, the
 * points in the heavy weight. `summary` keeps the columns a reader ranks by;
 * `flush` is a table that runs to its card's edges.
 *
 * T-1760 (D-377; boards P5-2, P5-5): on a phone every column is in reach --
 * the place and team fixed at the start edge, the figures and the form (last)
 * sliding sideways in the table's own box, which a keyboard can reach and a
 * screen reader hears named; one line under the table says to swipe for the
 * form, instead of explaining columns the reader cannot see. The form is
 * D-367's squares. On the desktop the table is at most 960px wide with a 44px
 * "#" column. CSS alone: no client JavaScript.
 *
 * T-1761 (D-381): a cup's league phase (an entry with `matches`) draws a
 * labelled line after each band, naming the band above and below, and says
 * under the table whether the phase is over (`leaguePhase`). Every number
 * comes from the entry and the rows; none is written here (rule 2).
 */
export function StandingsTable({
  rows,
  locale,
  zones,
  conference = null,
  caption,
  summary = false,
  flush = false,
}: {
  rows: TableRow[];
  locale: string;
  zones: LeagueZones | null;
  /** The conference this table is (T-1674); null for the league's one table. */
  conference?: string | null;
  /** The table's name for a screen reader. */
  caption?: string;
  summary?: boolean;
  flush?: boolean;
}) {
  const columns = summary
    ? TABLE_COLUMNS.filter((c) => SUMMARY_LABELS.includes(c.label))
    : TABLE_COLUMNS;
  // A summary keeps its phone columns (T-1203); the full table shows them all.
  const cell = (phone: boolean, base: string) => (summary ? cellClass(phone, base) : base);
  const formCell = summary ? 'hidden sm:table-cell' : '';
  const start = flush ? EDGE.start : 'sm:ps-2';
  const pointsEnd = flush && summary ? EDGE.pointsEndSummary : '';
  const formEnd = flush ? EDGE.formEnd : '';
  const span = columns.length + 4;
  const phase = leaguePhase(zones, rows);
  const name = caption ?? say(locale, 'competitionPage.table');
  return (
    <div className="flex flex-col gap-2">
      <div
        className="scroll-cue overflow-x-auto @container focus-visible:outline-2 focus-visible:outline-offset-2"
        // The box scrolls sideways on a phone: a keyboard reaches it, a screen reader hears its name.
        tabIndex={0}
        role="region"
        aria-label={say(locale, 'competitionPage.tableScroll', { name })}
        data-testid="table-scroll"
      >
        <table className="w-full max-w-[60rem] border-separate border-spacing-0 text-sm tabular-nums">
          {caption !== undefined && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              <th
                scope="col"
                className={cx(TH, FIXED.place, start, 'border-s-4 border-s-transparent text-start')}
              >
                #
              </th>
              <th scope="col" className={cx(TH, FIXED.team, 'text-start')}>
                <Translated locale={locale} message="competitionPage.col.team" />
              </th>
              {columns.map((c) => (
                <th key={c.label} scope="col" className={cell(c.phone, `${TH} text-center`)}>
                  <abbr title={say(locale, c.title)} className="no-underline">
                    {say(locale, c.label)}
                  </abbr>
                </th>
              ))}
              <th scope="col" className={cx(TH, pointsEnd, 'text-center')}>
                <abbr
                  title={say(locale, 'competitionPage.col.pointsTitle')}
                  className="no-underline"
                >
                  {say(locale, 'competitionPage.col.points')}
                </abbr>
              </th>
              <th scope="col" className={cx(formCell, TH, formEnd, 'text-start')}>
                <Translated locale={locale} message="competitionPage.col.form" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const divider = zoneDivider(zones, conference, row.position, rows[i + 1]?.position);
              return (
                <Fragment key={row.team.id}>
                  <tr data-testid="table-row">
                    <PlaceCell
                      locale={locale}
                      position={row.position}
                      zones={zones}
                      conference={conference}
                      start={start}
                    />
                    <td className={cx(FIXED.team, HAIRLINE, 'px-1.5 py-0')}>
                      {/* The row's height is the link's: a 44px target on a phone (T-1558). */}
                      <Link
                        href={`/${locale}/team/${row.team.id}`}
                        className="inline-flex min-h-touch items-center gap-2 font-bold break-words hover:underline focus-visible:underline max-sm:text-[13px] max-sm:leading-tight max-sm:font-stretch-condensed"
                      >
                        {/* On a phone the name has the fixed column's 90px to itself. */}
                        <EntityImage
                          media={row.team.crest}
                          kind="crest"
                          name={row.team.name}
                          size={20}
                          className="max-sm:hidden"
                        />
                        {/* Condensed on a phone, so "Bournemouth" fits the 90px whole (it broke as
                            "Bournemou / th" on the real-data screenshots); a word longer still
                            ("Mönchengladbach") is hyphenated, and broken only as a last resort,
                            rather than spill under the figures. */}
                        <bdi className="min-w-0 max-sm:hyphens-auto max-sm:wrap-anywhere">
                          {row.team.name}
                        </bdi>
                      </Link>
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.label}
                        className={cell(c.phone, `${HAIRLINE} px-1.5 py-1 text-center`)}
                      >
                        {c.value(locale, row)}
                      </td>
                    ))}
                    <td
                      className={cx(HAIRLINE, 'px-1.5 py-1 text-center font-extrabold', pointsEnd)}
                    >
                      {formatNumber(locale, row.points)}
                    </td>
                    <td
                      className={cx(formCell, HAIRLINE, 'px-1.5 py-1 whitespace-nowrap', formEnd)}
                    >
                      <FormSquares locale={locale} form={row.form} />
                    </td>
                  </tr>
                  {divider !== null && <ZoneDividerRow locale={locale} span={span} {...divider} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {phase !== null && (
        <p
          className={cx('text-xs text-fg', flush && EDGE.line)}
          data-testid="table-phase"
          data-state={phase.state}
        >
          {phaseLine(locale, phase)}
        </p>
      )}
      {!summary && (
        <p
          className={cx('text-xs text-muted sm:hidden', flush && EDGE.line)}
          data-testid="table-swipe"
        >
          <Translated locale={locale} message="competitionPage.tableSwipe" />
        </p>
      )}
    </div>
  );
}

/** The sentence under a league phase's table (T-1761, D-381; rule 4). */
export function phaseLine(locale: string, phase: LeaguePhase): string {
  const n = (value: number) => formatNumber(locale, value);
  if (phase.state === 'final')
    return say(locale, 'competitionPage.phase.final', { matches: n(phase.matches) });
  return phase.least === phase.most
    ? say(locale, 'competitionPage.phase.provisional', {
        played: n(phase.least),
        matches: n(phase.matches),
      })
    : say(locale, 'competitionPage.phase.provisionalRange', {
        least: n(phase.least),
        most: n(phase.most),
        matches: n(phase.matches),
      });
}

/** "Round of 16 (1–8)": a band named with its places, as a divider labels it. */
function bandLabel(locale: string, zone: LeagueZone): string {
  return say(locale, 'competitionPage.zoneDivider.band', {
    zone: say(locale, ZONE_KEY[zone.kind]),
    places: zoneBand(locale, zone),
  });
}

/**
 * The line after a band (T-1761, D-381; board P5-5): the band above at the
 * start, the band below at the end, in the colour of the band above. Its
 * labels stay in view while the figures slide (they stick to the start of a
 * box as wide as the scroll box, `100cqi`). Hidden from a screen reader,
 * which hears each club's band after its place and the bands in the legend.
 */
function ZoneDividerRow({
  locale,
  span,
  above,
  below,
}: {
  locale: string;
  span: number;
  above: LeagueZone;
  below: LeagueZone;
}) {
  return (
    <tr
      aria-hidden="true"
      data-testid="zone-divider"
      data-above={above.kind}
      data-below={below.kind}
    >
      <td colSpan={span} className={cx('border-y-2 bg-surface-raised p-0', ZONE_RULE[above.kind])}>
        <div className="sticky start-0 flex min-h-[26px] w-[min(100cqi,100%)] items-center justify-between gap-2 px-3.5 text-[11.5px] font-bold text-muted">
          <span>▲ {bandLabel(locale, above)}</span>
          <span>{bandLabel(locale, below)} ▼</span>
        </div>
      </td>
    </tr>
  );
}

/**
 * The place, with its zone's start-edge mark and its name for a screen
 * reader (T-1167, D-171). A place in no zone, or a season with none listed,
 * keeps a blank edge of the same width so the numbers stay in line. The cell
 * is fixed at the start edge (T-1760).
 */
function PlaceCell({
  locale,
  position,
  zones,
  conference,
  start,
}: {
  locale: string;
  position: number;
  zones: LeagueZones | null;
  conference: string | null;
  /** The inner margin from the tablet width (the card's, when the table runs to its edges). */
  start: string;
}) {
  const zone =
    zones?.state === 'listed' ? zoneOfPlace(zonesOfTable(zones.zones, conference), position) : null;
  return (
    <td
      className={cx(
        FIXED.place,
        HAIRLINE,
        'border-s-4 py-1 text-caption',
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
 * The bands one table marks, under that table (T-1760, D-377; board P5-7):
 * a conference's play-off and wild-card places under each conference table,
 * so a phone reader meets them beside the table rather than after both. The
 * sentences on where they come from stay once, under the pair.
 */
function TableZoneKey({
  locale,
  zones,
  conference,
}: {
  locale: string;
  zones: LeagueZones | null;
  conference: string | null;
}) {
  if (zones?.state !== 'listed') return null;
  const own = zonesOfTable(zones.zones, conference);
  if (own.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" data-testid="table-zone-key">
      {own.map((z) => (
        <li key={`${z.kind}-${z.from}`} className={`border-s-4 ps-2 ${ZONE_MARK[z.kind]}`}>
          {say(locale, ZONE_KEY[z.kind])}: {zoneBand(locale, z)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The overall table of a league split into conferences, folded (T-1760,
 * D-377; board P5-7): a native closed `<details>` named with its club count,
 * so the 30-row table costs one 44px row until asked for. No script.
 */
export function OverallFold({
  locale,
  clubs,
  children,
}: {
  locale: string;
  clubs: number;
  children: ReactNode;
}) {
  return (
    <details className="group/overall" data-testid="overall-table">
      <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 rounded-tile border border-default bg-surface px-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
        {clubs > 0
          ? say(locale, 'competitionPage.overallTableFold', { count: formatNumber(locale, clubs) })
          : say(locale, 'competitionPage.overallTable')}
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="ms-auto text-muted transition-transform group-open/overall:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

/** One group stage on the page and its groups (T-1336, T-1668). */
interface StageGroups {
  id: string;
  name: string;
  superseded: boolean;
  groups: GroupTable[];
}

/**
 * Every group's table of a season's group stages (T-1336), in the API's
 * order. With several group stages (the Nations League's League A..D,
 * Argentina's Apertura and Clausura) each stage is a heading of its own and
 * its groups sit under it; with one, the stage's name ("Group Stage") would
 * only repeat the section's, so it is left out. A stage a later one has
 * replaced (T-1668: the Apertura once the Clausura is played) follows the
 * stages being played, closed under a disclosure that names it, the most
 * recent first: the page opens on the table that is moving, and the earlier
 * one is a click away. A group none of whose matches is played has no
 * positions yet: a sentence and its teams, never a grid of noughts. Groups
 * sit two abreast from the desktop width, one per row on a phone.
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
  const stages: StageGroups[] = [];
  for (const g of groups) {
    const last = stages[stages.length - 1];
    if (last !== undefined && last.id === g.stage.id) last.groups.push(g);
    else
      stages.push({
        id: g.stage.id,
        // A stage we cannot name is headed by what it holds: groups (T-1375).
        name: stageName(locale, g.stage.name) ?? say(locale, 'stage.name.groups'),
        superseded: g.stage.superseded,
        groups: [g],
      });
  }
  const several = stages.length > 1;
  const current = stages.filter((s) => !s.superseded);
  const earlier = stages.filter((s) => s.superseded).reverse();
  const grid = (stage: StageGroups) => (
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
  );
  return (
    <div className="flex flex-col gap-4">
      {current.map((stage) => (
        <div key={stage.id} className="flex flex-col gap-2" data-testid="group-stage">
          {several && <h3 className="text-base font-semibold">{stage.name}</h3>}
          {grid(stage)}
        </div>
      ))}
      {earlier.map((stage) => (
        <details
          key={stage.id}
          className="group/stage border-t border-default pt-3"
          data-testid="group-stage-earlier"
        >
          <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 rounded-control [&::-webkit-details-marker]:hidden">
            <h3 className="text-base font-semibold">{stage.name}</h3>
            <span className="text-xs text-muted">
              <Translated locale={locale} message="competitionPage.groupStageEarlier" />
            </span>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="ms-auto text-muted transition-transform group-open/stage:rotate-180"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className="pt-2">{grid(stage)}</div>
        </details>
      ))}
    </div>
  );
}

/** The conferences the catalogue names (T-1672, D-319); any other is shown as the API names it. */
const CONFERENCE_KEY: Record<string, MessageKey> = {
  'Eastern Conference': 'competitionPage.conference.eastern',
  'Western Conference': 'competitionPage.conference.western',
};

/** A conference's name in the reader's words, or as the API names it when the catalogue has none. */
export function conferenceName(locale: string, name: string): string {
  const key = CONFERENCE_KEY[name];
  return key === undefined ? name : say(locale, key);
}

/**
 * The conference tables of a league split into them (T-1672, D-319: Major
 * League Soccer's Eastern and Western Conference), each its own clubs ranked
 * over all their league matches. A conference none of whose clubs has played
 * says so and names them, never a grid of noughts. Each marks the places the
 * committed list names for its conference (T-1674, D-323: MLS's play-off and
 * wild-card places), matched by the conference's stored name; a conference
 * the list does not name has none.
 *
 * T-1760 (D-377, board P5-7): side by side only when the competition column
 * itself is at least 1,100px (a container query, not the viewport: at 1440
 * the column is 854px and two tables crushed each other's form), one above
 * the other otherwise; each table's bands under it.
 */
export function ConferenceTables({
  conferences,
  locale,
  zones,
}: {
  conferences: ConferenceTable[];
  locale: string;
  zones: LeagueZones | null;
}) {
  return (
    <div className="@container" data-testid="conference-grid">
      <div className="grid grid-cols-1 gap-4 @min-[68.75rem]:grid-cols-2">
        {conferences.map((c) => {
          const name = conferenceName(locale, c.name);
          return (
            <div
              key={c.name}
              className="flex min-w-0 flex-col gap-1"
              data-testid="conference-table"
              data-conference={c.name}
            >
              <h3 className="text-sm font-semibold">{name}</h3>
              {c.rows.length === 0 ? (
                <p className="text-sm text-muted" data-testid="conference-not-started">
                  <Translated locale={locale} message="competitionPage.conferenceNotStarted" />{' '}
                  {listText(
                    locale,
                    c.teams.map((t) => t.name),
                  )}
                </p>
              ) : (
                <>
                  <StandingsTable
                    rows={c.rows}
                    locale={locale}
                    zones={zones}
                    conference={c.name}
                    caption={name}
                  />
                  <TableZoneKey locale={locale} zones={zones} conference={c.name} />
                </>
              )}
            </div>
          );
        })}
      </div>
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
