import type { TeamSeasonMinuteBand, TeamSeasonScore } from '@fmip/contracts';
import { localDigits } from '@/i18n/format';

/**
 * The team page's season statistics (T-1437, D-228): pure helpers, so the
 * rules are tested without rendering.
 */

/** How many results the form strip shows. */
export const FORM_SHOWN = 10;

export type FormResult = 'W' | 'D' | 'L';

/** The latest `n` results of the provider's form, oldest first as it writes them. */
export function latestForm(form: string | null, n: number = FORM_SHOWN): FormResult[] {
  if (form === null) return [];
  return [...form].filter((r): r is FormResult => r === 'W' || r === 'D' || r === 'L').slice(-n);
}

/** One row of the goals-by-minute chart: goals scored and conceded in a band. */
export interface MinuteRow {
  from: number;
  to: number;
  scored: number;
  conceded: number;
  /** Each as a percent of the busiest band, for the bars. */
  scoredWidth: number;
  concededWidth: number;
}

/**
 * The bands of both sides as rows in minute order. A band one side lists and
 * the other does not is a band without a goal on that side (the provider
 * writes such a band as `null`, kept out by the adapter). `[]` when neither
 * side has a band.
 */
export function minuteRows(
  scored: TeamSeasonMinuteBand[] | null,
  conceded: TeamSeasonMinuteBand[] | null,
): MinuteRow[] {
  const byBand = new Map<string, { from: number; to: number; scored: number; conceded: number }>();
  const add = (bands: TeamSeasonMinuteBand[] | null, side: 'scored' | 'conceded') => {
    for (const b of bands ?? []) {
      const key = `${b.from}-${b.to}`;
      const row = byBand.get(key) ?? { from: b.from, to: b.to, scored: 0, conceded: 0 };
      row[side] += b.goals;
      byBand.set(key, row);
    }
  };
  add(scored, 'scored');
  add(conceded, 'conceded');
  const rows = [...byBand.values()].sort((a, b) => a.from - b.from);
  const most = Math.max(1, ...rows.map((r) => Math.max(r.scored, r.conceded)));
  return rows.map((r) => ({
    ...r,
    scoredWidth: Math.round((r.scored / most) * 100),
    concededWidth: Math.round((r.conceded / most) * 100),
  }));
}

/** "4–1", the team's goals first, in the reader's digits; `null` for none. */
export function scoreText(locale: string, score: TeamSeasonScore | null): string | null {
  return score === null ? null : localDigits(locale, `${score.for}–${score.against}`);
}

/** The stats tab on another season. */
export function teamSeasonHref(locale: string, teamId: string, seasonId: string): string {
  return `/${locale}/team/${encodeURIComponent(teamId)}?tab=stats&season=${encodeURIComponent(seasonId)}`;
}

/** `?season=`: the season the stats tab shows, or `null` for the default. */
export function readStatsSeason(
  params: Record<string, string | string[] | undefined>,
): string | null {
  const raw = Array.isArray(params.season) ? params.season[0] : params.season;
  return raw === undefined || raw === '' ? null : raw;
}
