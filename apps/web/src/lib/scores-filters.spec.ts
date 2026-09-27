import type { ScoreCard, ScoresGroup, ScoresResponse } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  filterOptions,
  INTERNATIONAL,
  isFiltered,
  NO_FILTERS,
  readFilterSelection,
  withSelected,
} from './scores-filters';
import { pageHref, readScoresQuery } from './scores';

const ENGLAND = '00000000-0000-4000-8000-00000000e001';
const SPAIN = '00000000-0000-4000-8000-00000000e002';
const PL = '00000000-0000-4000-8000-0000000000c1';
const LALIGA = '00000000-0000-4000-8000-0000000000c2';
const UCL = '00000000-0000-4000-8000-0000000000c3';

type Comp = { id: string; name: string; country: { id: string; name: string } | null };
const PREMIER: Comp = { id: PL, name: 'Premier League', country: { id: ENGLAND, name: 'England' } };
const LIGA: Comp = { id: LALIGA, name: 'LaLiga', country: { id: SPAIN, name: 'Spain' } };
const CHAMPIONS: Comp = { id: UCL, name: 'Champions League', country: null };

const card = (id: string, comp: Comp, stageKind: string | null, pinned = false): ScoreCard => ({
  id,
  kickoff_at: '2026-09-26T14:00:00.000Z',
  status: 'scheduled',
  minute: null,
  competition: {
    id: comp.id,
    name: comp.name,
    short_name: null,
    country_id: comp.country?.id ?? null,
  },
  season: { id: 's', label: '2026/27' },
  stage: stageKind === null ? null : { id: `st-${stageKind}`, name: stageKind, kind: stageKind },
  round: null,
  leg: null,
  home: { id: `${id}h`, name: 'Home', short_name: null, code: null },
  away: { id: `${id}a`, name: 'Away', short_name: null, code: null },
  scores: {
    current: null,
    half_time: null,
    full_time: null,
    extra_time: null,
    penalties: null,
    aggregate: null,
  },
  red_cards: { home: 0, away: 0 },
  incidents: [],
  venue: null,
  coverage: 'available',
  last_updated_at: '2026-09-26T10:00:00.000Z',
  freshness: null,
  pinned,
});

const group = (comp: Comp, fixtures: ScoreCard[]): ScoresGroup => ({
  country: comp.country === null ? null : { ...comp.country, code: comp.country.name.slice(0, 3) },
  competition: { id: comp.id, name: comp.name, short_name: null },
  fixtures,
});

// A busy Saturday: a favourite LaLiga match pinned, then the stated order.
const DAY: ScoresResponse = {
  filters: {
    from: '2026-09-26',
    to: '2026-09-26',
    timezone: 'UTC',
    live: false,
    favourites: false,
    country_id: null,
    competition_id: null,
    stage_id: null,
    gender: null,
    age: null,
  },
  generated_at: '2026-09-26T12:00:00.000Z',
  total: 5,
  pinned: [card('p1', LIGA, 'league', true)],
  groups: [
    group(PREMIER, [card('f1', PREMIER, 'league'), card('f2', PREMIER, null)]),
    group(CHAMPIONS, [card('f3', CHAMPIONS, 'league'), card('f4', CHAMPIONS, 'knockout')]),
  ],
};

const ids = (res: ScoresResponse): string[] => [
  ...res.pinned.map((c) => c.id),
  ...res.groups.flatMap((g) => g.fixtures.map((c) => c.id)),
];

describe('readFilterSelection', () => {
  it('reads ids, the international value and stored stage kinds', () => {
    expect(
      readFilterSelection({ country: ENGLAND.toUpperCase(), competition: PL, stage: 'knockout' }),
    ).toEqual({ country: ENGLAND, competition: PL, stage: 'knockout' });
    expect(readFilterSelection({ country: 'intl' }).country).toBe(INTERNATIONAL);
  });

  it('ignores empty and impossible values rather than failing the page', () => {
    expect(readFilterSelection({ country: '', competition: '', stage: '' })).toEqual(NO_FILTERS);
    expect(readFilterSelection({ country: 'England', competition: '42', stage: 'final' })).toEqual(
      NO_FILTERS,
    );
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });
});

describe('applyFilters', () => {
  it('passes the day through untouched with no filter', () => {
    expect(applyFilters(DAY, NO_FILTERS)).toBe(DAY);
  });

  it('narrows by country, pinned cards included, and recounts', () => {
    const spain = applyFilters(DAY, { ...NO_FILTERS, country: SPAIN });
    expect(ids(spain)).toEqual(['p1']);
    expect(spain.total).toBe(1);
    expect(spain.groups).toEqual([]);

    const intl = applyFilters(DAY, { ...NO_FILTERS, country: INTERNATIONAL });
    expect(ids(intl)).toEqual(['f3', 'f4']);
    expect(intl.total).toBe(2);
  });

  it('narrows by competition and by stage kind across competitions', () => {
    expect(ids(applyFilters(DAY, { ...NO_FILTERS, competition: PL }))).toEqual(['f1', 'f2']);
    // A card with no stage never matches a stage filter: it is not guessed into one.
    expect(ids(applyFilters(DAY, { ...NO_FILTERS, stage: 'league' }))).toEqual(['p1', 'f1', 'f3']);
    expect(ids(applyFilters(DAY, { ...NO_FILTERS, stage: 'knockout' }))).toEqual(['f4']);
  });

  it('combines filters, and can leave nothing', () => {
    expect(
      ids(applyFilters(DAY, { country: INTERNATIONAL, competition: UCL, stage: 'knockout' })),
    ).toEqual(['f4']);
    const none = applyFilters(DAY, { ...NO_FILTERS, country: ENGLAND, stage: 'knockout' });
    expect(none.total).toBe(0);
    expect(none.pinned).toEqual([]);
    expect(none.groups).toEqual([]);
  });
});

describe('filterOptions', () => {
  it('offers only what the day holds', () => {
    const options = filterOptions(DAY);
    // Countries by name, international last. Spain is only in a pinned card,
    // which carries no country name, so it is not offered under an invented one.
    expect(options.countries).toEqual([
      { value: ENGLAND, label: 'England' },
      { value: INTERNATIONAL, label: 'International' },
    ]);
    // Competitions in the list's order: pinned first, then the stated order.
    expect(options.competitions.map((o) => o.value)).toEqual([LALIGA, PL, UCL]);
    expect(options.stages).toEqual([
      { value: 'league', label: 'League stage' },
      { value: 'knockout', label: 'Knockout' },
    ]);
  });

  it('offers nothing on an empty day, and no stage when no card has one', () => {
    expect(filterOptions({ ...DAY, total: 0, pinned: [], groups: [] })).toEqual({
      countries: [],
      competitions: [],
      stages: [],
    });
    const noStages = { ...DAY, pinned: [], groups: [group(PREMIER, [card('f2', PREMIER, null)])] };
    expect(filterOptions(noStages).stages).toEqual([]);
  });

  it('keeps a selection the day does not hold visible', () => {
    const list = [{ value: ENGLAND, label: 'England' }];
    expect(withSelected(list, ENGLAND)).toBe(list);
    expect(withSelected(list, null)).toBe(list);
    expect(withSelected(list, SPAIN)).toEqual([
      ...list,
      { value: SPAIN, label: 'Not on this day' },
    ]);
  });
});

describe('filters in the address', () => {
  const NOW = new Date('2026-09-26T12:00:00Z');

  it('are read with the rest of the page state and kept in every link', () => {
    const q = readScoresQuery(
      { date: '2026-09-27', country: INTERNATIONAL, stage: 'knockout' },
      null,
      NOW,
    );
    expect(q.filters).toEqual({ country: INTERNATIONAL, competition: null, stage: 'knockout' });
    expect(pageHref('en', q, { live: true })).toBe(
      '/en/scores?date=2026-09-27&live=1&country=intl&stage=knockout',
    );
    expect(pageHref('en', q, { filters: NO_FILTERS })).toBe('/en/scores?date=2026-09-27');
  });
});
