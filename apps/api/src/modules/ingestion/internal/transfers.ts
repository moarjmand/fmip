/**
 * Transfers, as the provider lists them (T-1440, D-231).
 *
 * The `transfers` job asks the provider for every move into and out of each
 * club of a current season (`getTeamTransfers`), then for every move of each
 * player named in a current season's line-up (`getPlayerTransfers`): first
 * when never asked, then again once the last answer is older than a week
 * while a transfer window is open, a month otherwise (`transfersRefreshDays`).
 * Clubs go first; players take what is left of a run. Never-asked subjects
 * come first in both, then the oldest answers.
 *
 * Its budget is the bulk tier's (D-183): at most `INGESTION_TRANSFERS_BATCH`
 * asks a run, none once the day's requests reach the bulk share of the
 * budget, none past `TRANSFERS_RUN_MS`, and each ask paced by `AskPacer`
 * (T-1422).
 *
 * A player holding several of the provider's ids (a merged duplicate, T-1866)
 * is asked by each, in one go, and the moves are saved together under the one
 * person: each id is one request against the allowance, and a player whose
 * ids do not fit waits for the next run. A club is asked by one id.
 */

import {
  type AdapterError,
  type NormalisedTransfer,
  type Provider,
  type ProviderAdapter,
  transfersRefreshDays,
} from '@fmip/ingestion';
import { AskPacer } from './ask-pacer';
import { asksWithin, everyExternalId, type PersonExternalIds } from './person-ids';

/** The default number of asks one run makes. */
export const TRANSFERS_BATCH = 60;
/** A ceiling on the setting, so a typo cannot hold the worker for minutes. */
export const MAX_TRANSFERS_BATCH = 200;
/** No new ask once a run has taken this long: the live job is queued behind it. */
export const TRANSFERS_RUN_MS = 30_000;
/** How long after an unanswered ask the same ask is made again. */
export const TRANSFERS_RETRY_HOURS = 24;
/** How many unanswered asks in a row before the job stops making that ask. */
export const TRANSFERS_MAX_FAILURES = 5;

/** The batch this deployment asked for: 0 turns the job off, else 1 to the ceiling, else the default. */
export function transfersBatch(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_TRANSFERS_BATCH
    ? value
    : TRANSFERS_BATCH;
}

/** How many asks this run may make within the bulk tier. Pure. */
export function transfersAllowance(seen: {
  batch: number;
  budget: number | null;
  bulkPercent: number;
  requestsToday: number;
}): number {
  if (seen.budget === null) return seen.batch;
  const ceiling = Math.floor((seen.budget * seen.bulkPercent) / 100);
  return Math.max(0, Math.min(seen.batch, ceiling - seen.requestsToday));
}

/** A club or a player owed an ask, by the provider's id (a player's: each of his). */
export interface TransferAsk extends PersonExternalIds {
  subject: 'team' | 'person';
  /** Our id for the club or the player. */
  id: string;
}

/**
 * The moves from each of a player's ids, as one answer (T-1866): a move both
 * ids list (same day, kind and clubs) is kept once, as the id asked first
 * (the lowest) gave it. One answer is returned as it is.
 */
export function combineMoves(answers: NormalisedTransfer[][]): NormalisedTransfer[] {
  if (answers.length === 1) return answers[0] ?? [];
  const club = (side: NormalisedTransfer['from']): string =>
    side === null ? '' : (side.externalId ?? `name:${side.name}`);
  const seen = new Set<string>();
  const moves: NormalisedTransfer[] = [];
  for (const move of answers.flat()) {
    const key = [move.date, move.kind, club(move.from), club(move.to)].join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    moves.push(move);
  }
  return moves;
}

/** When an answer is due again, and when an unanswered ask may be repeated. */
export interface TransfersDueAt {
  answeredBeforeIso: string;
  retryBeforeIso: string;
}

/** The SQL the job needs. Implemented by `TransferStore`. */
export interface TransfersStore {
  /**
   * Clubs of a current season (`subject: 'team'`), or players named in a
   * current season's line-up (`'person'`), owed an ask: never asked, answered
   * before `answeredBeforeIso`, or unanswered fewer than `maxFailures` times
   * and last asked before `retryBeforeIso`.
   */
  due(
    provider: Provider,
    subject: TransferAsk['subject'],
    at: TransfersDueAt,
    maxFailures: number,
    limit: number,
  ): Promise<TransferAsk[]>;
  /** Records an ask the provider did not answer. */
  markAsked(provider: Provider, ask: TransferAsk): Promise<void>;
  /** Replaces the subject's moves with the answer's, and records the answer. Returns the moves kept. */
  save(
    provider: Provider,
    ask: TransferAsk,
    moves: NormalisedTransfer[],
    fetchedAt: string,
  ): Promise<number>;
}

export interface TransfersSweep {
  /** Requests sent. */
  asked: number;
  answered: number;
  /** Moves written. */
  written: number;
  refused: string[];
  /** Why nothing was asked, when nothing was. */
  idle?: string;
}

const HOUR_MS = 60 * 60 * 1000;

export async function sweepTransfers(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: TransfersStore;
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
  /** Spaces the asks; injected so a test does not sleep. */
  pacer?: AskPacer;
}): Promise<TransfersSweep> {
  const { provider, adapter, store, now } = input;
  const clock = input.clock ?? Date.now;
  const pacer = input.pacer ?? new AskPacer();
  const sweep: TransfersSweep = { asked: 0, answered: 0, written: 0, refused: [] };
  const byTeam = adapter.getTeamTransfers?.bind(adapter);
  const byPlayer = adapter.getPlayerTransfers?.bind(adapter);
  if (byTeam === undefined || byPlayer === undefined) {
    return { ...sweep, idle: `${provider} has no transfers` };
  }
  if (input.batch === 0) return { ...sweep, idle: 'INGESTION_TRANSFERS_BATCH=0' };

  const allowance = transfersAllowance(input);
  if (allowance === 0) {
    return {
      ...sweep,
      idle: `the day's requests are at ${input.bulkPercent}% of the budget (bulk tier)`,
    };
  }
  const at: TransfersDueAt = {
    answeredBeforeIso: new Date(
      now.getTime() - transfersRefreshDays(now) * 24 * HOUR_MS,
    ).toISOString(),
    retryBeforeIso: new Date(now.getTime() - TRANSFERS_RETRY_HOURS * HOUR_MS).toISOString(),
  };
  // Each of a player's ids is one request: the asks kept are those whose ids
  // fit in the allowance (T-1866). With one id each, the store's limit does.
  const teams = asksWithin(
    await store.due(provider, 'team', at, TRANSFERS_MAX_FAILURES, allowance),
    allowance,
  );
  const left = allowance - teams.requests;
  const people =
    left > 0
      ? asksWithin(await store.due(provider, 'person', at, TRANSFERS_MAX_FAILURES, left), left)
      : { asks: [], requests: 0, deferred: 0 };
  const due = [...teams.asks, ...people.asks];
  if (due.length === 0) return { ...sweep, idle: 'no club or player is owed a transfers ask' };

  const deadline = clock() + (input.runMs ?? TRANSFERS_RUN_MS);
  subjects: for (const ask of due) {
    // The run's clock is read before each subject, and before each of a
    // player's ids (T-1868): out of time between two, nothing is saved or
    // marked, and he is asked whole next run.
    await pacer.pace();
    if (clock() >= deadline) break;
    const answers: NormalisedTransfer[][] = [];
    let fetchedAt: string | null = null;
    for (const [index, externalId] of everyExternalId(ask).entries()) {
      if (index > 0) {
        await pacer.pace();
        if (clock() >= deadline) break subjects;
      }
      const result = ask.subject === 'team' ? await byTeam(externalId) : await byPlayer(externalId);
      sweep.asked += result.requests;
      if (!result.ok) {
        const error: AdapterError = result.error;
        sweep.refused.push(`${ask.subject} ${externalId}: ${error.kind}: ${error.message}`);
        // The plan, or our own budget, has said no: nothing else is asked this
        // run, and the refusal says nothing about this club or player.
        if (error.kind === 'quota') break subjects;
        // Nothing is saved unless every id answered: one id's moves alone
        // would replace the other's.
        await store.markAsked(provider, ask);
        continue subjects;
      }
      answers.push(result.data);
      // The oldest answer dates the rows, so none is shown fresher than it is.
      if (fetchedAt === null || result.fetchedAt < fetchedAt) fetchedAt = result.fetchedAt;
    }
    sweep.answered += 1;
    sweep.written += await store.save(
      provider,
      ask,
      combineMoves(answers),
      fetchedAt ?? now.toISOString(),
    );
  }
  return sweep;
}
