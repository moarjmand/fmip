import type { CompetitionDirectoryEntry } from '@fmip/contracts';
import { NO_MEDIA } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  BAR_COMPETITIONS,
  barCompetitions,
  barName,
  chosenGroup,
  directoryGroups,
  directoryHref,
  directoryView,
  groupSlug,
  foldName,
  matchesFilter,
} from './competitions-directory';

/**
 * The competitions directory's choices (T-1433): the bar's slice of the
 * product's order, the page's groups, and the filter.
 */

function entry(
  id: string,
  name: string,
  over: Partial<CompetitionDirectoryEntry> = {},
): CompetitionDirectoryEntry {
  return {
    id,
    name,
    short_name: null,
    scope: 'domestic',
    kind: 'league',
    country: null,
    order: null,
    logo: NO_MEDIA,
    season: null,
    ...over,
  };
}

const IRAN = { id: 'irn', name: 'ایران', code: 'IRN' };
const ENGLAND = { id: 'eng', name: 'انگلیس', code: 'ENG' };
const SPAIN = { id: 'esp', name: 'اسپانیا', code: 'ESP' };
const BRAZIL = { id: 'bra', name: 'برزیل', code: 'BRA' };
const ARGENTINA = { id: 'arg', name: 'آرژانتین', code: 'ARG' };

// The product's order on /fa: the Pro League first, then the cups and the big leagues.
const LIST: CompetitionDirectoryEntry[] = [
  entry('pgpl', 'لیگ برتر خلیج فارس', { country: IRAN, order: 1 }),
  entry('hazfi', 'جام حذفی', { country: IRAN, order: 2, kind: 'cup' }),
  entry('ucl', 'لیگ قهرمانان اروپا', { scope: 'continental', order: 3, kind: 'cup' }),
  entry('epl', 'لیگ برتر انگلیس', { country: ENGLAND, order: 4, short_name: 'EPL' }),
  entry('wc', 'جام جهانی', { scope: 'international', order: 5, kind: 'cup' }),
  entry('liga', 'لالیگا', { country: SPAIN, order: 6 }),
  entry('fa-cup', 'جام حذفی انگلیس', { country: ENGLAND, order: 7, kind: 'cup' }),
  entry('lib', 'کوپا لیبرتادورس', { scope: 'continental', kind: 'cup' }),
  entry('bra', 'سری آ برزیل', { country: BRAZIL }),
  entry('arg', 'لیگا پروفسیونال', { country: ARGENTINA }),
];

describe('the bar', () => {
  it('names the first competitions of the product order, in that order', () => {
    expect(barCompetitions(LIST, 3).map((c) => c.id)).toEqual(['pgpl', 'hazfi', 'ucl']);
    expect(barCompetitions(LIST)).toHaveLength(Math.min(LIST.length, BAR_COMPETITIONS));
  });

  it('prefers the short form a language has', () => {
    expect(barName({ name: 'Premier League', short_name: 'PL' })).toBe('PL');
    expect(barName({ name: 'لالیگا', short_name: null })).toBe('لالیگا');
  });
});

describe('the groups', () => {
  const groups = directoryGroups(LIST, 'fa');

  it('puts international, then continental, then each country', () => {
    expect(groups.map((g) => g.key)).toEqual([
      'international',
      'continental',
      'irn',
      'eng',
      'esp',
      'arg',
      'bra',
    ]);
    expect(groups[0]).toMatchObject({ kind: 'international', name: null });
    expect(groups[2]).toMatchObject({ kind: 'country', name: 'ایران' });
  });

  it("keeps the product's order inside a group", () => {
    expect(groups.find((g) => g.key === 'eng')?.competitions.map((c) => c.id)).toEqual([
      'epl',
      'fa-cup',
    ]);
    expect(groups.find((g) => g.key === 'continental')?.competitions.map((c) => c.id)).toEqual([
      'ucl',
      'lib',
    ]);
  });

  it("orders the countries with no placed competition by the reader's alphabet", () => {
    // «آرژانتین» before «برزیل» in Persian, though the API listed Brazil first.
    const tail = groups.slice(-2).map((g) => g.name);
    expect(tail).toEqual(['آرژانتین', 'برزیل']);
  });

  it('leaves out a region group with nothing in it, and loses no competition', () => {
    const domestic = directoryGroups(
      LIST.filter((c) => c.country !== null),
      'fa',
    );
    expect(domestic.map((g) => g.kind)).not.toContain('international');
    expect(domestic.map((g) => g.kind)).not.toContain('continental');
    expect(groups.flatMap((g) => g.competitions)).toHaveLength(LIST.length);
  });
});

describe('the filter', () => {
  it('folds case, accents and the Arabic letter forms', () => {
    expect(foldName('  Atlético  MADRID ')).toBe('atletico madrid');
    expect(foldName('ليگ برتر')).toBe(foldName('لیگ برتر'));
    expect(foldName('كوپا')).toBe(foldName('کوپا'));
    expect(foldName('جام‌حذفی')).toBe('جامحذفی');
  });

  it("matches a competition's name, short form or country, every word in any order", () => {
    const epl = LIST.find((c) => c.id === 'epl')!;
    expect(matchesFilter(epl, 'انگلیس', '')).toBe(true);
    expect(matchesFilter(epl, 'انگلیس', 'برتر')).toBe(true);
    expect(matchesFilter(epl, 'انگلیس', 'epl')).toBe(true);
    expect(matchesFilter(epl, 'انگلیس', 'انگلیس برتر')).toBe(true);
    expect(matchesFilter(epl, 'انگلیس', 'لالیگا')).toBe(false);
    // A region's heading counts: "continental" finds the continental cups.
    const ucl = LIST.find((c) => c.id === 'ucl')!;
    expect(matchesFilter(ucl, 'Continental', 'contin')).toBe(true);
  });
});

describe('the chooser (T-1612)', () => {
  const groups = directoryGroups(LIST, 'fa').map((g) => ({ ...g, heading: g.name ?? g.kind }));

  it("names a group in the address by its region or its country's code", () => {
    expect(groups.map(groupSlug)).toEqual([
      'international',
      'continental',
      'irn',
      'eng',
      'esp',
      'arg',
      'bra',
    ]);
    expect(groups.find((g) => g.key === 'eng')).toMatchObject({ code: 'ENG' });
    expect(groupSlug({ key: 'k1', kind: 'country', code: null })).toBe('k1');
  });

  it('reads the choice from the address, case aside, and nothing it does not know', () => {
    expect(chosenGroup(groups, 'ENG')).toBe('eng');
    expect(chosenGroup(groups, 'continental')).toBe('continental');
    expect(chosenGroup(groups, 'atlantis')).toBeNull();
    expect(chosenGroup(groups, '')).toBeNull();
    expect(chosenGroup(groups, undefined)).toBeNull();
  });

  it('builds the address of a choice and a filter', () => {
    expect(directoryHref('en', null, '')).toBe('/en/competitions');
    expect(directoryHref('en', 'eng', ' ')).toBe('/en/competitions?country=eng');
    expect(directoryHref('en', null, 'la liga')).toBe('/en/competitions?q=la+liga');
    expect(directoryHref('fa', 'esp', 'liga')).toBe('/fa/competitions?country=esp&q=liga');
  });

  it('shows the chosen group only, the filter inside it, and keeps its tile', () => {
    const all = directoryView(groups, null, '');
    expect(all.shown.map((g) => g.key)).toEqual(groups.map((g) => g.key));
    expect(all.tiles).toHaveLength(groups.length);

    const england = directoryView(groups, 'eng', '');
    expect(england.shown.map((g) => g.key)).toEqual(['eng']);
    expect(england.tiles).toHaveLength(groups.length);

    // A filter that matches only Spain: the tiles narrow to it and the choice.
    const liga = directoryView(groups, 'eng', 'لالیگا');
    expect(liga.shown).toEqual([]);
    expect(liga.tiles.map((g) => g.key)).toEqual(['eng', 'esp']);
    const spain = directoryView(groups, 'esp', 'لالیگا');
    expect(spain.shown.map((g) => g.competitions.map((c) => c.id))).toEqual([['liga']]);
  });

  it("carries the country's flag onto its group, and none onto a region", () => {
    const flag = { coverage: 'available' as const, url: '/api/media/flag/eng/abc123def456.svg' };
    const [region, country] = directoryGroups(
      [
        entry('wc', 'World Cup', { scope: 'international' }),
        entry('epl', 'Premier League', { country: { ...ENGLAND, flag } }),
      ],
      'en',
    );
    expect(country?.flag).toEqual(flag);
    expect(region).not.toHaveProperty('flag');
  });
});
