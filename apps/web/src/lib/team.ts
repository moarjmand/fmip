import type {
  SquadPlayer,
  SquadPosition,
  TableContext,
  TeamAverageMetric,
  TeamCompetitionSplits,
  TeamPageFixture,
  TeamSplitRecord,
  TeamStatAverage,
} from '@fmip/contracts';
import { formatNumber, intlLocale } from '@/i18n/format';
import { type MessageKey, plural } from '@/i18n/messages';
import { listText, pageLocale, pairText, say } from '@/lib/competition';

/**
 * The team page's pure helpers (T-036): the squad grouped by position, how
 * the table context reads, and which side the team was on in a match.
 */

export const POSITION_ORDER: readonly (SquadPosition | 'unknown')[] = [
  'goalkeeper',
  'defender',
  'midfielder',
  'forward',
  'unknown',
];

export const POSITION_KEY: Record<SquadPosition | 'unknown', MessageKey> = {
  goalkeeper: 'teamPage.group.goalkeepers',
  defender: 'teamPage.group.defenders',
  midfielder: 'teamPage.group.midfielders',
  forward: 'teamPage.group.forwards',
  unknown: 'teamPage.group.unknown',
};

export interface SquadGroup {
  position: SquadPosition | 'unknown';
  label: string;
  players: SquadPlayer[];
}

/** Groups in position order, shirt numbers ascending inside, empty groups left out. */
export function groupSquad(locale: string, players: readonly SquadPlayer[]): SquadGroup[] {
  return POSITION_ORDER.map((position) => ({
    position,
    label: say(locale, POSITION_KEY[position]),
    players: players
      .filter((p) => (p.position ?? 'unknown') === position)
      .sort(
        (a, b) =>
          (a.shirt_number ?? 100) - (b.shirt_number ?? 100) ||
          a.person.name.localeCompare(b.person.name),
      ),
  })).filter((g) => g.players.length > 0);
}

/**
 * "3rd of 20 · 45 pts". The ordinal is the catalogue's `team.position`,
 * selected by the locale's own ordinal rules (T-301): the hand-rolled
 * "st/nd/rd/th" that used to live here was English arithmetic on a page that
 * ships in eight languages. Until a locale translates the entry, it is the
 * English forms by English rules, which is the honest state and says so.
 */
export function contextLine(locale: string, context: TableContext): string {
  const position = plural(pageLocale(locale), 'team.position', context.position).text;
  return say(locale, 'teamPage.contextLine', {
    position,
    total: formatNumber(locale, context.total),
    points: formatNumber(locale, context.points),
  });
}

/**
 * The match from the team's side: the opponent, home or away, and the result
 * letter once played. The score is the latest we hold (after extra time where
 * played), so the letter agrees with the home / away figures (T-632); a
 * shoot-out decides the tie, not the match -- a level score is D, with the
 * shoot-out said beside it.
 */
export function fromTeamSide(
  fixture: TeamPageFixture,
  teamId: string,
): {
  opponent: string;
  home: boolean;
  result: 'W' | 'D' | 'L' | null;
  shootout: 'won' | 'lost' | null;
} {
  const home = fixture.home.id === teamId;
  const opponent = home ? fixture.away : fixture.home;
  let result: 'W' | 'D' | 'L' | null = null;
  let shootout: 'won' | 'lost' | null = null;
  if (fixture.status === 'finished' && fixture.score !== null) {
    const mine = home ? fixture.score.home : fixture.score.away;
    const theirs = home ? fixture.score.away : fixture.score.home;
    result = mine > theirs ? 'W' : mine === theirs ? 'D' : 'L';
    const pens = fixture.penalties;
    if (result === 'D' && pens !== null && pens.home !== pens.away) {
      shootout = (home ? pens.home > pens.away : pens.away > pens.home) ? 'won' : 'lost';
    }
  }
  return { opponent: opponent.short_name ?? opponent.name, home, result, shootout };
}

/** "aet", and "won 4–3 on penalties" from the team's side, for the match line; null when neither. */
export function afterTimeNote(
  locale: string,
  fixture: TeamPageFixture,
  teamId: string,
): string | null {
  const { shootout } = fromTeamSide(fixture, teamId);
  const parts: string[] = [];
  if (fixture.status === 'finished' && fixture.after_extra_time) {
    parts.push(say(locale, 'teamPage.aet'));
  }
  if (shootout !== null && fixture.penalties !== null) {
    const home = fixture.home.id === teamId;
    const mine = home ? fixture.penalties.home : fixture.penalties.away;
    const theirs = home ? fixture.penalties.away : fixture.penalties.home;
    parts.push(
      say(locale, shootout === 'won' ? 'teamPage.penaltiesWon' : 'teamPage.penaltiesLost', {
        score: pairText(locale, mine, theirs),
      }),
    );
  }
  return parts.length === 0 ? null : parts.join(say(locale, 'competitionPage.list.separator'));
}

// ---------------------------------------------------------------------------
// Home / away / total figures per competition (T-632). The table is turned on
// its side -- a row per figure, a column per split -- so it stays four
// columns wide and fits a 360px screen without scrolling.
// ---------------------------------------------------------------------------

export const SPLIT_COLUMNS = ['home', 'away', 'total'] as const;
export type SplitColumn = (typeof SPLIT_COLUMNS)[number];

export const SPLIT_COLUMN_KEY: Record<SplitColumn, MessageKey> = {
  home: 'teamPage.split.home',
  away: 'teamPage.split.away',
  total: 'teamPage.split.total',
};

export const SPLIT_RECORD_ROWS: readonly { key: keyof TeamSplitRecord; label: MessageKey }[] = [
  { key: 'played', label: 'teamPage.row.played' },
  { key: 'won', label: 'teamPage.row.won' },
  { key: 'drawn', label: 'teamPage.row.drawn' },
  { key: 'lost', label: 'teamPage.row.lost' },
  { key: 'goals_for', label: 'teamPage.row.goalsFor' },
  { key: 'goals_against', label: 'teamPage.row.goalsAgainst' },
  { key: 'clean_sheets', label: 'teamPage.row.cleanSheets' },
];

export const METRIC_KEY: Record<TeamAverageMetric, MessageKey> = {
  possession_pct: 'teamPage.metric.possession',
  shots: 'teamPage.metric.shots',
  shots_on_target: 'teamPage.metric.shotsOnTarget',
  corners: 'teamPage.metric.corners',
  fouls: 'teamPage.metric.fouls',
  pass_accuracy_pct: 'teamPage.metric.passAccuracy',
  expected_goals: 'teamPage.metric.expectedGoals',
};

/**
 * One average cell: the figure to one decimal (a percentage for the `_pct`
 * metrics), or an en dash when the split has no match or not every match of
 * it holds the figure -- never a partial average.
 */
export function averageCell(locale: string, average: TeamStatAverage, split: SplitColumn): string {
  const value = average[split];
  if (value === null) return '–';
  const pct = average.metric.endsWith('_pct');
  return new Intl.NumberFormat(intlLocale(locale), {
    style: pct ? 'percent' : 'decimal',
    minimumFractionDigits: pct ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(pct ? value / 100 : value);
}

/** Why an average row is short, said beside it; null when it is complete. */
export function averageNote(
  locale: string,
  average: TeamStatAverage,
  played: number,
): string | null {
  if (average.coverage === 'available') return null;
  if (average.coverage === 'not_supplied') return say(locale, 'teamPage.averageNotSupplied');
  return plural(pageLocale(locale), 'teamPage.averageHeld', played, {
    held: formatNumber(locale, average.matches_with_figure.total),
  }).text;
}

/**
 * The figures the feed never supplied for one competition's matches, named
 * once under its table (T-1205): "Not supplied for these matches: possession,
 * shots and corners."
 */
export function notSuppliedNote(locale: string, labels: string[]): string {
  const names = labels.map((label, i) => (i === 0 ? label : label.toLowerCase()));
  return say(locale, 'teamPage.notSuppliedList', { list: listText(locale, names) });
}

/** The section's standing footnote: how the figures are counted. */
export const SPLITS_FOOTNOTE: MessageKey = 'teamPage.splitsFootnote';

/** The notes one competition's table needs; each only when it applies. */
export function splitNotes(locale: string, splits: TeamCompetitionSplits): string[] {
  const notes: string[] = [];
  const resolved = pageLocale(locale);
  const shootouts = splits.penalty_shootouts;
  if (shootouts > 0) notes.push(plural(resolved, 'teamPage.penaltiesNote', shootouts).text);
  const unscored = splits.finished_without_score;
  if (unscored > 0) notes.push(plural(resolved, 'teamPage.unscoredNote', unscored).text);
  return notes;
}
