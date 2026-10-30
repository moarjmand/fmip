/**
 * Past seasons' absences, for the training store only (T-1650, D-306).
 *
 * The operator's command asks the provider once per past season of each
 * competition we hold (`getSeasonAbsences`: `/injuries?league=&season=`, one
 * answer, not paged) and writes the answer into `absence_history`, which
 * nothing on the site reads. Seasons from 2021/22 on: the provider's list for
 * 2020/21 is partial (598 entries for the Premier League against 2,563 the
 * year after, measured 2026-10-29). A competition kept out of the training
 * store (`model_training = false`, D-304) is asked too: the lab reads it.
 *
 * Budget: the bulk tier's (D-183). No ask once the day's requests reach the
 * bulk share of `API_FOOTBALL_DAILY_BUDGET`, none after the provider or our
 * budget refuses with `quota`, and the asks spaced by `AskPacer` (T-1422). A
 * season the provider said it reports no absences for (T-1364) is not asked.
 */

import type { NormalisedAbsence, Provider, ProviderAdapter } from '@fmip/ingestion';
import { AskPacer } from './ask-pacer';

/** The first season start asked about: 2021/22, and a calendar season 2021. */
export const FIRST_SEASON_START = '2021-01-01';

/** Which seasons a run covers: every past one, or one label, or one competition. */
export interface AbsenceHistoryFilter {
  /** A season label, `2023/24` or `2023`; `null` for every past season. */
  seasonLabel: string | null;
  /** The provider's competition id; `null` for every competition we hold. */
  competitionExternalId: string | null;
}

/** One past season of a competition we hold, as the run asks it. */
export interface AbsenceSeason {
  competitionId: string;
  competitionName: string;
  competitionExternalId: string;
  seasonId: string;
  seasonLabel: string;
  /** Whether the provider said it reports absences for it (T-1364); `null` when never asked. */
  absencesCovered: boolean | null;
}

/** What one season's write did. */
export interface AbsenceHistoryWrite {
  /** Rows written or rewritten. */
  written: number;
  /** Entries not written because their match or club is not ours. */
  skipped: number;
  /** The provider's matches among those we do not hold. */
  fixturesUnmapped: number;
  /** The provider's players written without our person id (kept by theirs). */
  personsUnmapped: number;
}

/** The SQL the run needs. Implemented by `AbsenceHistoryStore`. */
export interface AbsenceHistoryStorePort {
  seasons(
    provider: Provider,
    filter: AbsenceHistoryFilter,
    firstSeasonStart: string,
  ): Promise<AbsenceSeason[]>;
  write(
    provider: Provider,
    absences: NormalisedAbsence[],
    fetchedAt: string,
  ): Promise<AbsenceHistoryWrite>;
  /** Fills `person_id` in on rows whose player has been mapped since. Returns rows changed. */
  relink(provider: Provider): Promise<number>;
}

export type SeasonOutcome = 'written' | 'empty' | 'not_covered' | 'refused' | 'not_asked';

/** One line of the run's summary: a competition's season and what came of it. */
export interface AbsenceSeasonLine extends AbsenceHistoryWrite {
  competition: string;
  competitionExternalId: string;
  season: string;
  outcome: SeasonOutcome;
  /** Entries in the provider's answer. */
  entries: number;
  /** Why it was refused or not asked. */
  note?: string;
}

export interface AbsenceHistorySweep {
  lines: AbsenceSeasonLine[];
  /** Requests sent. */
  asked: number;
  /** Rows given our person id at the start of the run. */
  relinked: number;
  /** Why the run asked nothing, or stopped before the end. */
  stopped?: string;
}

const NOTHING_WRITTEN: AbsenceHistoryWrite = {
  written: 0,
  skipped: 0,
  fixturesUnmapped: 0,
  personsUnmapped: 0,
};

/** How many asks the run may make within the bulk tier. Pure. */
export function absenceHistoryAllowance(seen: {
  budget: number | null;
  bulkPercent: number;
  requestsToday: number;
}): number {
  if (seen.budget === null) return Number.POSITIVE_INFINITY;
  const ceiling = Math.floor((seen.budget * seen.bulkPercent) / 100);
  return Math.max(0, ceiling - seen.requestsToday);
}

export async function sweepAbsenceHistory(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: AbsenceHistoryStorePort;
  filter: AbsenceHistoryFilter;
  /** The deployment's daily request budget, or `null` for none of its own. */
  budget: number | null;
  /** The percent of that budget bulk work may reach (`API_FOOTBALL_BUDGET_BULK_PERCENT`). */
  bulkPercent: number;
  requestsToday: number;
  /** Spaces the asks; injected so a test does not sleep. */
  pacer?: AskPacer;
  /** Told each line as it is decided, so the operator watches the run. */
  onLine?: (line: AbsenceSeasonLine) => void;
}): Promise<AbsenceHistorySweep> {
  const { provider, adapter, store, filter } = input;
  const pacer = input.pacer ?? new AskPacer();
  const sweep: AbsenceHistorySweep = { lines: [], asked: 0, relinked: 0 };
  const ask = adapter.getSeasonAbsences?.bind(adapter);
  if (ask === undefined) return { ...sweep, stopped: `${provider} lists no season's absences` };

  sweep.relinked = await store.relink(provider);
  const seasons = await store.seasons(provider, filter, FIRST_SEASON_START);
  if (seasons.length === 0) {
    const narrowed = [
      filter.seasonLabel === null ? null : `labelled ${filter.seasonLabel}`,
      filter.competitionExternalId === null
        ? null
        : `of competition ${filter.competitionExternalId}`,
    ].filter((part): part is string => part !== null);
    return {
      ...sweep,
      stopped: ['no past season from 2021 on', ...narrowed, 'is held for', provider].join(' '),
    };
  }
  const allowance = absenceHistoryAllowance(input);
  const add = (
    season: AbsenceSeason,
    line: Omit<AbsenceSeasonLine, 'competition' | 'competitionExternalId' | 'season'>,
  ): void => {
    const full: AbsenceSeasonLine = {
      competition: season.competitionName,
      competitionExternalId: season.competitionExternalId,
      season: season.seasonLabel,
      ...line,
    };
    sweep.lines.push(full);
    input.onLine?.(full);
  };

  for (const season of seasons) {
    if (season.absencesCovered === false) {
      add(season, { outcome: 'not_covered', entries: 0, ...NOTHING_WRITTEN });
      continue;
    }
    if (sweep.stopped !== undefined || sweep.asked >= allowance) {
      sweep.stopped ??= `the day's requests are at ${input.bulkPercent}% of the budget (bulk tier)`;
      add(season, { outcome: 'not_asked', entries: 0, ...NOTHING_WRITTEN, note: sweep.stopped });
      continue;
    }
    await pacer.pace();
    const result = await ask({
      competitionExternalId: season.competitionExternalId,
      seasonLabel: season.seasonLabel,
    });
    sweep.asked += result.requests;
    if (!result.ok) {
      const note = `${result.error.kind}: ${result.error.message}`;
      add(season, { outcome: 'refused', entries: 0, ...NOTHING_WRITTEN, note });
      // The plan, or our own budget, has said no: nothing else is asked.
      if (result.error.kind === 'quota') sweep.stopped = `stopped after a refusal (${note})`;
      continue;
    }
    if (result.data.length === 0) {
      add(season, { outcome: 'empty', entries: 0, ...NOTHING_WRITTEN });
      continue;
    }
    const written = await store.write(provider, result.data, result.fetchedAt);
    add(season, { outcome: 'written', entries: result.data.length, ...written });
  }
  return sweep;
}

/** The run's totals over its lines. Pure. */
export function absenceHistoryTotals(lines: readonly AbsenceSeasonLine[]): {
  seasons: number;
  entries: number;
} & AbsenceHistoryWrite {
  const total = { seasons: 0, entries: 0, ...NOTHING_WRITTEN };
  for (const line of lines) {
    if (line.outcome === 'written' || line.outcome === 'empty') total.seasons += 1;
    total.entries += line.entries;
    total.written += line.written;
    total.skipped += line.skipped;
    total.fixturesUnmapped += line.fixturesUnmapped;
    total.personsUnmapped += line.personsUnmapped;
  }
  return total;
}

/** One summary line for the operator: competition, season, and the counts. Pure. */
export function describeLine(line: AbsenceSeasonLine): string {
  const head = `${line.competition} (${line.competitionExternalId}) ${line.season}`;
  switch (line.outcome) {
    case 'written':
      return (
        `${head}: ${line.entries} listed, ${line.written} written` +
        (line.skipped === 0
          ? ''
          : `, ${line.skipped} skipped (${line.fixturesUnmapped} matches not held, or a club not held)`) +
        (line.personsUnmapped === 0 ? '' : `, ${line.personsUnmapped} players kept by provider id`)
      );
    case 'empty':
      return `${head}: the provider lists no absences`;
    case 'not_covered':
      return `${head}: not asked, the provider says it reports no absences for this season`;
    case 'refused':
      return `${head}: refused, ${line.note ?? 'no reason given'}`;
    case 'not_asked':
      return `${head}: not asked, ${line.note ?? 'the run stopped'}`;
  }
}
