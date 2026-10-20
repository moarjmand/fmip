import type {
  AdapterResult,
  NormalisedPersonBio,
  NormalisedPersonProfile,
  ProviderAdapter,
} from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import {
  MAX_PEOPLE_BIOS_BATCH,
  PEOPLE_BIOS_BATCH,
  bioFromProfile,
  countryOf,
  peopleBiosBatch,
  profileAgrees,
  sweepPeopleBios,
  type BioCountry,
  type BioPerson,
  type PersonBioAnswer,
  type PersonBioOutcome,
  type PersonBiosStore,
} from './person-bios';

/** The bio rule and the bio pass of the `people_names` job (T-1428, D-220). */

const NO_BIO: NormalisedPersonBio = {
  dateOfBirth: null,
  nationality: null,
  heightCm: null,
  preferredFoot: null,
};

const salah = (bio: Partial<NormalisedPersonBio> = {}): NormalisedPersonProfile => ({
  externalId: '1',
  shortName: 'M. Salah',
  name: {
    fullName: 'Mohamed Salah Hamed Mahrous Ghaly',
    givenName: 'Mohamed',
    familyName: 'Salah Hamed Mahrous Ghaly',
  },
  bio: { ...NO_BIO, ...bio },
});

const COUNTRIES: BioCountry[] = [
  { id: 'c-egy', code: 'EGY', name: 'Egypt' },
  { id: 'c-civ', code: 'CIV', name: "Côte d'Ivoire" },
  { id: 'c-kor', code: 'KOR', name: 'South Korea' },
];

const NOW = new Date('2026-10-20T10:00:00Z');

describe('whether a profile is of the person we hold', () => {
  it('agrees on the short form, the full name, or the name the names job wrote', () => {
    expect(profileAgrees(['M. Salah'], salah())).toBe(true);
    expect(profileAgrees(['m. SALAH'], salah())).toBe(true);
    expect(profileAgrees(['Mohamed Salah'], salah())).toBe(true);
    expect(profileAgrees(['Mohamed Salah Hamed Mahrous Ghaly'], salah())).toBe(true);
    expect(profileAgrees(['Someone Else', 'M. Salah'], salah())).toBe(true);
  });

  it('disagrees with another name: a coach id read as a player id finds another man', () => {
    expect(profileAgrees(['P. Guardiola'], salah())).toBe(false);
    expect(profileAgrees(['Salah'], salah())).toBe(false);
    expect(profileAgrees(['M. Salah'], { ...salah(), shortName: null, name: null })).toBe(false);
  });
});

describe('the country of a nationality', () => {
  it('is found by the trigram, else by exactly the name, else not at all', () => {
    expect(countryOf({ name: 'Korea Republic', code: 'KOR' }, COUNTRIES)?.id).toBe('c-kor');
    expect(countryOf({ name: 'egypt', code: null }, COUNTRIES)?.id).toBe('c-egy');
    expect(countryOf({ name: 'Cote-d’Ivoire', code: null }, COUNTRIES)?.id).toBe('c-civ');
    expect(countryOf({ name: 'Egyptian', code: null }, COUNTRIES)).toBeNull();
    expect(countryOf({ name: 'Korea', code: null }, COUNTRIES)).toBeNull();
    // A trigram we have no row for is not a guess at a name either.
    expect(countryOf({ name: 'Atlantis', code: 'ATL' }, COUNTRIES)).toBeNull();
  });
});

describe('what a profile offers', () => {
  it('offers every readable field, the nationality as our country row', () => {
    const answer = bioFromProfile(
      ['M. Salah'],
      salah({
        dateOfBirth: '1992-06-15',
        nationality: { name: 'Egypt', code: null },
        heightCm: 175,
      }),
      COUNTRIES,
      NOW,
    );
    expect(answer).toEqual({
      outcome: 'readable',
      detail: 'the profile gives date_of_birth, nationality_id, height_cm',
      fields: { date_of_birth: '1992-06-15', nationality_id: 'c-egy', height_cm: 175 },
      unmatchedNationality: null,
    });
  });

  it('leaves an unmatched nationality empty and records the spelling', () => {
    const answer = bioFromProfile(
      ['M. Salah'],
      salah({ nationality: { name: 'Atlantis', code: null } }),
      COUNTRIES,
      NOW,
    );
    expect(answer).toMatchObject({
      outcome: 'readable',
      fields: {},
      unmatchedNationality: 'Atlantis',
    });
  });

  it('never takes a birth date after today', () => {
    expect(
      bioFromProfile(['M. Salah'], salah({ dateOfBirth: '2026-10-21' }), COUNTRIES, NOW).fields,
    ).toEqual({});
    expect(
      bioFromProfile(['M. Salah'], salah({ dateOfBirth: '2026-10-20' }), COUNTRIES, NOW).fields,
    ).toEqual({ date_of_birth: '2026-10-20' });
  });

  it('offers nothing for no profile, or a profile of somebody else', () => {
    expect(bioFromProfile(['M. Salah'], null, COUNTRIES, NOW)).toMatchObject({
      outcome: 'no_profile',
      fields: {},
    });
    expect(bioFromProfile(['A. Other'], salah({ heightCm: 175 }), COUNTRIES, NOW)).toMatchObject({
      outcome: 'name_differs',
      fields: {},
    });
  });
});

describe('the bio batch setting', () => {
  it('is a whole number from 0 to the ceiling, else the default', () => {
    expect(peopleBiosBatch(undefined)).toBe(PEOPLE_BIOS_BATCH);
    expect(peopleBiosBatch('0')).toBe(0);
    expect(peopleBiosBatch(String(MAX_PEOPLE_BIOS_BATCH))).toBe(MAX_PEOPLE_BIOS_BATCH);
    expect(peopleBiosBatch(String(MAX_PEOPLE_BIOS_BATCH + 1))).toBe(PEOPLE_BIOS_BATCH);
    expect(peopleBiosBatch('ten')).toBe(PEOPLE_BIOS_BATCH);
  });
});

class FakeStore implements PersonBiosStore {
  due: BioPerson[] = [];
  limit = -1;
  asked: string[] = [];
  answers: { personId: string; answer: PersonBioAnswer }[] = [];
  peopleBiosDue(_p: string, _a: string, _m: number, limit: number): Promise<BioPerson[]> {
    this.limit = limit;
    return Promise.resolve(this.due.slice(0, limit));
  }
  countries(): Promise<BioCountry[]> {
    return Promise.resolve(COUNTRIES);
  }
  markPersonBioAsked(_p: string, personId: string): Promise<void> {
    this.asked.push(personId);
    return Promise.resolve();
  }
  recordPersonBioAnswer(
    _p: string,
    personId: string,
    answer: PersonBioAnswer,
  ): Promise<PersonBioOutcome> {
    this.answers.push({ personId, answer });
    return Promise.resolve(
      answer.outcome !== 'readable'
        ? answer.outcome
        : Object.keys(answer.fields).length > 0
          ? 'written'
          : 'nothing_new',
    );
  }
}

const ok = (
  data: NormalisedPersonProfile | null,
): AdapterResult<NormalisedPersonProfile | null> => ({
  ok: true,
  data,
  requests: 1,
  fetchedAt: '2026-10-20T00:00:00Z',
});

function adapterAnswering(
  answer: (id: string) => AdapterResult<NormalisedPersonProfile | null>,
  calls: string[] = [],
): ProviderAdapter {
  return {
    getPersonProfile: (id: string) => {
      calls.push(id);
      return Promise.resolve(answer(id));
    },
  } as unknown as ProviderAdapter;
}

const player = (n: number, names = ['M. Salah']): BioPerson => ({
  personId: `p${n}`,
  externalId: `${n}`,
  names,
});

const base = {
  provider: 'api_football' as const,
  now: NOW,
  batch: 60,
  budget: 75_000,
  bulkPercent: 70,
  requestsToday: 5_000,
  wait: () => Promise.resolve(),
};

describe('the bio pass', () => {
  it('asks each due player once and records what it did', async () => {
    const store = new FakeStore();
    store.due = [player(1), player(2, ['A. Other']), player(3), player(4)];
    const sweep = await sweepPeopleBios({
      ...base,
      store,
      adapter: adapterAnswering((id) =>
        id === '1' || id === '2'
          ? ok(salah({ heightCm: 175 }))
          : id === '3'
            ? ok(salah())
            : ok(null),
      ),
    });
    expect(sweep).toMatchObject({ asked: 4, answered: 4, written: 1, refused: [] });
    expect(sweep.kept).toEqual({ name_differs: 1, nothing_new: 1, no_profile: 1 });
    expect(store.limit).toBe(60);
  });

  it('asks within the bulk tier, the names pass’s requests counted', async () => {
    const store = new FakeStore();
    store.due = [player(1), player(2), player(3)];
    const sweep = await sweepPeopleBios({
      ...base,
      store,
      requestsToday: Math.floor((75_000 * 70) / 100) - 2,
      adapter: adapterAnswering(() => ok(salah())),
    });
    expect(store.limit).toBe(2);
    expect(sweep.asked).toBe(2);
    const full = new FakeStore();
    const idle = await sweepPeopleBios({
      ...base,
      store: full,
      requestsToday: 75_000,
      adapter: adapterAnswering(() => ok(salah())),
    });
    expect(idle.idle).toMatch(/bulk tier/);
    expect(full.limit).toBe(-1);
  });

  it('retries a failed ask later; a quota refusal stops the run, uncounted', async () => {
    const store = new FakeStore();
    store.due = [player(1), player(2), player(3)];
    const calls: string[] = [];
    const sweep = await sweepPeopleBios({
      ...base,
      store,
      adapter: adapterAnswering(
        (id) =>
          id === '1'
            ? { ok: false, error: { kind: 'http', message: '500' }, requests: 1 }
            : { ok: false, error: { kind: 'quota', message: 'limit' }, requests: 1 },
        calls,
      ),
    });
    expect(calls).toEqual(['1', '2']);
    expect(store.asked).toEqual(['p1']);
    expect(sweep.refused).toHaveLength(2);
  });

  it('spaces every ask, and stops at what is left of the run', async () => {
    const store = new FakeStore();
    store.due = [player(1), player(2), player(3)];
    let t = 0;
    const waits: number[] = [];
    const sweep = await sweepPeopleBios({
      ...base,
      store,
      clock: () => t,
      runMs: 500,
      gapMs: 250,
      wait: (ms) => {
        waits.push(ms);
        t += ms;
        return Promise.resolve();
      },
      adapter: adapterAnswering(() => ok(salah())),
    });
    expect(waits).toEqual([250, 250]);
    expect(sweep.asked).toBe(1);
    const spent = await sweepPeopleBios({
      ...base,
      store: new FakeStore(),
      runMs: 0,
      adapter: adapterAnswering(() => ok(salah())),
    });
    expect(spent.idle).toBe('the names pass used the run');
  });

  it('is off at batch 0, and idle without profiles or anyone due', async () => {
    const off = await sweepPeopleBios({
      ...base,
      batch: 0,
      store: new FakeStore(),
      adapter: adapterAnswering(() => ok(null)),
    });
    expect(off.idle).toBe('INGESTION_PEOPLE_BIOS_BATCH=0');
    const none = await sweepPeopleBios({
      ...base,
      store: new FakeStore(),
      adapter: {} as ProviderAdapter,
    });
    expect(none.idle).toBe('api_football has no player profiles');
    const nobody = await sweepPeopleBios({
      ...base,
      store: new FakeStore(),
      adapter: adapterAnswering(() => ok(null)),
    });
    expect(nobody.idle).toBe('no player is owed a bio ask');
  });
});
