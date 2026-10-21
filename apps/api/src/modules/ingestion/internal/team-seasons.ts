/**
 * Teams' season statistics as the provider counts them (T-1437, D-228).
 *
 * The provider's `/teams/statistics` answers, for one team in one season of
 * one competition, what our matches alone cannot always say: goals by minute,
 * clean sheets, penalties, biggest wins and defeats, the formations used. The
 * `team_seasons` job asks it for each team with a finished match in a season
 * we hold, team and competition both mapped to the provider (rule 1):
 *  - a current season when never asked, again a week after the last answer,
 *    and again after each match the team played there, once the match is
 *    `TEAM_SEASON_SETTLE_HOURS` old (the provider updates some time after
 *    the whistle);
 *  - a past season once: it does not change.
 * Current seasons go first, then past ones, newest first.
 *
 * Its budget is the bulk tier's (D-183), as `player_seasons`' is: at most
 * `INGESTION_TEAM_SEASONS_BATCH` asks a run, none once the day's requests
 * reach the bulk share of the budget, none past `TEAM_SEASONS_RUN_MS`, and
 * the asks spaced by `AskPacer` (T-1422).
 */

import type {
  AdapterError,
  NormalisedTeamSeasonStats,
  Provider,
  ProviderAdapter,
} from '@fmip/ingestion';
import { AskPacer } from './ask-pacer';
import { playerSeasonsAllowance } from './player-seasons';

/** The default number of asks one run makes. */
export const TEAM_SEASONS_BATCH = 100;
/** A ceiling on the setting, so a typo cannot hold the worker for minutes. */
export const MAX_TEAM_SEASONS_BATCH = 200;
/** No new ask once a run has taken this long: the live job is queued behind it. */
export const TEAM_SEASONS_RUN_MS = 30_000;
/** How long after an unanswered ask the same ask is made again. */
export const TEAM_SEASONS_RETRY_HOURS = 24;
/** How many unanswered asks in a row before the job stops making that ask. */
export const TEAM_SEASONS_MAX_FAILURES = 5;
/** How old a match must be before the season is asked for again after it. */
export const TEAM_SEASON_SETTLE_HOURS = 6;
/** How long a current season's answer stands, with no match since, before it is asked again. */
export const TEAM_SEASON_REFRESH_DAYS = 7;

/** The batch this deployment asked for: 0 turns the job off, else 1 to the ceiling, else the default. */
export function teamSeasonsBatch(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_TEAM_SEASONS_BATCH
    ? value
    : TEAM_SEASONS_BATCH;
}

/** A team and season owed an ask, with the provider's ids to ask by. */
export interface TeamSeasonAsk {
  teamId: string;
  seasonId: string;
  teamExternalId: string;
  competitionExternalId: string;
  /** Our label for the season ("2026/27", "2026"); the adapter reads the year from it. */
  seasonLabel: string;
}

/** The SQL the job needs. Implemented by `TeamSeasonStore`. */
export interface TeamSeasonsStore {
  /**
   * Teams with a finished match, kicked off before `settledBeforeIso`, in a
   * season whose label starts with a year, team and competition mapped to the
   * provider, owed an ask: never asked; a current season answered before
   * `refreshBeforeIso` or before the team's latest such match; an unanswered
   * ask again only after `retryBeforeIso` and fewer than `maxFailures` times.
   */
  due(
    provider: Provider,
    at: { settledBeforeIso: string; refreshBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<TeamSeasonAsk[]>;
  /** Records an ask the provider did not answer. */
  markAsked(provider: Provider, ask: TeamSeasonAsk): Promise<void>;
  /** Replaces the team's row for that season with the answer's (none for `null`), and records it. */
  save(
    provider: Provider,
    ask: TeamSeasonAsk,
    stats: NormalisedTeamSeasonStats | null,
    fetchedAt: string,
  ): Promise<void>;
}

export interface TeamSeasonsSweep {
  /** Requests sent. */
  asked: number;
  answered: number;
  /** Seasons written: answers that carried statistics. */
  written: number;
  /** Answers that carried none. */
  empty: number;
  refused: string[];
  /** Why nothing was asked, when nothing was. */
  idle?: string;
}

const HOUR_MS = 60 * 60 * 1000;

export async function sweepTeamSeasons(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: TeamSeasonsStore;
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
  pacer?: { pace(): Promise<void> };
}): Promise<TeamSeasonsSweep> {
  const { provider, adapter, store, now } = input;
  const clock = input.clock ?? Date.now;
  const pacer = input.pacer ?? new AskPacer();
  const sweep: TeamSeasonsSweep = { asked: 0, answered: 0, written: 0, empty: 0, refused: [] };
  const getStats = adapter.getTeamSeasonStats?.bind(adapter);
  if (getStats === undefined) return { ...sweep, idle: `${provider} has no team statistics` };
  if (input.batch === 0) return { ...sweep, idle: 'INGESTION_TEAM_SEASONS_BATCH=0' };

  // The same rule as the players' seasons: the batch, within the bulk share.
  const allowance = playerSeasonsAllowance(input);
  if (allowance === 0) {
    return {
      ...sweep,
      idle: `the day's requests are at ${input.bulkPercent}% of the budget (bulk tier)`,
    };
  }
  const at = {
    settledBeforeIso: new Date(now.getTime() - TEAM_SEASON_SETTLE_HOURS * HOUR_MS).toISOString(),
    refreshBeforeIso: new Date(
      now.getTime() - TEAM_SEASON_REFRESH_DAYS * 24 * HOUR_MS,
    ).toISOString(),
    retryBeforeIso: new Date(now.getTime() - TEAM_SEASONS_RETRY_HOURS * HOUR_MS).toISOString(),
  };
  const due = await store.due(provider, at, TEAM_SEASONS_MAX_FAILURES, allowance);
  if (due.length === 0) return { ...sweep, idle: 'no team is owed a season ask' };

  const deadline = clock() + (input.runMs ?? TEAM_SEASONS_RUN_MS);
  for (const ask of due) {
    await pacer.pace();
    if (clock() >= deadline) break;
    const r = await getStats(ask.competitionExternalId, ask.seasonLabel, ask.teamExternalId);
    sweep.asked += r.requests;
    if (!r.ok) {
      const error: AdapterError = r.error;
      sweep.refused.push(
        `team ${ask.teamExternalId} league ${ask.competitionExternalId} ${ask.seasonLabel}: ${error.kind}: ${error.message}`,
      );
      // The plan, or our own budget, has said no: nothing else is asked this
      // run, and the refusal says nothing about this team.
      if (error.kind === 'quota') break;
      await store.markAsked(provider, ask);
      continue;
    }
    await store.save(provider, ask, r.data, r.fetchedAt);
    sweep.answered += 1;
    if (r.data === null) sweep.empty += 1;
    else sweep.written += 1;
  }
  return sweep;
}
