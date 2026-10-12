import type { AdapterResult, NormalisedPersonProfile, ProviderAdapter } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import {
  MAX_PEOPLE_NAMES_BATCH,
  PEOPLE_NAMES_BATCH,
  fullNameFromProfile,
  parseShortForm,
  peopleNamesAllowance,
  peopleNamesBatch,
  sweepPeopleNames,
  type PersonNameAnswer,
  type PersonNameOutcome,
  type PersonNamesStore,
  type ShortNamedPerson,
} from './person-names';

/** The name rule and the sweep of the `people_names` job (T-1398, D-213). */

const profile = (givenName: string, familyName: string): NormalisedPersonProfile => ({
  externalId: '1',
  fullName: `${givenName} ${familyName}`,
  givenName,
  familyName,
});

describe('the full name a profile gives a short form', () => {
  it('writes the given name the initial stands for and the surname, not the legal name', () => {
    const answer = fullNameFromProfile('M. Salah', profile('Mohamed', 'Salah Hamed Mahrous Ghaly'));
    expect(answer).toMatchObject({
      outcome: 'written',
      fullName: 'Mohamed Salah',
      alias: 'M. Salah',
      profileName: 'Mohamed Salah Hamed Mahrous Ghaly',
    });
  });

  it.each([
    ['E. Haaland', 'Erling Braut', 'Haaland', 'Erling Haaland'],
    ['K. De Bruyne', 'Kevin', 'De Bruyne', 'Kevin De Bruyne'],
    ['V. van Dijk', 'Virgil', 'van Dijk', 'Virgil van Dijk'],
    ['T. Alexander-Arnold', 'Trent John', 'Alexander-Arnold', 'Trent Alexander-Arnold'],
    // The profile's spelling wins: the feed's short form often drops accents.
    ['R. Araujo', 'Ronald Federico', 'Araújo da Silva', 'Ronald Araújo'],
    ['G. Jesus', 'Gabriel Fernando', 'de Jesus', 'Gabriel Jesus'],
    ['E.Lako', 'Elvis', 'Lako', 'Elvis Lako'],
    // An initial may stand for a later given name: the one he goes by.
    ['A. Smith', 'John Andrew', 'Smith', 'Andrew Smith'],
    // Several initials take as many given names, in order.
    ['A. S. Vaz dos Ramos', 'António Sérgio', 'Vaz dos Ramos', 'António Sérgio Vaz dos Ramos'],
    ['Ö. Kabak', 'Ozan', 'Kabak', 'Ozan Kabak'],
    // The feed stores entities; the alias and the comparison decode them.
    ['P. O&apos;Neill', 'Patrick', "O'Neill", "Patrick O'Neill"],
    // A profile in capitals keeps the short form's spelling of the surname.
    ['M. Salah', 'MOHAMED', 'SALAH', 'Mohamed Salah'],
  ])('%s with "%s" "%s" is %s', (short, given, family, full) => {
    expect(fullNameFromProfile(short, profile(given, family))).toMatchObject({
      outcome: 'written',
      fullName: full,
    });
  });

  it('keeps the alias decoded', () => {
    expect(fullNameFromProfile('P. O&apos;Neill', profile('Patrick', "O'Neill")).alias).toBe(
      "P. O'Neill",
    );
  });

  it('leaves the name alone when the family name is not the surname', () => {
    expect(fullNameFromProfile('M. Salah', profile('Mohamed', 'Elneny'))).toMatchObject({
      outcome: 'family_name_differs',
    });
    // A part of a word is not the word.
    expect(fullNameFromProfile('J. Alexander', profile('Trent', 'Alexander-Arnold'))).toMatchObject(
      { outcome: 'family_name_differs' },
    );
  });

  it('leaves the name alone when no given name starts with the initial', () => {
    const answer = fullNameFromProfile('M. Salah', profile('Ahmed', 'Salah'));
    expect(answer.outcome).toBe('initial_differs');
    expect(answer.fullName).toBeUndefined();
    // Two initials must be two given names in order.
    expect(fullNameFromProfile('A. S. Ramos', profile('Sérgio António', 'Ramos')).outcome).toBe(
      'initial_differs',
    );
  });

  it('records a missing profile, and keeps a name that is not a short Latin form', () => {
    expect(fullNameFromProfile('M. Salah', null)).toMatchObject({
      outcome: 'no_profile',
      profileName: null,
    });
    expect(fullNameFromProfile('Mohamed Salah', profile('Mohamed', 'Salah')).outcome).toBe(
      'name_kept',
    );
    expect(fullNameFromProfile('م. صلاح', profile('Mohamed', 'Salah')).outcome).toBe('name_kept');
    // Never a Latin name over another script's, and never another script's
    // name over a Latin one, whatever the profile says.
    expect(fullNameFromProfile('م. صلاح', profile('Mohamed', 'Salah')).fullName).toBeUndefined();
    expect(fullNameFromProfile('M. Salah', profile('Мохамед', 'Salah')).fullName).toBeUndefined();
    expect(fullNameFromProfile('M. Salah', profile('Mohamed', 'Салах')).fullName).toBeUndefined();
  });

  it('parses the short form', () => {
    expect(parseShortForm('M. Salah')).toEqual({ initials: ['M'], surname: ['Salah'] });
    expect(parseShortForm('A. S. Vaz dos Ramos')).toEqual({
      initials: ['A', 'S'],
      surname: ['Vaz', 'dos', 'Ramos'],
    });
    expect(parseShortForm('Rodri')).toBeNull();
    expect(parseShortForm('A. B.')).toBeNull();
  });
});

describe('the batch and the allowance', () => {
  it('reads the batch, 0 turns it off, nonsense is the default', () => {
    expect(peopleNamesBatch(undefined)).toBe(PEOPLE_NAMES_BATCH);
    expect(peopleNamesBatch('')).toBe(PEOPLE_NAMES_BATCH);
    expect(peopleNamesBatch('0')).toBe(0);
    expect(peopleNamesBatch('120')).toBe(120);
    expect(peopleNamesBatch(String(MAX_PEOPLE_NAMES_BATCH + 1))).toBe(PEOPLE_NAMES_BATCH);
    expect(peopleNamesBatch('-3')).toBe(PEOPLE_NAMES_BATCH);
    expect(peopleNamesBatch('ten')).toBe(PEOPLE_NAMES_BATCH);
  });

  it('stops at the bulk share of the budget', () => {
    const at = (requestsToday: number) =>
      peopleNamesAllowance({ batch: 50, budget: 70_000, bulkPercent: 70, requestsToday });
    expect(at(10_000)).toBe(50);
    expect(at(48_980)).toBe(20);
    expect(at(49_000)).toBe(0);
    expect(at(60_000)).toBe(0);
    expect(
      peopleNamesAllowance({ batch: 50, budget: null, bulkPercent: 70, requestsToday: 9 }),
    ).toBe(50);
  });
});

class FakeStore implements PersonNamesStore {
  due: ShortNamedPerson[] = [];
  asked: string[] = [];
  answers: Array<{ person: ShortNamedPerson; answer: PersonNameAnswer }> = [];
  limit = -1;

  peopleNamesDue(_p: string, _a: string, _m: number, limit: number): Promise<ShortNamedPerson[]> {
    this.limit = limit;
    return Promise.resolve(this.due.slice(0, limit));
  }
  markPersonNameAsked(_p: string, personId: string): Promise<void> {
    this.asked.push(personId);
    return Promise.resolve();
  }
  recordPersonNameAnswer(
    _p: string,
    person: ShortNamedPerson,
    answer: PersonNameAnswer,
  ): Promise<PersonNameOutcome> {
    this.answers.push({ person, answer });
    return Promise.resolve(answer.outcome);
  }
}

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

const person = (n: number, storedName = 'M. Salah'): ShortNamedPerson => ({
  personId: `p${n}`,
  externalId: `${n}`,
  storedName,
});

const ok = (
  data: NormalisedPersonProfile | null,
): AdapterResult<NormalisedPersonProfile | null> => ({
  ok: true,
  data,
  requests: 1,
  fetchedAt: '2026-10-12T00:00:00Z',
});

const base = {
  provider: 'api_football' as const,
  now: new Date('2026-10-12T10:00:00Z'),
  batch: 50,
  budget: 70_000,
  bulkPercent: 70,
  requestsToday: 1_000,
};

describe('the people names sweep', () => {
  it('asks each due person once and records what it did', async () => {
    const store = new FakeStore();
    store.due = [person(1), person(2), person(3)];
    const sweep = await sweepPeopleNames({
      ...base,
      store,
      adapter: adapterAnswering((id) =>
        id === '1'
          ? ok(profile('Mohamed', 'Salah Hamed Mahrous Ghaly'))
          : id === '2'
            ? ok(profile('Mohamed', 'Elneny'))
            : ok(null),
      ),
    });
    expect(sweep).toMatchObject({ asked: 3, answered: 3, written: 1, refused: [] });
    expect(sweep.kept).toEqual({ family_name_differs: 1, no_profile: 1 });
    expect(store.answers.map((a) => a.answer.outcome)).toEqual([
      'written',
      'family_name_differs',
      'no_profile',
    ]);
    expect(store.limit).toBe(50);
  });

  it('records a failed ask for a later retry, and stops at a quota refusal', async () => {
    const store = new FakeStore();
    store.due = [person(1), person(2), person(3)];
    const calls: string[] = [];
    const sweep = await sweepPeopleNames({
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
    expect(store.asked).toEqual(['p1', 'p2']);
    expect(store.answers).toEqual([]);
    expect(sweep.refused).toHaveLength(2);
    expect(sweep.asked).toBe(2);
  });

  it('asks nothing past the bulk share, with batch 0, or without profiles', async () => {
    const store = new FakeStore();
    store.due = [person(1)];
    const adapter = adapterAnswering(() => ok(null));
    expect(
      (await sweepPeopleNames({ ...base, store, adapter, requestsToday: 49_000 })).idle,
    ).toMatch(/70%/);
    expect((await sweepPeopleNames({ ...base, store, adapter, batch: 0 })).idle).toMatch(/=0/);
    expect(
      (await sweepPeopleNames({ ...base, store, adapter: {} as ProviderAdapter })).idle,
    ).toMatch(/no player profiles/);
    expect(store.answers).toEqual([]);
  });

  it('asks no more than the bulk share leaves', async () => {
    const store = new FakeStore();
    store.due = Array.from({ length: 50 }, (_, i) => person(i));
    await sweepPeopleNames({
      ...base,
      store,
      adapter: adapterAnswering(() => ok(null)),
      requestsToday: 48_990,
    });
    expect(store.limit).toBe(10);
    expect(store.answers).toHaveLength(10);
  });

  it('stops asking once the run has taken its time, so the live job is not held', async () => {
    const store = new FakeStore();
    store.due = [person(1), person(2), person(3)];
    let now = 0;
    const calls: string[] = [];
    const adapter = {
      getPersonProfile: (id: string) => {
        calls.push(id);
        now += 20_000;
        return Promise.resolve(ok(null));
      },
    } as unknown as ProviderAdapter;
    await sweepPeopleNames({ ...base, store, adapter, clock: () => now, runMs: 30_000 });
    expect(calls).toEqual(['1', '2']);
  });
});
