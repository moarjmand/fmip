/**
 * Player photos for players already in our records (T-1324, D-176).
 *
 * T-1320 notes a player's photo only when an ingest touches the player, so a
 * player of a match ingested before it has none until he plays again. The
 * `squads` job asks the provider for each club's squad -- one request per
 * club, each club at most once a month -- and hands the photo of every listed
 * player we already hold to the media store, exactly as the other writers do.
 *
 * It never creates a person and never queues one for review: a squad lists
 * thirty players and most of them have never played a match we hold, so an
 * unknown id is simply not ours yet. Only `provider_mapping` is read.
 *
 * Its budget is its own and small: `INGESTION_SQUADS_PER_DAY` requests a UTC
 * day (default 60; 0 turns it off), and none while the day's requests are at
 * or past `SQUAD_HEADROOM_PERCENT` of the deployment's daily budget (T-501),
 * so photos never compete with match data for the plan.
 */

import type { EntityRef, Provider, ProviderAdapter } from '@fmip/ingestion';

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

/** The SQL the sweep needs. Implemented by `IngestStore`. */
export interface SquadStore {
  /** Clubs asked about since `sinceIso`: the day's squad requests so far. */
  squadsAskedSince(provider: Provider, sinceIso: string): Promise<number>;
  /** Mapped clubs playing in the given seasons that are owed a squad answer. */
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
}): Promise<SquadSweep> {
  const { provider, adapter, store, media, now } = input;
  const sweep: SquadSweep = { asked: 0, answered: 0, listed: 0, noted: 0, refused: [] };
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
    sweep.noted += await notePhotos(provider, store, media, result.data);
  }
  return sweep;
}

async function notePhotos(
  provider: Provider,
  store: SquadStore,
  media: PhotoSink,
  players: EntityRef[],
): Promise<number> {
  const withPhoto = players.filter(
    (p): p is EntityRef & { imageUrl: string } => typeof p.imageUrl === 'string',
  );
  if (withPhoto.length === 0) return 0;
  const held = await store.mappedPersons(
    provider,
    withPhoto.map((p) => p.externalId),
  );
  let noted = 0;
  for (const player of withPhoto) {
    const personId = held.get(player.externalId);
    if (personId === undefined) continue;
    await media.note(provider, 'person', personId, player.imageUrl);
    noted += 1;
  }
  return noted;
}
