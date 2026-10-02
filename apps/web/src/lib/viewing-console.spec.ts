import { VIEWING_BULK_MAX, type ViewingOption, type ViewingUpcomingFixture } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  bulkOutcome,
  bulkRequestFrom,
  consoleTime,
  coverageLabel,
  defaultOutcome,
  isCovered,
  listingBadge,
  matchContext,
  matchLabel,
  preChecked,
  readConsoleQuery,
} from './viewing-console';

const option: ViewingOption = {
  id: 'o1',
  broadcaster: { id: 'b1', name: 'IRIB Varzesh', homepage_url: null, kind: 'tv' },
  access: 'free',
  url: 'https://varzesh.test/live',
  territory: 'IR',
  source: { id: 'src', name: 'Editorial desk', rights: 'link' },
  from_default: false,
  last_updated_at: '2026-10-01T10:00:00Z',
};

function fixture(overrides: Partial<ViewingUpcomingFixture> = {}): ViewingUpcomingFixture {
  return {
    id: 'f1',
    kickoff_at: '2026-10-03T16:30:00.000Z',
    status: 'scheduled',
    season_id: 's1',
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'Esteghlal' },
    away: { id: 'a', name: 'Persepolis' },
    covered: true,
    options: [],
    ...overrides,
  };
}

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe('readConsoleQuery (T-1361)', () => {
  it('defaults to IR and seven days, and drops what is not a code or a day count', () => {
    expect(readConsoleQuery({})).toEqual({ territory: 'IR', competition: null, days: 7 });
    expect(readConsoleQuery({ territory: 'Iran', competition: '<x>', days: '30' })).toEqual({
      territory: 'IR',
      competition: null,
      days: 7,
    });
    expect(readConsoleQuery({ territory: 'de', competition: 'c-1', days: '14' })).toEqual({
      territory: 'DE',
      competition: 'c-1',
      days: 14,
    });
    expect(readConsoleQuery({ territory: ['gb', 'fr'], days: '1.5' })).toMatchObject({
      territory: 'GB',
      days: 7,
    });
  });
});

describe('which matches the bulk form ticks', () => {
  it('ticks a covered match with nothing listed, never an uncovered or an already listed one', () => {
    expect(preChecked(fixture())).toBe(true);
    expect(preChecked(fixture({ covered: false }))).toBe(false);
    expect(preChecked(fixture({ options: [option] }))).toBe(false);
  });
});

describe('bulkRequestFrom', () => {
  it('builds the request from the ticked boxes, each once, in the console territory', () => {
    const built = bulkRequestFrom(
      form([
        ['fixture_ids', 'f1'],
        ['fixture_ids', 'f2'],
        ['fixture_ids', 'f1'],
        ['broadcaster_id', 'b1'],
        ['access', 'subscription'],
        ['url', ' https://service.test/league '],
      ]),
      'IR',
    );
    expect(built).toEqual({
      ok: true,
      request: {
        territory: 'IR',
        broadcaster_id: 'b1',
        access: 'subscription',
        url: 'https://service.test/league',
        fixture_ids: ['f1', 'f2'],
      },
    });
  });

  it('names each missing field, and asks for a match when none is ticked', () => {
    expect(bulkRequestFrom(form([['fixture_ids', 'f1']]), 'IR')).toEqual({
      ok: false,
      message: 'Fill in every required field.',
      fields: { broadcaster_id: 'Required.', access: 'Required.', url: 'Required.' },
    });
    const none = bulkRequestFrom(
      form([
        ['broadcaster_id', 'b1'],
        ['access', 'free'],
        ['url', 'https://s.test'],
      ]),
      'IR',
    );
    expect(none).toEqual({ ok: false, message: 'Tick at least one match.' });
  });

  it('refuses more than the API takes at once, and an access it does not know', () => {
    const many: [string, string][] = Array.from({ length: VIEWING_BULK_MAX + 1 }, (_, i) => [
      'fixture_ids',
      `f${i}`,
    ]);
    const built = bulkRequestFrom(
      form([...many, ['broadcaster_id', 'b1'], ['access', 'free'], ['url', 'https://s.test']]),
      'IR',
    );
    expect(built.ok).toBe(false);
    const odd = bulkRequestFrom(
      form([
        ['fixture_ids', 'f1'],
        ['broadcaster_id', 'b1'],
        ['access', 'gratis'],
        ['url', 'https://s.test'],
      ]),
      'IR',
    );
    expect(odd).toMatchObject({ ok: false, fields: { access: 'Required.' } });
  });
});

describe('the console words', () => {
  it('marks a listing a default created, and only that one', () => {
    expect(listingBadge({ ...option, from_default: true })).toBe('default');
    expect(listingBadge(option)).toBeNull();
  });

  it('counts what a bulk listing and a default did', () => {
    expect(bulkOutcome(3, 0)).toBe('3 listings created.');
    expect(bulkOutcome(1, 1)).toBe(
      '1 listing created. 1 already listed on that service, left as it was.',
    );
    expect(defaultOutcome(0)).toBe('Default saved; 0 listings created.');
    expect(defaultOutcome(1)).toBe('Default saved; 1 listing created.');
  });

  it('says coverage as the API states it, and only covered or partly covered counts', () => {
    expect(coverageLabel(null)).toBe('nothing declared');
    expect(coverageLabel('not_supplied')).toBe('not covered');
    expect(isCovered('available')).toBe(true);
    expect(isCovered('limited')).toBe(true);
    expect(isCovered('not_supplied')).toBe(false);
    expect(isCovered(null)).toBe(false);
  });

  it('labels a match, a side not yet known, its stage, and its kickoff in UTC', () => {
    expect(matchLabel(fixture({ away: null }))).toBe('Esteghlal – To be decided');
    expect(
      matchContext(
        fixture({ stage: { id: 'st', name: 'Group A', kind: 'group' }, round: '3', leg: 2 }),
      ),
    ).toBe('Group A · 3 · leg 2');
    expect(matchContext(fixture())).toBe('');
    expect(consoleTime('2026-10-03T16:30:00.000Z')).toBe('2026-10-03 16:30 UTC');
  });
});
