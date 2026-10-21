/**
 * Coaches from the provider's coaches endpoint (T-1439, D-230).
 *
 * Line-ups name a coach for a match (D-119); nothing said who coaches a club
 * now, since when, or where he coached before. The `coaches` job asks the
 * provider for each team's coaches (`getTeamCoaches`) -- every club and
 * national team we map that plays in a current season:
 *  - first when the team was never asked;
 *  - again when a line-up newer than the last answer names a coach who is not
 *    the team's current coach by the stored careers -- a change shows up in
 *    the line-ups first;
 *  - and again `COACHES_REFRESH_DAYS` after the last answer.
 * A change comes first, then teams never asked, then the oldest answers.
 *
 * Each answer lists coaches with their careers. A coach is resolved by his id
 * in the coach id space (D-230) like any person (D-079): one we do not hold
 * yet is queued for adoption, never created here, and never matched by name.
 * For one we hold, his career at the teams we map replaces the stored one,
 * and his birth date and nationality fill only what is empty.
 *
 * Every run first puts back the line-ups' coach references the coach id
 * space moved out (`coach_reference_split`) whose coach has since been
 * adopted. That costs no request.
 *
 * Its budget is the bulk tier's (D-183): at most `INGESTION_COACHES_BATCH`
 * asks a run, none once the day's requests reach the bulk share of the
 * budget, none past `COACHES_RUN_MS`, and the asks spaced by the `AskPacer`
 * (T-1422).
 */

import type { AdapterError, NormalisedCoach, Provider, ProviderAdapter } from '@fmip/ingestion';

/** The default number of asks one run makes. */
export const COACHES_BATCH = 60;
/** A ceiling on the setting, so a typo cannot hold the worker for minutes. */
export const MAX_COACHES_BATCH = 200;
/** No new ask once a run has taken this long: the live job is queued behind it. */
export const COACHES_RUN_MS = 30_000;
/** How long after an unanswered ask the same ask is made again. */
export const COACHES_RETRY_HOURS = 24;
/** How many unanswered asks in a row before the job stops asking for that team. */
export const COACHES_MAX_FAILURES = 5;
/** How long an answer stands before the team is asked again. */
export const COACHES_REFRESH_DAYS = 30;

/** The batch this deployment asked for: 0 turns the job off, else 1 to the ceiling, else the default. */
export function coachesBatch(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_COACHES_BATCH
    ? value
    : COACHES_BATCH;
}

/** How many asks this run may make. Pure. */
export function coachesAllowance(seen: {
  batch: number;
  budget: number | null;
  bulkPercent: number;
  requestsToday: number;
}): number {
  if (seen.budget === null) return seen.batch;
  const ceiling = Math.floor((seen.budget * seen.bulkPercent) / 100);
  return Math.max(0, Math.min(seen.batch, ceiling - seen.requestsToday));
}

/** Why a team is owed an ask. */
export type TeamAskReason = 'lineup_change' | 'never_asked' | 'refresh';

/** A team owed an ask. */
export interface TeamAsk {
  teamId: string;
  externalId: string;
  reason: TeamAskReason;
}

/** What one answer kept and left out. */
export interface CoachesKept {
  /** Coaches we hold whose profile and career were written. */
  coaches: number;
  /** Coaches we do not hold yet: each is in the review queue until adopted. */
  queued: number;
  /** Career spells kept. */
  spells: number;
  /** Career spells left out because the team is unknown to us. */
  spellsUnmapped: number;
}

/** The SQL the job needs. Implemented by `CoachStore`. */
export interface CoachesStore {
  /** Puts back each moved-out coach reference whose coach now maps to a person; how many. */
  restoreSplitReferences(provider: Provider): Promise<number>;
  /**
   * Teams owed an ask (see the module comment), changes first. An unanswered
   * ask is made again only after `retryBeforeIso` and fewer than
   * `maxFailures` times in a row.
   */
  teamsDue(
    provider: Provider,
    at: { answeredBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<TeamAsk[]>;
  /** Records an ask the provider did not answer. */
  markTeamAsked(provider: Provider, ask: TeamAsk): Promise<void>;
  /** Writes the answer's coaches we hold, queues the others, and records the answer. */
  saveTeamCoaches(
    provider: Provider,
    ask: TeamAsk,
    coaches: NormalisedCoach[],
    fetchedAt: string,
  ): Promise<CoachesKept>;
}

/** Spaces two asks; `AskPacer` in production. */
export interface Pacer {
  pace(): Promise<void>;
}

export interface CoachesSweep {
  /** Requests sent. */
  asked: number;
  answered: number;
  /** Coaches written, spells kept and coach references put back. */
  written: number;
  coaches: number;
  spells: number;
  queued: number;
  restored: number;
  refused: string[];
  /** Why nothing was asked, when nothing was. */
  idle?: string;
}

const HOUR_MS = 60 * 60 * 1000;

export async function sweepCoaches(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: CoachesStore;
  now: Date;
  batch: number;
  /** The deployment's daily request budget, or `null` for none of its own. */
  budget: number | null;
  /** The percent of that budget bulk work may reach (`API_FOOTBALL_BUDGET_BULK_PERCENT`). */
  bulkPercent: number;
  requestsToday: number;
  pacer: Pacer;
  /** Milliseconds now; injected so a test can run the clock. */
  clock?: () => number;
  runMs?: number;
}): Promise<CoachesSweep> {
  const { provider, adapter, store, now } = input;
  const clock = input.clock ?? Date.now;
  const restored = await store.restoreSplitReferences(provider);
  const sweep: CoachesSweep = {
    asked: 0,
    answered: 0,
    written: restored,
    coaches: 0,
    spells: 0,
    queued: 0,
    restored,
    refused: [],
  };
  const getCoaches = adapter.getTeamCoaches?.bind(adapter);
  if (getCoaches === undefined) return { ...sweep, idle: `${provider} has no coaches` };
  if (input.batch === 0) return { ...sweep, idle: 'INGESTION_COACHES_BATCH=0' };

  const allowance = coachesAllowance(input);
  if (allowance === 0) {
    return {
      ...sweep,
      idle: `the day's requests are at ${input.bulkPercent}% of the budget (bulk tier)`,
    };
  }
  const at = {
    answeredBeforeIso: new Date(now.getTime() - COACHES_REFRESH_DAYS * 24 * HOUR_MS).toISOString(),
    retryBeforeIso: new Date(now.getTime() - COACHES_RETRY_HOURS * HOUR_MS).toISOString(),
  };
  const due = await store.teamsDue(provider, at, COACHES_MAX_FAILURES, allowance);
  if (due.length === 0) return { ...sweep, idle: 'no team is owed a coaches ask' };

  const deadline = clock() + (input.runMs ?? COACHES_RUN_MS);
  for (const ask of due) {
    await input.pacer.pace();
    if (clock() >= deadline) break;
    const result = await getCoaches(ask.externalId);
    sweep.asked += result.requests;
    if (!result.ok) {
      const error: AdapterError = result.error;
      sweep.refused.push(`team ${ask.externalId} coaches: ${error.kind}: ${error.message}`);
      // The plan, or our own budget, has said no: nothing else is asked this
      // run, and the refusal says nothing about this team.
      if (error.kind === 'quota') break;
      await store.markTeamAsked(provider, ask);
      continue;
    }
    const kept = await store.saveTeamCoaches(provider, ask, result.data, result.fetchedAt);
    sweep.answered += 1;
    sweep.coaches += kept.coaches;
    sweep.spells += kept.spells;
    sweep.queued += kept.queued;
    sweep.written += kept.coaches + kept.spells;
  }
  return sweep;
}
