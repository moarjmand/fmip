/**
 * The shirts of past matches (T-1417, D-218).
 *
 * A club's colour is derived from the shirts it wore at home (T-1416), and a
 * line-up written before T-1415 carries none. The `kit_colours` job asks the
 * provider once for the line-up of each finished match that has a stored
 * line-up and a side without a shirt, newest first, so the clubs playing now
 * are coloured first, and hands the answer to the line-up writer, which keeps
 * the shirts and refreshes the club's colour.
 *
 * Its budget is the bulk tier's (D-183), as `people_names`' is: at most
 * `INGESTION_KIT_COLOURS_BATCH` asks a run, none once the day's requests
 * reach the bulk share of the budget, none past `KIT_COLOURS_RUN_MS` of
 * wall-clock time (the live job waits behind it on the one worker), and the
 * asks spaced `KIT_COLOURS_ASK_GAP_MS` apart (T-1405).
 */

import type { NormalisedLineup, Provider, ProviderAdapter } from '@fmip/ingestion';

/** The default number of matches one run asks about. */
export const KIT_COLOURS_BATCH = 100;
/** A ceiling on the setting, so a typo cannot hold the worker for minutes. */
export const MAX_KIT_COLOURS_BATCH = 200;
/** No new ask once a run has taken this long: the live job is queued behind it. */
export const KIT_COLOURS_RUN_MS = 30_000;
/** At most four asks a second: a full batch takes about 25 seconds. */
export const KIT_COLOURS_ASK_GAP_MS = 250;
/** How long after an unanswered ask a match is asked again. */
export const KIT_COLOURS_RETRY_HOURS = 24;
/** How many unanswered asks a match gets before the job stops asking. */
export const KIT_COLOURS_MAX_ATTEMPTS = 5;

const HOUR_MS = 60 * 60 * 1000;

/** The batch this deployment asked for: 0 turns the job off, else 1 to the ceiling, else the default. */
export function kitColoursBatch(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_KIT_COLOURS_BATCH
    ? value
    : KIT_COLOURS_BATCH;
}

/** How many matches this run may ask about within the bulk share of the day's budget. Pure. */
export function kitColoursAllowance(seen: {
  batch: number;
  budget: number | null;
  bulkPercent: number;
  requestsToday: number;
}): number {
  if (seen.budget === null) return seen.batch;
  const ceiling = Math.floor((seen.budget * seen.bulkPercent) / 100);
  return Math.max(0, Math.min(seen.batch, ceiling - seen.requestsToday));
}

/** A match owed an ask: our id and the provider's. */
export interface MatchOwedShirts {
  fixtureId: string;
  externalId: string;
}

/** The SQL the job needs. Implemented by `KitColourStore`. */
export interface KitColoursStore {
  /**
   * Finished matches with a stored line-up and a side without a shirt that are
   * owed an ask: never answered, not asked since `askedBeforeIso`, fewer than
   * `maxAttempts` asks. Newest first.
   */
  matchesOwedShirts(
    provider: Provider,
    askedBeforeIso: string,
    maxAttempts: number,
    limit: number,
  ): Promise<MatchOwedShirts[]>;
  /** Records an ask the provider did not answer. */
  markShirtsAsked(provider: Provider, fixtureId: string): Promise<void>;
  /** Records an answer and how many sides had a shirt. */
  markShirtsAnswered(provider: Provider, fixtureId: string, shirts: number): Promise<void>;
}

/** The line-up writer (`IngestStore.saveLineup`), which keeps the shirts and the club's colour. */
export type LineupWriter = (fixtureId: string, lineup: NormalisedLineup) => Promise<void>;

export interface KitColoursSweep {
  /** Requests sent. */
  asked: number;
  answered: number;
  /** Sides given a shirt across the answers. */
  shirts: number;
  refused: string[];
  /** Why nothing was asked, when nothing was. */
  idle?: string;
}

export async function sweepKitColours(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: KitColoursStore;
  write: LineupWriter;
  now: Date;
  batch: number;
  /** The deployment's daily request budget, or `null` for none of its own. */
  budget: number | null;
  /** The percent of that budget bulk work may reach (`API_FOOTBALL_BUDGET_BULK_PERCENT`). */
  bulkPercent: number;
  requestsToday: number;
  /** Milliseconds now; injected so a test can run the clock. */
  clock?: () => number;
  runMs?: number;
  /** Waits between two asks; injected so a test does not sleep. */
  wait?: (ms: number) => Promise<void>;
  gapMs?: number;
}): Promise<KitColoursSweep> {
  const { provider, adapter, store, now } = input;
  const clock = input.clock ?? Date.now;
  const wait =
    input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gapMs = input.gapMs ?? KIT_COLOURS_ASK_GAP_MS;
  const sweep: KitColoursSweep = { asked: 0, answered: 0, shirts: 0, refused: [] };
  if (input.batch === 0) return { ...sweep, idle: 'INGESTION_KIT_COLOURS_BATCH=0' };

  const allowance = kitColoursAllowance(input);
  if (allowance === 0) {
    return {
      ...sweep,
      idle: `the day's requests are at ${input.bulkPercent}% of the budget (bulk tier)`,
    };
  }
  const due = await store.matchesOwedShirts(
    provider,
    new Date(now.getTime() - KIT_COLOURS_RETRY_HOURS * HOUR_MS).toISOString(),
    KIT_COLOURS_MAX_ATTEMPTS,
    allowance,
  );
  if (due.length === 0) return { ...sweep, idle: 'no finished match is owed its shirts' };

  const deadline = clock() + (input.runMs ?? KIT_COLOURS_RUN_MS);
  for (const [index, match] of due.entries()) {
    if (index > 0) await wait(gapMs);
    if (clock() >= deadline) break;
    const result = await adapter.getLineup(match.externalId);
    sweep.asked += result.requests;
    if (!result.ok) {
      sweep.refused.push(
        `fixture ${match.externalId}: ${result.error.kind}: ${result.error.message}`,
      );
      // The plan, or our own budget, has said no: nothing else is asked this run,
      // and the refusal says nothing about this match, so it costs no attempt.
      if (result.error.kind === 'quota') break;
      await store.markShirtsAsked(provider, match.fixtureId);
      continue;
    }
    await input.write(match.fixtureId, result.data);
    const shirts = [result.data.home, result.data.away].filter((s) => s.kitColour !== null).length;
    await store.markShirtsAnswered(provider, match.fixtureId, shirts);
    sweep.answered += 1;
    sweep.shirts += shirts;
  }
  return sweep;
}
