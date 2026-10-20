/**
 * Player bios from the provider's player profile (T-1428, D-220).
 *
 * The `people_names` job's profile ask (T-1398) answers with the birth date,
 * nationality and height too, and only the name was kept. This pass, run by
 * the same job after the names, asks each player's profile once and fills
 * `person.date_of_birth`, `nationality_id`, `height_cm` and `preferred_foot`
 * where they are empty. A value we already hold is never overwritten, and a
 * value the profile does not give, or gives unreadably, stays empty (rule 3).
 *
 * Two guards keep a profile on the right person. Only people never named as
 * a coach or a referee are asked: a coach's provider id is not a player id,
 * and the same number can be another man's profile. And the answer is used
 * only when its name agrees with ours -- the short form the line-ups print,
 * the full name, or the short form the names job replaced -- compared without
 * accents or case; otherwise nothing is written (`name_differs`).
 *
 * The nationality is a `country` row: the one with the FIFA trigram the
 * adapter knows for the provider's spelling, else the one of exactly that
 * name (accents, case and punctuation aside). Anything else stays empty, and
 * the spelling is recorded on the ask for review.
 *
 * Its budget is the `people_names` job's: the bulk tier (D-183), the run's
 * wall-clock limit and the gap between two asks are shared with the names
 * pass, and `INGESTION_PEOPLE_BIOS_BATCH` caps the asks a run.
 */

import {
  foldCountry,
  type NormalisedPersonProfile,
  type PreferredFoot,
  type Provider,
  type ProviderAdapter,
} from '@fmip/ingestion';
import {
  PEOPLE_NAMES_ASK_GAP_MS,
  PEOPLE_NAMES_MAX_ATTEMPTS,
  PEOPLE_NAMES_RETRY_HOURS,
  PEOPLE_NAMES_RUN_MS,
  foldName,
  fullNameFromProfile,
  peopleNamesAllowance,
} from './person-names';

/** The default number of bio asks one run makes. */
export const PEOPLE_BIOS_BATCH = 60;
/** A ceiling on the setting: a run's wall-clock limit allows about 120 asks anyway. */
export const MAX_PEOPLE_BIOS_BATCH = 120;

/** The batch this deployment asked for: 0 turns the pass off, else 1 to the ceiling, else the default. */
export function peopleBiosBatch(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_PEOPLE_BIOS_BATCH
    ? value
    : PEOPLE_BIOS_BATCH;
}

/** What the pass did with an answered profile. Mirrors `person_bio_fetch_outcome_check`. */
export type PersonBioOutcome = 'written' | 'nothing_new' | 'no_profile' | 'name_differs';

/** A player the pass may ask about, with every name we know them by. */
export interface BioPerson {
  personId: string;
  externalId: string;
  /** `full_name`, `known_as`, and the short form the names job replaced, when there is one. */
  names: string[];
}

/** A country the nationality can be. */
export interface BioCountry {
  id: string;
  code: string;
  name: string;
}

/** The fields a profile can fill, by column. */
export interface BioFields {
  date_of_birth?: string;
  nationality_id?: string;
  height_cm?: number;
  preferred_foot?: PreferredFoot;
}

/** What the pass records about one answered ask. */
export interface PersonBioAnswer {
  outcome: Exclude<PersonBioOutcome, 'written' | 'nothing_new'> | 'readable';
  detail: string;
  /** What the profile offers; the store writes only the fields still empty. */
  fields: BioFields;
  unmatchedNationality: string | null;
}

/** The SQL the pass needs. Implemented by `PersonBioStore`. */
export interface PersonBiosStore {
  /**
   * Players owed an ask: mapped, never named as a coach or a referee, with a
   * bio field still empty, never answered, not asked since `askedBeforeIso`,
   * fewer than `maxAttempts` asks. Players in a club's listed squad first.
   */
  peopleBiosDue(
    provider: Provider,
    askedBeforeIso: string,
    maxAttempts: number,
    limit: number,
  ): Promise<BioPerson[]>;
  countries(): Promise<BioCountry[]>;
  markPersonBioAsked(provider: Provider, personId: string): Promise<void>;
  /**
   * Records an answer, filling only the fields still empty, in one
   * transaction. Returns `written` when a field was filled, `nothing_new`
   * when a readable answer filled none.
   */
  recordPersonBioAnswer(
    provider: Provider,
    personId: string,
    answer: PersonBioAnswer,
  ): Promise<PersonBioOutcome>;
}

export interface PeopleBiosSweep {
  asked: number;
  answered: number;
  written: number;
  kept: Partial<Record<Exclude<PersonBioOutcome, 'written'>, number>>;
  refused: string[];
  idle?: string;
}

// -- The bio rule. Pure. ----------------------------------------------------

const fold = (text: string): string => foldName(text.replace(/\s+/g, ' ').trim());

/** Whether the profile is of the person we hold: one of our names is one of its. */
export function profileAgrees(names: string[], profile: NormalisedPersonProfile): boolean {
  const theirs = new Set<string>();
  if (profile.shortName !== null) {
    theirs.add(fold(profile.shortName));
    const full = fullNameFromProfile(profile.shortName, profile);
    if (full.fullName !== undefined) theirs.add(fold(full.fullName));
  }
  if (profile.name !== null) theirs.add(fold(profile.name.fullName));
  return names.some((n) => theirs.has(fold(n)));
}

/** The country for a nationality: by trigram, else by exactly that name, else none. */
export function countryOf(
  nationality: { name: string; code: string | null },
  countries: BioCountry[],
): BioCountry | null {
  if (nationality.code !== null) {
    const byCode = countries.find((c) => c.code === nationality.code);
    if (byCode !== undefined) return byCode;
  }
  const name = foldCountry(nationality.name);
  return countries.find((c) => foldCountry(c.name) === name) ?? null;
}

/**
 * What a profile offers for a person we know by `names`. Pure: the whole
 * decision of D-220, so it can be argued with in a unit test.
 */
export function bioFromProfile(
  names: string[],
  profile: NormalisedPersonProfile | null,
  countries: BioCountry[],
  now: Date,
): PersonBioAnswer {
  const none = { fields: {}, unmatchedNationality: null };
  if (profile === null) {
    return { outcome: 'no_profile', detail: 'the provider has no profile for the id', ...none };
  }
  if (!profileAgrees(names, profile)) {
    const said = profile.shortName ?? profile.name?.fullName ?? 'no name';
    return {
      outcome: 'name_differs',
      detail: `the profile is of "${said}", not "${names[0] ?? ''}"`,
      ...none,
    };
  }
  const { bio } = profile;
  const fields: BioFields = {};
  const today = now.toISOString().slice(0, 10);
  if (bio.dateOfBirth !== null && bio.dateOfBirth <= today) fields.date_of_birth = bio.dateOfBirth;
  let unmatchedNationality: string | null = null;
  if (bio.nationality !== null) {
    const country = countryOf(bio.nationality, countries);
    if (country === null) unmatchedNationality = bio.nationality.name;
    else fields.nationality_id = country.id;
  }
  if (bio.heightCm !== null) fields.height_cm = bio.heightCm;
  if (bio.preferredFoot !== null) fields.preferred_foot = bio.preferredFoot;
  const offered = Object.keys(fields);
  return {
    outcome: 'readable',
    detail:
      offered.length === 0
        ? 'the profile gives no birth date, known nationality, height or foot'
        : `the profile gives ${offered.join(', ')}`,
    fields,
    unmatchedNationality,
  };
}

// -- The pass. ---------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

export async function sweepPeopleBios(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: PersonBiosStore;
  now: Date;
  batch: number;
  budget: number | null;
  bulkPercent: number;
  /** The day's requests so far, the names pass's included. */
  requestsToday: number;
  clock?: () => number;
  /** What is left of the run's wall-clock limit after the names pass. */
  runMs?: number;
  wait?: (ms: number) => Promise<void>;
  gapMs?: number;
}): Promise<PeopleBiosSweep> {
  const { provider, adapter, store, now } = input;
  const clock = input.clock ?? Date.now;
  const wait =
    input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gapMs = input.gapMs ?? PEOPLE_NAMES_ASK_GAP_MS;
  const sweep: PeopleBiosSweep = { asked: 0, answered: 0, written: 0, kept: {}, refused: [] };
  if (adapter.getPersonProfile === undefined) {
    return { ...sweep, idle: `${provider} has no player profiles` };
  }
  if (input.batch === 0) return { ...sweep, idle: 'INGESTION_PEOPLE_BIOS_BATCH=0' };
  const allowance = peopleNamesAllowance(input);
  if (allowance === 0) {
    return {
      ...sweep,
      idle: `the day's requests are at ${input.bulkPercent}% of the budget (bulk tier)`,
    };
  }
  const deadline = clock() + (input.runMs ?? PEOPLE_NAMES_RUN_MS);
  if (clock() >= deadline) return { ...sweep, idle: 'the names pass used the run' };
  const due = await store.peopleBiosDue(
    provider,
    new Date(now.getTime() - PEOPLE_NAMES_RETRY_HOURS * HOUR_MS).toISOString(),
    PEOPLE_NAMES_MAX_ATTEMPTS,
    allowance,
  );
  if (due.length === 0) return { ...sweep, idle: 'no player is owed a bio ask' };
  const countries = await store.countries();

  for (const person of due) {
    // Spaced from the ask before, the names pass's last one included.
    await wait(gapMs);
    if (clock() >= deadline) break;
    const result = await adapter.getPersonProfile(person.externalId);
    sweep.asked += result.requests;
    if (!result.ok) {
      sweep.refused.push(
        `person ${person.externalId}: ${result.error.kind}: ${result.error.message}`,
      );
      if (result.error.kind === 'quota') break;
      await store.markPersonBioAsked(provider, person.personId);
      continue;
    }
    sweep.answered += 1;
    const outcome = await store.recordPersonBioAnswer(
      provider,
      person.personId,
      bioFromProfile(person.names, result.data, countries, now),
    );
    if (outcome === 'written') sweep.written += 1;
    else sweep.kept[outcome] = (sweep.kept[outcome] ?? 0) + 1;
  }
  return sweep;
}
