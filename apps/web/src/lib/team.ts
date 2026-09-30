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
import { intlLocale } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { plural } from '@/i18n/messages';

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

export const POSITION_LABEL: Record<SquadPosition | 'unknown', string> = {
  goalkeeper: 'Goalkeepers',
  defender: 'Defenders',
  midfielder: 'Midfielders',
  forward: 'Forwards',
  unknown: 'Position not recorded',
};

export interface SquadGroup {
  position: SquadPosition | 'unknown';
  label: string;
  players: SquadPlayer[];
}

/** Groups in position order, shirt numbers ascending inside, empty groups left out. */
export function groupSquad(players: readonly SquadPlayer[]): SquadGroup[] {
  return POSITION_ORDER.map((position) => ({
    position,
    label: POSITION_LABEL[position],
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
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const position = plural(resolved, 'team.position', context.position).text;
  return `${position} of ${context.total} · ${context.points} pts`;
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
export function afterTimeNote(fixture: TeamPageFixture, teamId: string): string | null {
  const { shootout } = fromTeamSide(fixture, teamId);
  const parts: string[] = [];
  if (fixture.status === 'finished' && fixture.after_extra_time) parts.push('aet');
  if (shootout !== null && fixture.penalties !== null) {
    const home = fixture.home.id === teamId;
    const mine = home ? fixture.penalties.home : fixture.penalties.away;
    const theirs = home ? fixture.penalties.away : fixture.penalties.home;
    parts.push(`${shootout} ${mine}–${theirs} on penalties`);
  }
  return parts.length === 0 ? null : parts.join(', ');
}

// ---------------------------------------------------------------------------
// Home / away / total figures per competition (T-632). The table is turned on
// its side -- a row per figure, a column per split -- so it stays four
// columns wide and fits a 360px screen without scrolling.
// ---------------------------------------------------------------------------

export const SPLIT_COLUMNS = ['home', 'away', 'total'] as const;
export type SplitColumn = (typeof SPLIT_COLUMNS)[number];

export const SPLIT_COLUMN_LABEL: Record<SplitColumn, string> = {
  home: 'Home',
  away: 'Away',
  total: 'Total',
};

export const SPLIT_RECORD_ROWS: readonly { key: keyof TeamSplitRecord; label: string }[] = [
  { key: 'played', label: 'Played' },
  { key: 'won', label: 'Won' },
  { key: 'drawn', label: 'Drawn' },
  { key: 'lost', label: 'Lost' },
  { key: 'goals_for', label: 'Goals for' },
  { key: 'goals_against', label: 'Goals against' },
  { key: 'clean_sheets', label: 'Clean sheets' },
];

export const METRIC_LABEL: Record<TeamAverageMetric, string> = {
  possession_pct: 'Possession',
  shots: 'Shots',
  shots_on_target: 'Shots on target',
  corners: 'Corners',
  fouls: 'Fouls',
  pass_accuracy_pct: 'Pass accuracy',
  expected_goals: 'Expected goals',
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
export function averageNote(average: TeamStatAverage, played: number): string | null {
  if (average.coverage === 'available') return null;
  if (average.coverage === 'not_supplied') return 'Not supplied for these matches';
  return `Held for ${average.matches_with_figure.total} of ${played} matches; no average where a match lacks it`;
}

/**
 * The figures the feed never supplied for one competition's matches, named
 * once under its table (T-1205): "Not supplied for these matches: possession,
 * shots and corners."
 */
export function notSuppliedNote(labels: string[]): string {
  const names = labels.map((label, i) => (i === 0 ? label : label.toLowerCase()));
  const list =
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Not supplied for these matches: ${list}.`;
}

/** The section's standing footnote: how the figures are counted. */
export const SPLITS_FOOTNOTE =
  'From the finished matches we hold. A match decided on penalties counts as a draw; goals include extra time, never the shoot-out.';

/** The notes one competition's table needs; each only when it applies. */
export function splitNotes(splits: TeamCompetitionSplits): string[] {
  const notes: string[] = [];
  const shootouts = splits.penalty_shootouts;
  if (shootouts > 0) {
    notes.push(
      `${shootouts} ${shootouts === 1 ? 'match' : 'matches'} went to penalties, counted as ${
        shootouts === 1 ? 'a draw' : 'draws'
      }.`,
    );
  }
  const unscored = splits.finished_without_score;
  if (unscored > 0) {
    notes.push(
      `${unscored} finished ${unscored === 1 ? 'match has' : 'matches have'} no score on record and ${
        unscored === 1 ? 'is' : 'are'
      } not counted.`,
    );
  }
  return notes;
}
