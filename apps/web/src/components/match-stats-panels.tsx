import type {
  ExpectedGoalsMetric,
  MatchCentre,
  MatchIncident,
  MatchLineupPlayer,
  MatchPlayerStats,
  MatchStatMetric,
  MatchStatRow,
  PlayerMatchMetric,
} from '@fmip/contracts';
import { LIVE_STATS_STALE_AFTER_MS } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { formatNumber } from '@/i18n/format';
import Link from '@/components/ui/link';
import { FilledMessage } from '@/components/filled-message';
import { LiveAge } from '@/components/live-age';
import { Module } from '@/components/match-centre-cards';
import { comingModules, ratingsOf } from '@/components/match-centre-view';
import { MatchLineupsView, type PlayerExtra } from '@/components/match-lineups';
import { MessageText } from '@/components/message-text';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { cx } from '@/components/ui/cx';
import { RatingChip } from '@/components/ui/rating-chip';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type ResolvedMessages, resolveMessages } from '@/i18n/messages';
import { STAT_KEY, shootoutStart, statValue } from '@/lib/match';
import { listName } from '@/lib/person-name';
import { fill, filled, formatFixed, formatMinute } from '@/lib/words';
import type { MatchWords } from '@/lib/words-server';

/**
 * The match's statistics, player tables, expected goals and line-ups, drawn
 * on the server (T-1800..T-1802, D-398..D-400) and handed to the match centre
 * through its `matchStats` and `matchLineups` slots, so none of this is in
 * the page's JavaScript (the match centre's 183 kB budget). Since T-1813
 * (D-409) the statistics are drawn in every state (`liveSlots`) and, in play,
 * drawn again by `refreshLiveModules` when the stream brings new figures; the
 * live "Stats updated 2 min ago" line (T-1782) is a `LiveAge` that ticks on
 * the page's clock. A finished match's line-ups are still drawn here only
 * after full time until T-1814.
 */

type Key = keyof MatchWords['m'];

/** The per-player columns the match centre shows (T-101), in reading order. */
export const PLAYER_COLUMNS: readonly [PlayerMatchMetric, Key][] = [
  ['minutes', 'matchCentre.player.minutes'],
  ['rating', 'matchCentre.player.rating'],
  ['goals', 'matchCentre.player.goals'],
  ['assists', 'matchCentre.player.assists'],
  ['shots', 'matchCentre.player.shots'],
  ['key_passes', 'matchCentre.player.keyPasses'],
  ['tackles', 'matchCentre.player.tackles'],
];

/**
 * The expected-goals columns (T-1432), from their own source: a keeper's xGOT
 * conceded and goals prevented are stored, not shown here.
 */
export const EXPECTED_COLUMNS: readonly [ExpectedGoalsMetric, Key][] = [
  ['xg', 'matchCentre.expectedGoals.xg'],
  ['xa', 'matchCentre.expectedGoals.xa'],
  ['xgot', 'matchCentre.expectedGoals.xgot'],
];

/** One player cell: the provider's rating to one decimal, a count as it is, `–` when not supplied. */
export function playerCell(
  locale: string,
  player: MatchPlayerStats,
  metric: PlayerMatchMetric,
): string {
  const value = player.stats[metric];
  if (value === undefined) return '–';
  return metric === 'rating' ? formatFixed(locale, value, 1) : formatNumber(locale, value);
}

/** A postponed or cancelled match had no play to record (T-1550). */
const unplayed = (centre: MatchCentre): 'unplayed' | null =>
  centre.fixture.status === 'postponed' || centre.fixture.status === 'cancelled'
    ? 'unplayed'
    : null;

/**
 * The words only these server cards say, resolved here rather than carried
 * in `MATCH_KEYS`, which the live client view receives (the match centre's
 * payload): the stats groups, the tables' legend, the team-only xG sentence
 * and the line-up marks (T-1800..T-1802).
 */
const SERVER_KEYS = [
  'matchCentre.statGroup.match',
  'matchCentre.statGroup.attack',
  'matchCentre.statGroup.passing',
  'matchCentre.statGroup.discipline',
  'matchCentre.table.legend',
  'matchCentre.expectedGoals.teamOnly',
  'matchCentre.lineups.mark.goal',
  'matchCentre.lineups.mark.penaltyGoal',
  'matchCentre.lineups.mark.ownGoal',
  'matchCentre.lineups.mark.booked',
  'matchCentre.lineups.mark.sentOff',
  'matchCentre.lineups.mark.off',
  'matchCentre.lineups.mark.on',
  'matchCentre.lineups.mark.onAlone',
  'matchCentre.lineups.marksNone',
] as const;

type Words = MatchWords['m'] & ResolvedMessages<(typeof SERVER_KEYS)[number]>;
type Side = 'home' | 'away';

/** The page's words and this module's own, in the page's locale. */
function wordsOf(locale: string, words: MatchWords): Words {
  return {
    ...words.m,
    ...resolveMessages(isLocale(locale) ? locale : DEFAULT_LOCALE, SERVER_KEYS),
  };
}

// ---------------------------------------------------------------- statistics

/**
 * The team statistics in a fixed order, in four groups (T-1800, D-398): the
 * match, attack, passing, discipline. Every metric is in exactly one group.
 */
export const STAT_GROUPS = [
  ['match', ['possession_pct', 'expected_goals']],
  [
    'attack',
    [
      'shots',
      'shots_on_target',
      'shots_off_target',
      'blocked_shots',
      'corners',
      'offsides',
      'saves',
    ],
  ],
  ['passing', ['passes', 'passes_accurate', 'pass_accuracy_pct']],
  ['discipline', ['fouls', 'yellow_cards', 'red_cards']],
] as const satisfies readonly (readonly [string, readonly MatchStatMetric[]])[];

/** Discipline: more fouls or cards is not "more" in the sense the bold figure means. */
const PLAIN: readonly MatchStatMetric[] = STAT_GROUPS[3][1];

/** The rows the feed sent, each group in its order; a group with none is left out. */
export function statGroups(rows: readonly MatchStatRow[]) {
  return STAT_GROUPS.map(
    ([group, metrics]) =>
      [group, metrics.flatMap((metric) => rows.filter((row) => row.metric === metric))] as const,
  ).filter(([, list]) => list.length > 0);
}

/**
 * Which side of a row is ahead: the larger figure, or `null` on a tie, with a
 * side missing, or for a row where more is not better.
 */
export function statLead(home: number | null, away: number | null, plain = false): Side | null {
  if (plain || home === null || away === null || home === away) return null;
  return home > away ? 'home' : 'away';
}

/**
 * One statistic between the two sides (the Design System's `StatBar`, D-263,
 * as D-398 draws it): the figures at the ends, the name between, a split bar
 * under it with the home share from the inline start. The larger figure is
 * the heavier one in ink and its share ink; the other lighter and grey. A
 * tie, a missing side and a Discipline row mark no side: both shares grey.
 * With a side missing, or nothing on both, no bar (rule 3). No club or
 * product colour.
 */
function LeadBar({ row, label, locale }: { row: MatchStatRow; label: ReactNode; locale: string }) {
  const { home, away } = row;
  const total = (home ?? 0) + (away ?? 0);
  const share = home !== null && away !== null && total > 0 ? (home / total) * 100 : null;
  const lead = statLead(home, away, PLAIN.includes(row.metric));
  const figure = (side: Side) =>
    cx(
      'text-xl leading-none tabular-nums font-stretch-condensed',
      lead === null
        ? 'font-bold text-fg'
        : lead === side
          ? 'font-black text-fg'
          : 'font-semibold text-muted',
    );
  const fill = (side: Side) => (lead === side ? 'bg-fg' : 'bg-caption');
  return (
    <div className="flex flex-col gap-1.5" data-stat-bar="" data-lead={lead ?? 'none'}>
      <div className="grid grid-cols-[minmax(3rem,auto)_minmax(0,1fr)_minmax(3rem,auto)] items-center gap-2">
        <b className={figure('home')}>
          <span dir="ltr">{statValue(row.metric, home, locale)}</span>
        </b>
        <span className="text-center text-xs text-muted">{label}</span>
        <b className={cx(figure('away'), 'text-end')}>
          <span dir="ltr">{statValue(row.metric, away, locale)}</span>
        </b>
      </div>
      {share !== null && (
        <div aria-hidden="true" className="flex h-1.5 gap-0.75">
          {share > 0 && (
            <span
              className={cx('rounded-xs', fill('home'))}
              style={{ inlineSize: `${share}%` }}
              data-side="home"
            />
          )}
          {share < 100 && (
            <span
              className={cx('rounded-xs', fill('away'))}
              style={{ inlineSize: `${100 - share}%` }}
              data-side="away"
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The team statistics (D-398). While the match is on and nothing has come,
 * "Not in yet"; once they have, "Stats updated 2 min ago" under them (T-1782,
 * rule 4) on the page's clock (`LiveAge`): asked every few minutes in play,
 * they can stop while the score moves, so past `LIVE_STATS_STALE_AFTER_MS`
 * the line turns to "may be behind" -- and says so at once when the card
 * itself was not drawn again after the stream's newer figures (D-409).
 */
function Statistics({ centre, locale, words }: Props) {
  const m = wordsOf(locale, words);
  const f = centre.fixture;
  return (
    <Module
      title={m['matchCentre.statistics']}
      module={centre.statistics}
      testId="statistics"
      words={words}
      notInYet={f.status === 'live'}
      before={unplayed(centre)}
    >
      {(rows) => (
        <>
          <p aria-hidden="true" className="-mt-1 flex justify-between gap-3.5 text-xs text-muted">
            <bdi>{f.home.name}</bdi>
            <bdi>{f.away.name}</bdi>
          </p>
          <div className="flex flex-col gap-4" data-testid="stat-grid">
            {statGroups(rows).map(([group, list]) => (
              <div key={group} className="flex flex-col gap-2.5" data-group={group}>
                <h3 className="text-xs font-extrabold text-caption">
                  <MessageText message={m[`matchCentre.statGroup.${group}`]} />
                </h3>
                <ul className="flex flex-col gap-2.5">
                  {list.map((row) => (
                    <li key={row.metric} data-metric={row.metric}>
                      <LeadBar
                        row={row}
                        label={<MessageText message={m[STAT_KEY[row.metric]]} />}
                        locale={locale}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {rows.some((row) => row.metric === 'expected_goals') ? null : (
            <p
              className="flex flex-wrap items-center justify-between gap-2 border-t border-default pt-3 text-sm text-muted"
              data-testid="xg-not-supplied"
            >
              <span dir="auto">
                <MessageText message={m['matchCentre.xgNotSupplied']} />
              </span>
              <CoverageBadge
                state="not_supplied"
                label={<MessageText message={m['status.coverage.notSupplied']} />}
              />
            </p>
          )}
          {f.status === 'live' && centre.statistics.last_updated_at !== null && (
            <LiveAge
              checkedAt={centre.statistics.last_updated_at}
              staleAfterMs={LIVE_STATS_STALE_AFTER_MS}
              locale={locale}
              words={{
                'freshness.checked': m['matchCentre.statsUpdated'],
                'freshness.behind': m['freshness.behind'],
              }}
              testId="stats-freshness"
              followsModules
            />
          )}
        </>
      )}
    </Module>
  );
}

// -------------------------------------------------------------- player tables

/**
 * The name column of a player table (T-1802, D-400): it stays at the inline
 * start while the figures scroll under it on a phone.
 */
const NAME_CELL = 'sticky start-0 z-1 bg-surface py-1 pe-2 text-start';

/**
 * A figure of a player table (T-1802): a supplied zero quiet in the caption
 * grey, so the figures that are something stand out; `–` only for a figure
 * not supplied, which the legend under the table says.
 */
function Cell({ value, children }: { value: number | undefined; children: ReactNode }) {
  return (
    <td className={cx('px-2 py-1 text-end tabular-nums', value === 0 && 'text-caption')}>
      {children}
    </td>
  );
}

function Legend({ m }: { m: Words }) {
  return (
    <p className="text-xs text-muted" data-testid="table-legend">
      <MessageText message={m['matchCentre.table.legend']} />
    </p>
  );
}

/** One side's table: a named region a keyboard can reach and scroll. */
function SideTable({
  label,
  team,
  head,
  children,
  m,
}: {
  label: string;
  team: string;
  head: ReactNode;
  children: ReactNode;
  m: Words;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="scroll-cue overflow-x-auto rounded-control"
      data-testid="player-statistics-scroll"
    >
      <table className="w-full">
        <caption className="text-start font-bold">{team}</caption>
        <thead>
          <tr>
            <th scope="col" className={cx(NAME_CELL, 'font-normal text-muted')}>
              <MessageText message={m['matchCentre.playerColumn']} />
            </th>
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function headCells(columns: readonly (readonly [string, keyof Words])[], m: Words) {
  return columns.map(([metric, label]) => (
    <th key={metric} scope="col" className="px-2 py-1 text-end font-normal text-muted">
      <MessageText message={m[label]} />
    </th>
  ));
}

const SIDES = ['home', 'away'] as const;

function PlayerStatistics({ centre, locale, words }: Props) {
  const m = wordsOf(locale, words);
  const f = centre.fixture;
  return (
    <Module
      title={m['matchCentre.playerStatistics']}
      module={centre.player_statistics}
      testId="player-statistics"
      words={words}
      before={unplayed(centre)}
    >
      {(players) => (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-caption md:hidden" data-testid="player-statistics-scroll-hint">
            <span aria-hidden="true">↔ </span>
            <MessageText message={m['matchCentre.playerStatistics.scroll']} />
          </p>
          {SIDES.map((side) => {
            const team = f[side].name;
            // A substitute who never came on did not play (T-1478): no row (rule 3).
            const rows = players.filter((p) => p.side === side && p.stats.minutes !== 0);
            if (rows.length === 0) return null;
            return (
              <SideTable
                key={side}
                label={fill(m['matchCentre.playerStatistics.region'].text, { team })}
                team={team}
                head={headCells(PLAYER_COLUMNS, m)}
                m={m}
              >
                {rows.map((player) => (
                  <tr key={player.id} className="border-t border-default">
                    <th scope="row" className={cx(NAME_CELL, 'font-normal')}>
                      <Link href={`/${locale}/player/${player.id}`}>
                        {listName(locale, player.name)}
                      </Link>
                    </th>
                    {PLAYER_COLUMNS.map(([metric]) => {
                      const value = player.stats[metric];
                      const text = playerCell(locale, player, metric);
                      return (
                        <Cell key={metric} value={value}>
                          {/* The rating as the pitch draws it (D-399). */}
                          {metric === 'rating' && value !== undefined ? (
                            <RatingChip value={value} text={text} />
                          ) : (
                            text
                          )}
                        </Cell>
                      );
                    })}
                  </tr>
                ))}
              </SideTable>
            );
          })}
          <Legend m={m} />
        </div>
      )}
    </Module>
  );
}

/**
 * Per-player expected goals from their one source (T-1432, D-224):
 * "Expected goals by player", licensed match data never named by its provider
 * in the heading (D-014, T-1802), `–` for a figure not supplied, an explicit
 * state when there are none (rule 3).
 *
 * F9: the team's xG in the statistics comes from the match feed's own team
 * statistics, these from a second source. When the card has none and the
 * statistics have the team figure, the card says it is the player breakdown
 * that is missing, never a bare "Not supplied" under a page that shows xG.
 * It never repeats or sums the team figure: the two sources stay apart.
 */
function PlayerExpectedGoals({ centre, locale, words }: Props) {
  const m = wordsOf(locale, words);
  const f = centre.fixture;
  const expected = centre.player_expected_goals;
  const teamXg = (centre.statistics.data ?? []).some((row) => row.metric === 'expected_goals');
  return (
    <Module
      title={m['matchCentre.expectedGoals']}
      module={expected}
      testId="player-expected-goals"
      words={words}
      before={unplayed(centre)}
      empty={
        teamXg
          ? m['matchCentre.expectedGoals.teamOnly']
          : expected.last_updated_at === null
            ? null
            : 'matchCentre.expectedGoals.none'
      }
    >
      {(players) => (
        <div className="flex flex-col gap-3 text-sm">
          <p className="-mt-2 text-xs text-muted" data-testid="player-expected-goals-note">
            <MessageText message={m['matchCentre.expectedGoals.note']} />
          </p>
          {SIDES.map((side) => {
            const team = f[side].name;
            const rows = players.filter((p) => p.side === side);
            if (rows.length === 0) return null;
            return (
              <SideTable
                key={side}
                label={fill(m['matchCentre.expectedGoals.region'].text, { team })}
                team={team}
                head={headCells(EXPECTED_COLUMNS, m)}
                m={m}
              >
                {rows.map((player) => (
                  <tr key={player.id} className="border-t border-default">
                    <th scope="row" className={cx(NAME_CELL, 'font-normal')}>
                      <Link href={`/${locale}/player/${player.id}`}>
                        {listName(locale, player.name)}
                      </Link>
                    </th>
                    {EXPECTED_COLUMNS.map(([metric]) => {
                      const value = player.figures[metric];
                      return (
                        <Cell key={metric} value={value}>
                          {value === undefined ? '–' : formatFixed(locale, value, 2)}
                        </Cell>
                      );
                    })}
                  </tr>
                ))}
              </SideTable>
            );
          })}
          <Legend m={m} />
          {expected.unplaced > 0 && (
            <p className="text-xs text-muted" data-testid="player-expected-goals-unplaced">
              <FilledMessage
                message={m['matchCentre.expectedGoals.unplaced']}
                params={{ count: formatNumber(locale, expected.unplaced) }}
              />
            </p>
          )}
        </div>
      )}
    </Module>
  );
}

interface Props {
  centre: MatchCentre;
  locale: string;
  words: MatchWords;
}

/**
 * The Stats tab in every state (T-1813, D-409): statistics, player
 * statistics, expected goals. Before kick-off a module the coming card names
 * (`comingModules`, T-1745) is not drawn: the card says it will come.
 */
export function MatchStats(props: Props) {
  const coming = new Set(comingModules(props.centre).map((item) => item.id));
  return (
    <>
      {!coming.has('statistics') && <Statistics {...props} />}
      {!coming.has('player_statistics') && <PlayerStatistics {...props} />}
      {!coming.has('expected_goals') && <PlayerExpectedGoals {...props} />}
    </>
  );
}

// ------------------------------------------------------------------ line-ups

/**
 * What happened to a player (T-1801, D-399): its words with the minute (the
 * mark's text equivalent) and its glyph on his disc (decoration): a ball, an
 * outlined ball for an own goal, the card's colour, an arrow.
 */
const MARK = {
  goal: ['matchCentre.lineups.mark.goal', 'size-2.5 rounded-full bg-fg'],
  penalty_goal: ['matchCentre.lineups.mark.penaltyGoal', 'size-2.5 rounded-full bg-fg'],
  own_goal: ['matchCentre.lineups.mark.ownGoal', 'size-2.5 rounded-full border-2 border-fg'],
  yellow_card: ['matchCentre.lineups.mark.booked', 'h-3 w-2 rounded-xs bg-warning'],
  second_yellow_card: ['matchCentre.lineups.mark.sentOff', 'h-3 w-2 rounded-xs bg-danger'],
  red_card: ['matchCentre.lineups.mark.sentOff', 'h-3 w-2 rounded-xs bg-danger'],
  off: ['matchCentre.lineups.mark.off', '↓'],
  on: ['matchCentre.lineups.mark.on', '↑'],
  // Came on, and the feed did not say for whom: no "for …" (T-1801).
  onAlone: ['matchCentre.lineups.mark.onAlone', '↑'],
} as const satisfies Record<string, readonly [keyof Words, string]>;

type MarkKind = keyof typeof MARK;
/** A mark: its kind, the minute as read, and the player he replaced ("" when none). */
export type Mark = readonly [MarkKind, string, string];

/**
 * Each player's marks from the match's events, in their order; a shoot-out
 * kick is never a goal of the match (D-322), and a VAR review or a missed
 * penalty marks nobody. The kicks are found as the key events find them
 * (`shootoutStart`: the feed's flag, or the shoot-out's score read back), so
 * a kick the feed did not flag is not a goal under the taker's name either.
 */
export function lineupMarks(
  incidents: readonly MatchIncident[],
  locale: string,
  scores: Pick<MatchCentre['fixture']['scores'], 'penalties' | 'current'>,
): Map<string, Mark[]> {
  const marks = new Map<string, Mark[]>();
  const add = (id: string | undefined, mark: Mark) => {
    if (id !== undefined) marks.set(id, [...(marks.get(id) ?? []), mark]);
  };
  const kicksFrom = shootoutStart(incidents, scores.penalties, scores.current);
  for (const i of kicksFrom === null ? incidents : incidents.slice(0, kicksFrom)) {
    const minute = formatMinute(locale, i.minute, i.added_time);
    if (i.kind === 'substitution') {
      add(i.player?.id, ['off', minute, '']);
      add(
        i.related_player?.id,
        i.player === null
          ? ['onAlone', minute, '']
          : ['on', minute, listName(locale, i.player.name)],
      );
    } else if (i.kind in MARK) {
      add(i.player?.id, [i.kind as MarkKind, minute, '']);
    }
  }
  return marks;
}

/**
 * The name on the pitch (T-1801): the surname alone, unless two players of
 * the match share it, when the list name ("R. James") stays. A Persian page's
 * names are its own (D-175) and pass through whole.
 */
export function pitchNames(
  players: readonly MatchLineupPlayer[],
  locale: string,
): (name: string) => string {
  const surname = (name: string) => listName(locale, name).replace(/^\p{Lu}\. /u, '');
  const all = players.map((p) => surname(p.name));
  return (name) =>
    all.filter((n) => n === surname(name)).length > 1 ? listName(locale, name) : surname(name);
}

function MarkWords({ marks, m }: { marks: readonly Mark[]; m: Words }) {
  return (
    <span className="block text-[11px] leading-tight text-muted" data-testid="lineup-marks">
      {marks.map(([kind, minute, player], index) => (
        <span key={index}>
          {index > 0 && ' · '}
          <MessageText message={filled(m[MARK[kind][0]], { minute, player })} />
        </span>
      ))}
    </span>
  );
}

function MarkGlyphs({ marks }: { marks: readonly Mark[] }) {
  return (
    <span
      aria-hidden="true"
      className="absolute -start-1 -top-0.5 flex items-center gap-px"
      data-testid="lineup-disc-marks"
    >
      {marks.map(([kind], index) => {
        const glyph = MARK[kind][1];
        return glyph.length === 1 ? (
          <span key={index} className="text-[11px] leading-none font-black text-fg">
            {glyph}
          </span>
        ) : (
          <span key={index} className={`ring-2 ring-surface-raised ${glyph}`} />
        );
      })}
    </span>
  );
}

/**
 * The line-ups of a finished match (T-1801, D-399): the view's pitch and
 * benches, with each player's surname whole, what happened to him in words
 * under his name and as a mark on his disc, and "On 68′ for …" on the bench.
 * When the match's events are not supplied, one sentence says the pitch
 * carries no marks (rule 3).
 */
export function FinishedLineups({ centre, locale, words }: Props) {
  const m = wordsOf(locale, words);
  const f = centre.fixture;
  const events = centre.timeline.data;
  const marks = lineupMarks(events ?? [], locale, f.scores);
  return (
    <Module title={m['matchCentre.lineups']} module={centre.lineups} testId="lineups" words={words}>
      {(lineups) => {
        const nameOf = pitchNames([...lineups.home, ...lineups.away], locale);
        const decorate = (p: MatchLineupPlayer): PlayerExtra => {
          const own = marks.get(p.id);
          return {
            name: nameOf(p.name),
            ...(own !== undefined && {
              marks: <MarkWords marks={own} m={m} />,
              badge: <MarkGlyphs marks={own} />,
            }),
          };
        };
        return (
          <>
            <MatchLineupsView
              home={f.home}
              away={f.away}
              lineups={lineups}
              ratings={ratingsOf(centre)}
              decorate={decorate}
              locale={locale}
              words={words}
            />
            {events === null && (
              <p dir="auto" className="text-xs text-caption" data-testid="lineup-marks-none">
                <MessageText message={m['matchCentre.lineups.marksNone']} />
              </p>
            )}
          </>
        );
      }}
    </Module>
  );
}
