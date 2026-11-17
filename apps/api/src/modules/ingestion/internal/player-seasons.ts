/**
 * Players' season totals and careers as the provider counts them (T-1431,
 * D-223).
 *
 * Our own player record is computed from the matches we ingest (D-038), so it
 * says nothing about a cup, a league or a national team we do not follow. The
 * provider counts every competition it covers. The `player_seasons` job asks
 * it, for each player named in a line-up of a current season:
 *  - the player's totals for that season (`getPlayerSeason`), first when he
 *    was never asked, then again after each match he was named for, once the
 *    match is `SEASON_SETTLE_HOURS` old (the provider updates its totals some
 *    time after the whistle);
 *  - the teams he has played for, season by season (`getPlayerCareer`), once,
 *    and again after `CAREER_REFRESH_DAYS`.
 * Seasons go first; careers take what is left of a run. The most recently
 * active players come first in both.
 *
 * Its budget is the bulk tier's (D-183), as `people_names`' is: at most
 * `INGESTION_PLAYER_SEASONS_BATCH` asks a run, none once the day's requests
 * reach the bulk share of the budget, none past `PLAYER_SEASONS_RUN_MS`, and
 * `PLAYER_SEASONS_ASK_GAP_MS` between two asks (T-1405).
 *
 * A player holding several of the provider's ids (a merged duplicate, T-1866)
 * is asked by each, in one go, and the answers are saved together under the
 * one person: each id is one request against the allowance, and a player
 * whose ids do not fit waits for the next run.
 */

import type {
  AdapterError,
  NormalisedCareerEntry,
  NormalisedPlayerSeasonLine,
  Provider,
  ProviderAdapter,
} from '@fmip/ingestion';
import { asksWithin, everyExternalId, type PersonExternalIds } from './person-ids';

/** The default number of asks one run makes. */
export const PLAYER_SEASONS_BATCH = 100;
/** A ceiling on the setting, so a typo cannot hold the worker for minutes. */
export const MAX_PLAYER_SEASONS_BATCH = 200;
/** No new ask once a run has taken this long: the live job is queued behind it. */
export const PLAYER_SEASONS_RUN_MS = 30_000;
/** The wait between two asks: at most four a second (T-1405). */
export const PLAYER_SEASONS_ASK_GAP_MS = 250;
/** How long after an unanswered ask the same ask is made again. */
export const PLAYER_SEASONS_RETRY_HOURS = 24;
/** How many unanswered asks in a row before the job stops making that ask. */
export const PLAYER_SEASONS_MAX_FAILURES = 5;
/** How old a match must be before the season totals are asked for again after it. */
export const SEASON_SETTLE_HOURS = 6;
/** How long a career answer stands before it is asked for again. */
export const CAREER_REFRESH_DAYS = 30;

/** The batch this deployment asked for: 0 turns the job off, else 1 to the ceiling, else the default. */
export function playerSeasonsBatch(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_PLAYER_SEASONS_BATCH
    ? value
    : PLAYER_SEASONS_BATCH;
}

/** How many asks this run may make. Pure. */
export function playerSeasonsAllowance(seen: {
  batch: number;
  budget: number | null;
  bulkPercent: number;
  requestsToday: number;
}): number {
  if (seen.budget === null) return seen.batch;
  const ceiling = Math.floor((seen.budget * seen.bulkPercent) / 100);
  return Math.max(0, Math.min(seen.batch, ceiling - seen.requestsToday));
}

/** A player and season owed an ask, by each of his provider ids. */
export interface SeasonAsk extends PersonExternalIds {
  personId: string;
  /** The year the season starts in. */
  seasonYear: number;
}

/** A player owed a career ask, by each of his provider ids. */
export interface CareerAsk extends PersonExternalIds {
  personId: string;
}

/**
 * One season's lines from each of a player's ids, as one answer (T-1866). A
 * competition and team both ids report keeps the line of the id asked first
 * (the lowest), as the store's insert would; one answer is returned as it is.
 */
export function combineSeasonLines(
  answers: NormalisedPlayerSeasonLine[][],
): NormalisedPlayerSeasonLine[] {
  if (answers.length === 1) return answers[0] ?? [];
  const seen = new Set<string>();
  const lines: NormalisedPlayerSeasonLine[] = [];
  for (const line of answers.flat()) {
    const key = [line.competition.externalId, line.team.externalId, line.seasonYear].join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

/**
 * A career from each of a player's ids, as one answer (T-1866): one entry per
 * team, its seasons the union, newest first. One answer is returned as it is.
 */
export function combineCareers(answers: NormalisedCareerEntry[][]): NormalisedCareerEntry[] {
  if (answers.length === 1) return answers[0] ?? [];
  const byTeam = new Map<string, { entry: NormalisedCareerEntry; years: Set<number> }>();
  for (const entry of answers.flat()) {
    const held = byTeam.get(entry.team.externalId);
    if (held === undefined) {
      byTeam.set(entry.team.externalId, { entry, years: new Set(entry.seasonYears) });
    } else {
      for (const year of entry.seasonYears) held.years.add(year);
    }
  }
  return [...byTeam.values()].map(({ entry, years }) => ({
    team: entry.team,
    seasonYears: [...years].sort((a, b) => b - a),
  }));
}

/** What one answer kept and left out. */
export interface Kept {
  kept: number;
  /** Lines or teams left out because the competition or the team is unknown to us. */
  unmapped: number;
}

/** The SQL the job needs. Implemented by `PlayerSeasonStore`. */
export interface PlayerSeasonsStore {
  /**
   * Players named in a line-up of a current season's finished match that
   * kicked off before `playedBeforeIso`, with that season, owed an ask: never
   * asked, or named for a match after the last answer; an unanswered ask is
   * made again only after `retryBeforeIso` and fewer than `maxFailures` times.
   */
  seasonsDue(
    provider: Provider,
    at: { playedBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<SeasonAsk[]>;
  /** The same players owed a career ask: never answered, or answered before `answeredBeforeIso`. */
  careersDue(
    provider: Provider,
    at: { playedBeforeIso: string; retryBeforeIso: string; answeredBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<CareerAsk[]>;
  /** Records an ask the provider did not answer. */
  markSeasonAsked(provider: Provider, ask: SeasonAsk): Promise<void>;
  markCareerAsked(provider: Provider, ask: CareerAsk): Promise<void>;
  /** Replaces the player's rows for that season with the answer's, and records the answer. */
  saveSeason(
    provider: Provider,
    ask: SeasonAsk,
    lines: NormalisedPlayerSeasonLine[],
    fetchedAt: string,
  ): Promise<Kept>;
  /** Replaces the player's career rows with the answer's, and records the answer. */
  saveCareer(
    provider: Provider,
    ask: CareerAsk,
    entries: NormalisedCareerEntry[],
    fetchedAt: string,
  ): Promise<Kept>;
}

export interface PlayerSeasonsSweep {
  /** Requests sent. */
  asked: number;
  answered: number;
  /** Season lines and career seasons written. */
  written: number;
  /** Lines and teams left out as unknown to us. */
  unmapped: number;
  refused: string[];
  /** Why nothing was asked, when nothing was. */
  idle?: string;
}

const HOUR_MS = 60 * 60 * 1000;

type Ask = { kind: 'season'; ask: SeasonAsk } | { kind: 'career'; ask: CareerAsk };

export async function sweepPlayerSeasons(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: PlayerSeasonsStore;
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
}): Promise<PlayerSeasonsSweep> {
  const { provider, adapter, store, now } = input;
  const clock = input.clock ?? Date.now;
  const wait =
    input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gapMs = input.gapMs ?? PLAYER_SEASONS_ASK_GAP_MS;
  const sweep: PlayerSeasonsSweep = { asked: 0, answered: 0, written: 0, unmapped: 0, refused: [] };
  const getSeason = adapter.getPlayerSeason?.bind(adapter);
  const getCareer = adapter.getPlayerCareer?.bind(adapter);
  if (getSeason === undefined || getCareer === undefined) {
    return { ...sweep, idle: `${provider} has no player seasons` };
  }
  if (input.batch === 0) return { ...sweep, idle: 'INGESTION_PLAYER_SEASONS_BATCH=0' };

  const allowance = playerSeasonsAllowance(input);
  if (allowance === 0) {
    return {
      ...sweep,
      idle: `the day's requests are at ${input.bulkPercent}% of the budget (bulk tier)`,
    };
  }
  const at = {
    playedBeforeIso: new Date(now.getTime() - SEASON_SETTLE_HOURS * HOUR_MS).toISOString(),
    retryBeforeIso: new Date(now.getTime() - PLAYER_SEASONS_RETRY_HOURS * HOUR_MS).toISOString(),
    answeredBeforeIso: new Date(now.getTime() - CAREER_REFRESH_DAYS * 24 * HOUR_MS).toISOString(),
  };
  // Each of a player's ids is one request: the asks kept are those whose ids
  // fit in the allowance (T-1866). With one id each, the store's limit does.
  const seasons = asksWithin(
    await store.seasonsDue(provider, at, PLAYER_SEASONS_MAX_FAILURES, allowance),
    allowance,
  );
  const left = allowance - seasons.requests;
  const careers =
    left > 0
      ? asksWithin(await store.careersDue(provider, at, PLAYER_SEASONS_MAX_FAILURES, left), left)
      : { asks: [], requests: 0, deferred: 0 };
  const due: Ask[] = [
    ...seasons.asks.map((ask) => ({ kind: 'season' as const, ask })),
    ...careers.asks.map((ask) => ({ kind: 'career' as const, ask })),
  ];
  if (due.length === 0) {
    return { ...sweep, idle: 'no player is owed a season or a career ask' };
  }

  /**
   * One ask by each of the player's ids, the answers saved together under
   * the one person only when every id answered (T-1866): the requests it
   * cost, and what was kept or why not.
   */
  const askOne = async (
    item: Ask,
  ): Promise<
    | { requests: number; ok: true; kept: Kept }
    | { requests: number; ok: false; externalId: string; error: AdapterError }
  > => {
    let requests = 0;
    // The oldest answer dates the rows, so none is shown fresher than it is.
    let fetchedAt: string | null = null;
    const seasonLines: NormalisedPlayerSeasonLine[][] = [];
    const careers: NormalisedCareerEntry[][] = [];
    for (const [index, externalId] of everyExternalId(item.ask).entries()) {
      if (index > 0) await wait(gapMs);
      if (item.kind === 'season') {
        const r = await getSeason(externalId, String(item.ask.seasonYear));
        requests += r.requests;
        if (!r.ok) return { requests, ok: false, externalId, error: r.error };
        seasonLines.push(r.data);
        if (fetchedAt === null || r.fetchedAt < fetchedAt) fetchedAt = r.fetchedAt;
      } else {
        const r = await getCareer(externalId);
        requests += r.requests;
        if (!r.ok) return { requests, ok: false, externalId, error: r.error };
        careers.push(r.data);
        if (fetchedAt === null || r.fetchedAt < fetchedAt) fetchedAt = r.fetchedAt;
      }
    }
    const stamped = fetchedAt ?? now.toISOString();
    const kept =
      item.kind === 'season'
        ? await store.saveSeason(provider, item.ask, combineSeasonLines(seasonLines), stamped)
        : await store.saveCareer(provider, item.ask, combineCareers(careers), stamped);
    return { requests, ok: true, kept };
  };

  const deadline = clock() + (input.runMs ?? PLAYER_SEASONS_RUN_MS);
  for (const [index, item] of due.entries()) {
    if (index > 0) await wait(gapMs);
    // The run's clock is read before each player: his ids are asked together.
    if (clock() >= deadline) break;
    const result = await askOne(item);
    sweep.asked += result.requests;
    if (!result.ok) {
      const what = item.kind === 'season' ? `season ${item.ask.seasonYear}` : 'career';
      const { error } = result;
      sweep.refused.push(`person ${result.externalId} ${what}: ${error.kind}: ${error.message}`);
      // The plan, or our own budget, has said no: nothing else is asked this
      // run, and the refusal says nothing about this player.
      if (error.kind === 'quota') break;
      if (item.kind === 'season') await store.markSeasonAsked(provider, item.ask);
      else await store.markCareerAsked(provider, item.ask);
      continue;
    }
    sweep.answered += 1;
    sweep.written += result.kept.kept;
    sweep.unmapped += result.kept.unmapped;
  }
  return sweep;
}
