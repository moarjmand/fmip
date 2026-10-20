import type { PlayerProviderSeasonLine } from '@fmip/contracts';
import { localDigits } from '@/i18n/format';

/**
 * The player page's provider seasons and career (T-1431, D-223): pure
 * helpers, so the rules are tested without rendering.
 */

/**
 * The lines to show in the provider's table, and the competitions our own
 * record already counts from the matches -- named beside the table, never
 * shown with the provider's numbers next to ours (D-223).
 */
export function splitProviderLines(lines: PlayerProviderSeasonLine[]): {
  shown: PlayerProviderSeasonLine[];
  ours: string[];
} {
  const shown = lines.filter((l) => !l.counted_by_us);
  const ours = [
    ...new Set(
      lines
        .filter((l) => l.counted_by_us)
        .map((l) => l.competition.short_name ?? l.competition.name),
    ),
  ];
  return { shown, ours };
}

/**
 * Sendings-off: a straight red and a second yellow together, only when the
 * provider gave both; with either missing the total is not known.
 */
export function sentOff(line: PlayerProviderSeasonLine): number | null {
  if (line.red_cards === null || line.second_yellow_cards === null) return null;
  return line.red_cards + line.second_yellow_cards;
}

/** Whether any line is a goalkeeper's, so the saves and conceded columns are worth showing. */
export function hasKeeperFigures(lines: PlayerProviderSeasonLine[]): boolean {
  return lines.some((l) => l.saves !== null || l.goals_conceded !== null);
}

/**
 * Season start years as runs, newest first: [2026, 2025, 2024, 2017] is
 * ["2024–2026", "2017"]. Digits in the reader's script; the caller joins them
 * with the locale's list separator.
 */
export function yearRuns(locale: string, years: number[]): string[] {
  const sorted = [...new Set(years)].sort((a, b) => b - a);
  const runs: [number, number][] = [];
  for (const y of sorted) {
    const last = runs.at(-1);
    if (last !== undefined && last[0] === y + 1) last[0] = y;
    else runs.push([y, y]);
  }
  return runs.map(([from, to]) =>
    localDigits(locale, from === to ? String(from) : `${from}–${to}`),
  );
}
