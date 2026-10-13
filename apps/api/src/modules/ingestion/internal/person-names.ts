/**
 * Full player names from the provider's player profile (T-1398, D-213).
 *
 * About two people in three are stored under the name the line-ups, events
 * and player statistics print, an initial and a surname ("M. Salah"),
 * because that is all those answers carry and a person is adopted under the
 * name the feed gave (D-079). The `people_names` job asks the profile of each
 * such person once and, where the profile agrees with the short form, writes
 * the name in full ("Mohamed Salah") and keeps the short form as a search
 * alias.
 *
 * Agreeing means two things, both of which must hold:
 *  - the short form's surname is a run of the profile's family names
 *    ("Salah" in "Salah Hamed Mahrous Ghaly"), compared without accents or
 *    case;
 *  - each initial is the first letter of one of the profile's given names,
 *    in order ("M." and "Mohamed").
 * The name written is those given names and that surname, in the profile's
 * spelling: "Mohamed Salah", never the legal "Mohamed Salah Hamed Mahrous
 * Ghaly", which nobody reading a team sheet knows him by. Anything else
 * leaves the name alone and records why.
 *
 * Its budget is the bulk tier's (D-183): at most `INGESTION_PEOPLE_NAMES_BATCH`
 * asks a run, none once the day's requests reach the bulk share of the
 * budget, and none past `PEOPLE_NAMES_RUN_MS` of wall-clock time, because the
 * ingestion worker runs one job at a time and the live job is waiting behind
 * this one. The asks are spaced `PEOPLE_NAMES_ASK_GAP_MS` apart (T-1405): sent
 * back to back, fifty profiles went out in two seconds and the provider
 * refused that run, and the live and standings ticks after it, with its
 * per-minute "rateLimit".
 */

import {
  decodeEntities,
  type NormalisedPersonProfile,
  type Provider,
  type ProviderAdapter,
} from '@fmip/ingestion';

/** The default number of profiles one run asks for. */
export const PEOPLE_NAMES_BATCH = 50;
/** A ceiling on the setting, so a typo cannot hold the worker for minutes. */
export const MAX_PEOPLE_NAMES_BATCH = 200;
/** No new ask once a run has taken this long: the live job is queued behind it. */
export const PEOPLE_NAMES_RUN_MS = 30_000;
/**
 * The wait between two asks: at most four a second, so a full batch of fifty
 * takes about 12 seconds and leaves most of the plan's 450 a minute to the
 * other jobs (T-1405).
 */
export const PEOPLE_NAMES_ASK_GAP_MS = 250;
/** How long after an unanswered ask a person is asked again. */
export const PEOPLE_NAMES_RETRY_HOURS = 24;
/** How many unanswered asks a person gets before the job stops asking. */
export const PEOPLE_NAMES_MAX_ATTEMPTS = 5;

/** The batch this deployment asked for: 0 turns the job off, else 1 to the ceiling, else the default. */
export function peopleNamesBatch(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_PEOPLE_NAMES_BATCH
    ? value
    : PEOPLE_NAMES_BATCH;
}

/** What the job did with an answered profile. Mirrors `person_name_fetch_outcome_check`. */
export type PersonNameOutcome =
  'written' | 'no_profile' | 'family_name_differs' | 'initial_differs' | 'name_kept';

/** A person the job may ask about: our id, the provider's, and the name we store. */
export interface ShortNamedPerson {
  personId: string;
  externalId: string;
  storedName: string;
}

/** What the job records about one answered ask. */
export interface PersonNameAnswer {
  outcome: PersonNameOutcome;
  detail: string;
  profileName: string | null;
  /** The full name, when `outcome` is `written`; the store writes it only over `storedName`. */
  fullName?: string;
  /** The short form, entity-decoded, kept as a search alias when the name is written. */
  alias?: string;
}

/** The SQL the job needs. Implemented by `PersonNameStore`. */
export interface PersonNamesStore {
  /**
   * People stored under a short form who are owed an ask: never answered, not
   * asked since `askedBeforeIso`, fewer than `maxAttempts` asks, and no sign
   * that a person rather than the feed chose the name.
   */
  peopleNamesDue(
    provider: Provider,
    askedBeforeIso: string,
    maxAttempts: number,
    limit: number,
  ): Promise<ShortNamedPerson[]>;
  /** Records an ask the provider did not answer. */
  markPersonNameAsked(provider: Provider, personId: string): Promise<void>;
  /**
   * Records an answer, and when it is `written` writes the full name and the
   * alias in the same transaction -- only if the stored name is still
   * `storedName`; otherwise the outcome becomes `name_kept`. Returns the
   * outcome recorded.
   */
  recordPersonNameAnswer(
    provider: Provider,
    person: ShortNamedPerson,
    answer: PersonNameAnswer,
  ): Promise<PersonNameOutcome>;
}

export interface PeopleNamesSweep {
  /** Profile requests sent. */
  asked: number;
  answered: number;
  written: number;
  /** Answered without a name written, by outcome. */
  kept: Partial<Record<Exclude<PersonNameOutcome, 'written'>, number>>;
  refused: string[];
  /** Why nothing was asked, when nothing was. */
  idle?: string;
}

// -- The name rule. Pure. ---------------------------------------------------

/** HTML character references, as the feed sometimes stores them ("O&apos;Neill"). */
const plain = (text: string): string => decodeEntities(text).replace(/\s+/g, ' ').trim();

/** Latin letters, spaces, full stops, apostrophes and hyphens only. */
const LATIN_NAME = /^[\p{Script=Latin}\s.'’-]+$/u;
/** One or more initials ("M.", "A. S.", "E.Lako"), then the surname. */
const SHORT_FORM = /^((?:\p{L}\.\s*)+)(\p{L}.*)$/u;
/** A given name as written: a capital, then letters, apostrophes or hyphens. */
const GIVEN_WORD = /^\p{Lu}[\p{L}'’-]*\p{L}$/u;
/** A word of a surname: the same, or a lower-case particle ("van", "dos"). */
const SURNAME_WORD = /^\p{L}[\p{L}'’-]*\p{L}$/u;

/** Accent- and case-folded, one apostrophe: what two spellings are compared by. */
export function foldName(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/’/g, "'").toLowerCase();
}

/** The short form's initials and surname, or `null` when the name is not one. */
export function parseShortForm(stored: string): { initials: string[]; surname: string[] } | null {
  const name = plain(stored);
  if (!LATIN_NAME.test(name)) return null;
  const match = SHORT_FORM.exec(name);
  if (match === null) return null;
  const initials = (match[1] ?? '').match(/\p{L}/gu) ?? [];
  const surname = (match[2] ?? '').split(' ').filter((w) => w !== '');
  if (initials.length === 0 || surname.length === 0) return null;
  // "A. B." with nothing after it is not a surname.
  if (surname.every((w) => /^\p{L}\.$/u.test(w))) return null;
  return { initials, surname };
}

/** A word in the profile's spelling, unless the profile shouts it ("SALAH"). */
function spelled(profileWord: string, fallback: string): string {
  return profileWord.length > 1 && profileWord === profileWord.toUpperCase()
    ? fallback
    : profileWord;
}

function titleCase(word: string): string {
  return word.length > 1 && word === word.toUpperCase()
    ? word.charAt(0) + word.slice(1).toLowerCase()
    : word;
}

/**
 * What to do with a profile for a person stored under `stored`. Pure: the
 * whole decision of D-213, so it can be argued with in a unit test.
 */
export function fullNameFromProfile(
  stored: string,
  profile: NormalisedPersonProfile | null,
): PersonNameAnswer {
  if (profile === null) {
    return {
      outcome: 'no_profile',
      detail: 'the provider has no profile with both names',
      profileName: null,
    };
  }
  const profileName = profile.fullName;
  const short = parseShortForm(stored);
  if (short === null) {
    return {
      outcome: 'name_kept',
      detail: 'the stored name is not an initial and a Latin-script surname',
      profileName,
    };
  }

  const family = profile.familyName.split(/\s+/).filter((w) => w !== '');
  const wanted = short.surname.map(foldName);
  let at = -1;
  for (let i = 0; i + wanted.length <= family.length; i += 1) {
    if (wanted.every((w, k) => foldName(family[i + k] ?? '') === w)) {
      at = i;
      break;
    }
  }
  if (at < 0) {
    return {
      outcome: 'family_name_differs',
      detail: `"${short.surname.join(' ')}" is not among the family names "${profile.familyName}"`,
      profileName,
    };
  }
  const surname = short.surname.map((w, k) => spelled(family[at + k] ?? w, w));

  const given = profile.givenName.split(/\s+/).filter((w) => w !== '');
  const initials = short.initials.map(foldName);
  let from = -1;
  for (let i = 0; i + initials.length <= given.length; i += 1) {
    if (initials.every((c, k) => foldName(given[i + k] ?? '').charAt(0) === c)) {
      from = i;
      break;
    }
  }
  if (from < 0) {
    return {
      outcome: 'initial_differs',
      detail: `"${short.initials.join('. ')}." does not start the given names "${profile.givenName}"`,
      profileName,
    };
  }
  const givenWords = given.slice(from, from + initials.length).map(titleCase);

  const words = [...givenWords, ...surname];
  const fullName = words.join(' ');
  if (
    !givenWords.every((w) => GIVEN_WORD.test(w)) ||
    !surname.every((w) => SURNAME_WORD.test(w)) ||
    !LATIN_NAME.test(fullName)
  ) {
    return {
      outcome: 'name_kept',
      detail: `"${fullName}" is not a Latin-script name of whole words`,
      profileName,
    };
  }
  const alias = plain(stored);
  if (foldName(fullName) === foldName(alias)) {
    return {
      outcome: 'name_kept',
      detail: 'the profile adds nothing to the stored name',
      profileName,
    };
  }
  return {
    outcome: 'written',
    detail: `"${alias}" written as "${fullName}"`,
    profileName,
    fullName,
    alias,
  };
}

// -- The sweep. --------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

/** How many profiles this run may ask for. Pure. */
export function peopleNamesAllowance(seen: {
  batch: number;
  budget: number | null;
  bulkPercent: number;
  requestsToday: number;
}): number {
  if (seen.budget === null) return seen.batch;
  const ceiling = Math.floor((seen.budget * seen.bulkPercent) / 100);
  return Math.max(0, Math.min(seen.batch, ceiling - seen.requestsToday));
}

export async function sweepPeopleNames(input: {
  provider: Provider;
  adapter: ProviderAdapter;
  store: PersonNamesStore;
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
}): Promise<PeopleNamesSweep> {
  const { provider, adapter, store, now } = input;
  const clock = input.clock ?? Date.now;
  const wait =
    input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gapMs = input.gapMs ?? PEOPLE_NAMES_ASK_GAP_MS;
  const sweep: PeopleNamesSweep = { asked: 0, answered: 0, written: 0, kept: {}, refused: [] };
  if (adapter.getPersonProfile === undefined) {
    return { ...sweep, idle: `${provider} has no player profiles` };
  }
  if (input.batch === 0) return { ...sweep, idle: 'INGESTION_PEOPLE_NAMES_BATCH=0' };

  const allowance = peopleNamesAllowance(input);
  if (allowance === 0) {
    return {
      ...sweep,
      idle: `the day's requests are at ${input.bulkPercent}% of the budget (bulk tier)`,
    };
  }
  const due = await store.peopleNamesDue(
    provider,
    new Date(now.getTime() - PEOPLE_NAMES_RETRY_HOURS * HOUR_MS).toISOString(),
    PEOPLE_NAMES_MAX_ATTEMPTS,
    allowance,
  );
  if (due.length === 0)
    return { ...sweep, idle: 'no person stored under a short name is owed an ask' };

  const deadline = clock() + (input.runMs ?? PEOPLE_NAMES_RUN_MS);
  for (const [index, person] of due.entries()) {
    if (index > 0) await wait(gapMs);
    if (clock() >= deadline) break;
    const result = await adapter.getPersonProfile(person.externalId);
    sweep.asked += result.requests;
    if (!result.ok) {
      sweep.refused.push(
        `person ${person.externalId}: ${result.error.kind}: ${result.error.message}`,
      );
      // The plan, or our own budget, has said no: nobody else is asked this run.
      // The refusal says nothing about this person, so it costs them no attempt.
      if (result.error.kind === 'quota') break;
      await store.markPersonNameAsked(provider, person.personId);
      continue;
    }
    sweep.answered += 1;
    const outcome = await store.recordPersonNameAnswer(
      provider,
      person,
      fullNameFromProfile(person.storedName, result.data),
    );
    if (outcome === 'written') sweep.written += 1;
    else sweep.kept[outcome] = (sweep.kept[outcome] ?? 0) + 1;
  }
  return sweep;
}
