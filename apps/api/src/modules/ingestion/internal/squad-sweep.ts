/**
 * Player photos and the listed squad for players already in our records
 * (T-1324, D-176; T-1428, D-220).
 *
 * T-1320 notes a player's photo only when an ingest touches the player, so a
 * player of a match ingested before it has none until he plays again. The
 * `squads` job asks the provider for each club's squad -- one request per
 * club, each club at most once a month -- and hands the photo of every listed
 * player we already hold to the media store, exactly as the other writers do.
 * It also records the listing itself (T-1428): the shirt number and position
 * of each player we hold, as `team_squad_member`, replacing the club's last
 * listing, with the size of the whole listing so a squad of which we hold
 * only some players says so. The team page shows it as the squad.
 *
 * It never creates a person and never queues one for review: a squad lists
 * thirty players and most of them have never played a match we hold, so an
 * unknown id is simply not ours yet. Only `provider_mapping` is read.
 *
 * Its budget is its own and small: `INGESTION_SQUADS_PER_DAY` requests a UTC
 * day (default 60; 0 turns it off), and none while the day's requests are at
 * or past `SQUAD_HEADROOM_PERCENT` of the deployment's daily budget (T-501),
 * so photos never compete with match data for the plan.
 *
 * The asks are spaced by the `AskPacer` like every other bulk job's (T-1637):
 * sixty asks sent back to back were over in under a minute, but the
 * operator's cap goes to 500, and a burst of hundreds at the rate the
 * provider has refused before (T-1422) would be refused in part, with the
 * live and standings asks of the same minute.
 */

import type { NormalisedSquadPlayer, Position, Provider, ProviderAdapter } from '@fmip/ingestion';
import { AskPacer } from './ask-pacer';

/** The default daily cap on squad requests. */
export const SQUADS_PER_DAY = 60;
/** A ceiling on the setting, so a typo cannot spend a day's plan on photos. */
export const MAX_SQUADS_PER_DAY = 500;
/** How long a club's answered squad is good for. */
export const SQUAD_STALE_DAYS = 30;
/** How long after an unanswered ask a club is asked again. */
export const SQUAD_RETRY_HOURS = 24;
/** No squad request while the day's requests are at or past this share of the budget. */
export const SQUAD_HEADROOM_PERCENT = 70;

/** The cap this deployment asked for: a whole number from 0 to the ceiling, else the default. */
export function squadsPerDay(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_SQUADS_PER_DAY
    ? value
    : SQUADS_PER_DAY;
}

/** A club the provider can be asked about, by our id and the provider's. */
export interface SquadTeam {
  teamId: string;
  externalId: string;
}

/** A listed player we hold, as the listing gives them. */
export interface SquadMember {
  personId: string;
  shirtNumber: number | null;
  position: Position | null;
}

/** The SQL the sweep needs. Implemented by `IngestStore`. */
export interface SquadStore {
  /** Clubs asked about since `sinceIso`: the day's squad requests so far. */
  squadsAskedSince(provider: Provider, sinceIso: string): Promise<number>;
  /**
   * Mapped clubs playing in the given seasons that are owed a squad answer:
   * never answered, answered with no listing recorded (T-1632), or answered
   * before `answeredBeforeIso`; the clubs of the highest-placed competitions
   * first within each.
   */
  squadsDue(
    provider: Provider,
    seasonIds: string[],
    answeredBeforeIso: string,
    askedBeforeIso: string,
    limit: number,
  ): Promise<SquadTeam[]>;
  markSquadAsked(provider: Provider, teamId: string, answered: boolean): Promise<void>;
  /** Our person id for each provider id that is already mapped; the rest are absent. */
  mappedPersons(provider: Provider, externalIds: string[]): Promise<Map<string, string>>;
  /**
   * Replaces the club's listed squad with `members`, and records that the
   * listing named `listed` players in all (T-1428). One transaction.
   */
  replaceSquadListing(
    provider: Provider,
    teamId: string,
    listed: number,
    members: SquadMember[],
  ): Promise<void>;
}

/** Where a photo address goes. `MediaService.note`; never throws. */
export interface PhotoSink {
  note(
    provider: Provider,
    entityType: 'person',
    entityId: string,
    sourceUrl: string,
  ): Promise<void>;
}

export interface SquadSweep {
  /** Squad requests sent: one per club asked. */
  asked: number;
  answered: number;
  /** Players the answers listed. */
  listed: number;
  /** Listed players we hold, whose photo address was handed to the media store. */
  noted: number;
  /** Listed players we hold, recorded as the club's squad with number and position. */
  members: number;
  refused: string[];
  /** Why nothing was asked, when nothing was. */
  idle?: string;
}

const HOUR_MS = 60 * 60 * 1000;

function utcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** How many squads this run may ask for. Pure. */
export function squadAllowance(seen: {
  perDay: number;
  askedToday: number;
  budget: number | null;
  requestsToday: number;
}): number {
  if (seen.budget !== null && seen.requestsToday * 100 >= seen.budget * SQUAD_HEADROOM_PERCENT) {
    return 0;
  }
  return Math.max(0, seen.perDay - seen.askedToday);
}

export async function sweepSquads(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: SquadStore;
  media: PhotoSink;
  seasonIds: string[];
  now: Date;
  perDay: number;
  /** The deployment's daily request budget, or `null` for none of its own. */
  budget: number | null;
  requestsToday: number;
  /** Spaces the asks; injected so a test does not sleep. */
  pacer?: { pace(): Promise<void> };
}): Promise<SquadSweep> {
  const { provider, adapter, store, media, now } = input;
  const pacer = input.pacer ?? new AskPacer();
  const sweep: SquadSweep = {
    asked: 0,
    answered: 0,
    listed: 0,
    noted: 0,
    members: 0,
    refused: [],
  };
  if (adapter.getSquad === undefined) {
    return { ...sweep, idle: `${provider} does not list squads` };
  }
  if (input.perDay === 0) return { ...sweep, idle: 'INGESTION_SQUADS_PER_DAY=0' };

  const allowance = squadAllowance({
    perDay: input.perDay,
    askedToday: await store.squadsAskedSince(provider, utcMidnight(now).toISOString()),
    budget: input.budget,
    requestsToday: input.requestsToday,
  });
  if (allowance === 0) {
    return {
      ...sweep,
      idle:
        input.budget !== null && input.requestsToday * 100 >= input.budget * SQUAD_HEADROOM_PERCENT
          ? `the day's requests are past ${SQUAD_HEADROOM_PERCENT}% of the budget`
          : `the day's ${input.perDay} squad requests are spent`,
    };
  }

  const due = await store.squadsDue(
    provider,
    input.seasonIds,
    new Date(now.getTime() - SQUAD_STALE_DAYS * 24 * HOUR_MS).toISOString(),
    new Date(now.getTime() - SQUAD_RETRY_HOURS * HOUR_MS).toISOString(),
    allowance,
  );
  if (due.length === 0) return { ...sweep, idle: 'every club’s squad is current' };

  for (const team of due) {
    await pacer.pace();
    const result = await adapter.getSquad(team.externalId);
    sweep.asked += result.requests;
    await store.markSquadAsked(provider, team.teamId, result.ok);
    if (!result.ok) {
      sweep.refused.push(`team ${team.externalId}: ${result.error.kind}: ${result.error.message}`);
      // The plan, or our own budget, has said no: nobody else will be answered today.
      if (result.error.kind === 'quota') break;
      continue;
    }
    sweep.answered += 1;
    sweep.listed += result.data.length;
    const held = await store.mappedPersons(
      provider,
      result.data.map((p) => p.externalId),
    );
    sweep.noted += await notePhotos(provider, media, result.data, held);
    const members = result.data.flatMap((p): SquadMember[] => {
      const personId = held.get(p.externalId);
      return personId === undefined
        ? []
        : [{ personId, shirtNumber: p.shirtNumber, position: p.position }];
    });
    await store.replaceSquadListing(provider, team.teamId, result.data.length, members);
    sweep.members += members.length;
  }
  return sweep;
}

async function notePhotos(
  provider: Provider,
  media: PhotoSink,
  players: NormalisedSquadPlayer[],
  held: Map<string, string>,
): Promise<number> {
  let noted = 0;
  for (const player of players) {
    const personId = held.get(player.externalId);
    if (personId === undefined || typeof player.imageUrl !== 'string') continue;
    await media.note(provider, 'person', personId, player.imageUrl);
    noted += 1;
  }
  return noted;
}
