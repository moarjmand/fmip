/**
 * Clubs' founding years and home grounds, and the grounds' capacity, address,
 * surface and picture (T-1438, D-229).
 *
 * `team.founded_year`, `team.home_venue_id` and `venue.capacity` have existed
 * since T-010 and nothing filled them. The plan we pay for answers both:
 *  - `getSeasonTeams`: every team of a competition's season, each with its
 *    founding year and its home ground described in full -- one request a
 *    season, so a league of twenty clubs and their grounds costs one ask;
 *  - `getVenue`: one ground by id, for a ground no club answer described (a
 *    neutral final, a national team's match, a club we hold no season of).
 * Seasons go first, grounds take what is left of a run.
 *
 * It runs as the second pass of the daily `squads` job, after the squads,
 * because it is the same kind of work: club data that changes rarely. Each
 * season is asked once; the current season of a competition again after
 * `CLUB_FACTS_REFRESH_DAYS`, a past one never (its clubs and grounds are those
 * of today, which the current seasons refresh). Each ground is asked once,
 * and again after the same 30 days unless a club answer described it since.
 *
 * Only what `provider_mapping` knows is written (rule 1): a team or a ground
 * the provider names that we do not hold is counted, never created or
 * queued -- a ground our fixtures name is already queued by the fixture
 * writers. A national team's entry is read for nothing: its "home ground" and
 * its "founded" are the federation's, not a club's.
 *
 * Its budget is the bulk tier's (D-183): at most `INGESTION_CLUB_FACTS_BATCH`
 * asks a run, none once the day's requests reach the bulk share of the
 * budget, none past `CLUB_FACTS_RUN_MS`, each ask started at least
 * `BULK_ASK_GAP_MS` after the one before (`AskPacer`, T-1422).
 */

import type {
  AdapterError,
  NormalisedTeamFacts,
  NormalisedVenueFacts,
  Provider,
  ProviderAdapter,
} from '@fmip/ingestion';
import { AskPacer } from './ask-pacer';

/** The default number of asks one run makes: the job runs once a day. */
export const CLUB_FACTS_BATCH = 100;
/** A ceiling on the setting, so a typo cannot hold the worker for long. */
export const MAX_CLUB_FACTS_BATCH = 300;
/** No new ask once a run's pass has taken this long: the live job is queued behind it. */
export const CLUB_FACTS_RUN_MS = 60_000;
/** How long an answer stands before the current season, or a ground, is asked again. */
export const CLUB_FACTS_REFRESH_DAYS = 30;
/** How long after an unanswered ask the same ask is made again. */
export const CLUB_FACTS_RETRY_HOURS = 24;
/** How many unanswered asks in a row before the job stops making that ask. */
export const CLUB_FACTS_MAX_FAILURES = 5;

/** The batch this deployment asked for: 0 turns the pass off, else 1 to the ceiling, else the default. */
export function clubFactsBatch(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_CLUB_FACTS_BATCH
    ? value
    : CLUB_FACTS_BATCH;
}

/** How many asks this run may make. Pure. */
export function clubFactsAllowance(seen: {
  batch: number;
  budget: number | null;
  bulkPercent: number;
  requestsToday: number;
}): number {
  if (seen.budget === null) return seen.batch;
  const ceiling = Math.floor((seen.budget * seen.bulkPercent) / 100);
  return Math.max(0, Math.min(seen.batch, ceiling - seen.requestsToday));
}

/** A competition's season owed a teams ask. */
export interface SeasonTeamsAsk {
  seasonId: string;
  competitionExternalId: string;
  seasonLabel: string;
}

/** A ground owed an ask by id. */
export interface VenueAsk {
  venueId: string;
  externalId: string;
}

/** A picture or crest address for the media store. */
export interface ImageNote {
  entityType: 'team' | 'venue';
  entityId: string;
  url: string;
}

/** What one season's answer wrote. */
export interface SeasonTeamsKept {
  /** Teams the answer listed that we hold. */
  held: number;
  /** Clubs whose founding year or home ground changed. */
  clubsWritten: number;
  /** Grounds whose facts changed. */
  venuesWritten: number;
  /** Grounds a held club's entry named that no mapping knows. */
  unmappedVenues: number;
  images: ImageNote[];
}

/** The SQL the pass needs. Implemented by `ClubFactsStore`. */
export interface ClubFactsSource {
  /**
   * Seasons of competitions mapped to the provider that hold a fixture, owed
   * an ask: never answered, or the competition's current season answered
   * before `answeredBeforeIso`; an unanswered ask again only after
   * `retryBeforeIso` and fewer than `maxFailures` times. Current seasons
   * first, then the newest.
   */
  seasonsDue(
    provider: Provider,
    at: { answeredBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<SeasonTeamsAsk[]>;
  /** Mapped grounds a fixture or a club names, owed an ask the same way. */
  venuesDue(
    provider: Provider,
    at: { answeredBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<VenueAsk[]>;
  /** Records an ask the provider did not answer. */
  markSeasonFailed(provider: Provider, seasonId: string): Promise<void>;
  markVenueFailed(provider: Provider, venueId: string): Promise<void>;
  /** Writes what the answer says about the clubs and grounds we hold, and records the answer. */
  saveSeasonTeams(
    provider: Provider,
    seasonId: string,
    teams: NormalisedTeamFacts[],
  ): Promise<SeasonTeamsKept>;
  /** Writes the ground's facts (`null`: the provider has no entry), and records the answer. */
  saveVenue(
    provider: Provider,
    venueId: string,
    venue: NormalisedVenueFacts | null,
  ): Promise<boolean>;
}

/** Where an image address goes. `MediaService.note`; never throws. */
export interface ImageSink {
  note(
    provider: Provider,
    entityType: 'team' | 'venue',
    entityId: string,
    sourceUrl: string,
  ): Promise<void>;
}

export interface ClubFactsSweep {
  /** Requests sent. */
  asked: number;
  answered: number;
  /** Teams the season answers listed that we hold. */
  teamsSeen: number;
  clubsWritten: number;
  venuesWritten: number;
  unmappedVenues: number;
  refused: string[];
  /** Why nothing was asked, when nothing was. */
  idle?: string;
}

const HOUR_MS = 60 * 60 * 1000;

type Ask = { kind: 'season'; ask: SeasonTeamsAsk } | { kind: 'venue'; ask: VenueAsk };

export async function sweepClubFacts(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: ClubFactsSource;
  media: ImageSink;
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
}): Promise<ClubFactsSweep> {
  const { provider, adapter, store, media, now } = input;
  const clock = input.clock ?? Date.now;
  const pacer = input.pacer ?? new AskPacer();
  const sweep: ClubFactsSweep = {
    asked: 0,
    answered: 0,
    teamsSeen: 0,
    clubsWritten: 0,
    venuesWritten: 0,
    unmappedVenues: 0,
    refused: [],
  };
  const getSeasonTeams = adapter.getSeasonTeams?.bind(adapter);
  const getVenue = adapter.getVenue?.bind(adapter);
  if (getSeasonTeams === undefined || getVenue === undefined) {
    return { ...sweep, idle: `${provider} lists no club or ground facts` };
  }
  if (input.batch === 0) return { ...sweep, idle: 'INGESTION_CLUB_FACTS_BATCH=0' };

  const allowance = clubFactsAllowance(input);
  if (allowance === 0) {
    return {
      ...sweep,
      idle: `the day's requests are at ${input.bulkPercent}% of the budget (bulk tier)`,
    };
  }
  const at = {
    answeredBeforeIso: new Date(
      now.getTime() - CLUB_FACTS_REFRESH_DAYS * 24 * HOUR_MS,
    ).toISOString(),
    retryBeforeIso: new Date(now.getTime() - CLUB_FACTS_RETRY_HOURS * HOUR_MS).toISOString(),
  };
  const deadline = clock() + (input.runMs ?? CLUB_FACTS_RUN_MS);

  // Seasons first: one answer describes a whole league's clubs and grounds,
  // so a ground is asked by id only if no season answer reached it.
  const seasons = await store.seasonsDue(provider, at, CLUB_FACTS_MAX_FAILURES, allowance);
  const quota = await askAll(seasons.map((ask) => ({ kind: 'season' as const, ask })));
  if (quota || sweep.asked >= allowance || clock() >= deadline) return sweep;
  const venues = await store.venuesDue(
    provider,
    at,
    CLUB_FACTS_MAX_FAILURES,
    allowance - sweep.asked,
  );
  await askAll(venues.map((ask) => ({ kind: 'venue' as const, ask })));
  if (seasons.length === 0 && venues.length === 0) {
    return { ...sweep, idle: 'every season and ground is current' };
  }
  return sweep;

  /** Asks each in turn; true when the provider or our budget said no to everything. */
  async function askAll(due: Ask[]): Promise<boolean> {
    for (const item of due) {
      if (clock() >= deadline || sweep.asked >= allowance) return false;
      await pacer.pace();
      const outcome = await askOne(item);
      sweep.asked += outcome.requests;
      if (!outcome.ok) {
        const what =
          item.kind === 'season'
            ? `season ${item.ask.competitionExternalId}/${item.ask.seasonLabel}`
            : `venue ${item.ask.externalId}`;
        sweep.refused.push(`${what}: ${outcome.error.kind}: ${outcome.error.message}`);
        // The plan, or our own budget, has said no: nothing else is asked this
        // run, and the refusal says nothing about this season or ground.
        if (outcome.error.kind === 'quota') return true;
        if (item.kind === 'season') await store.markSeasonFailed(provider, item.ask.seasonId);
        else await store.markVenueFailed(provider, item.ask.venueId);
        continue;
      }
      sweep.answered += 1;
    }
    return false;
  }

  async function askOne(
    item: Ask,
  ): Promise<
    { requests: number; ok: true } | { requests: number; ok: false; error: AdapterError }
  > {
    if (item.kind === 'season') {
      const r = await getSeasonTeams!({
        competitionExternalId: item.ask.competitionExternalId,
        seasonLabel: item.ask.seasonLabel,
      });
      if (!r.ok) return r;
      const kept = await store.saveSeasonTeams(provider, item.ask.seasonId, r.data);
      sweep.teamsSeen += kept.held;
      sweep.clubsWritten += kept.clubsWritten;
      sweep.venuesWritten += kept.venuesWritten;
      sweep.unmappedVenues += kept.unmappedVenues;
      for (const image of kept.images) {
        await media.note(provider, image.entityType, image.entityId, image.url);
      }
      return { requests: r.requests, ok: true };
    }
    const r = await getVenue!(item.ask.externalId);
    if (!r.ok) return r;
    if (await store.saveVenue(provider, item.ask.venueId, r.data)) sweep.venuesWritten += 1;
    if (r.data?.imageUrl != null) {
      await media.note(provider, 'venue', item.ask.venueId, r.data.imageUrl);
    }
    return { requests: r.requests, ok: true };
  }
}
