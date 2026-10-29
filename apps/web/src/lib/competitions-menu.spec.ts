import {
  type CompetitionDirectoryEntry,
  NO_MEDIA,
  type ScoreCard,
  type ScoresGroup,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  MENU_COLUMNS,
  MENU_REGIONS,
  confederationOf,
  menuCounts,
  menuGroups,
  menuRegion,
  menuStatus,
  menuStatusText,
} from './competitions-menu';
import { rowShown } from '@/components/competitions-menu-panel';
import { foldName } from './fold-name';

/**
 * The competitions menu's rules (T-1643, D-301): which group each
 * competition is filed under, its order there, its status, and what the
 * filter and the toggles keep.
 */

const NOW = Date.parse('2026-10-29T12:00:00.000Z');
const ZONE = 'Europe/London';

function country(code: string, name = code) {
  return { id: `country-${code}`, name, code };
}

function entry(
  id: string,
  over: Partial<CompetitionDirectoryEntry> = {},
): CompetitionDirectoryEntry {
  return {
    id,
    name: id,
    short_name: null,
    scope: 'domestic',
    kind: 'league',
    country: null,
    order: null,
    logo: NO_MEDIA,
    season: null,
    next_kickoff_at: null,
    ...over,
  };
}

function card(over: Partial<ScoreCard>): ScoreCard {
  return {
    id: 'f',
    kickoff_at: '2026-10-29T19:00:00.000Z',
    status: 'scheduled',
    minute: null,
    competition: { id: 'c', name: 'C', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'H', short_name: null, code: 'HHH' },
    away: { id: 'a', name: 'A', short_name: null, code: 'AAA' },
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
    last_updated_at: '2026-10-29T11:59:50.000Z',
    freshness: null,
    pinned: false,
    ...over,
  };
}

function today(...fixtures: Partial<ScoreCard>[]): ScoresGroup {
  return {
    country: null,
    competition: { id: 'c', name: 'C', short_name: null },
    fixtures: fixtures.map(card),
  };
}

describe('menuRegion', () => {
  it('files national teams together, whatever the continent', () => {
    expect(menuRegion(entry('wc', { scope: 'international', kind: 'cup' }), false)).toBe(
      'national',
    );
    expect(
      menuRegion(
        entry('asian-cup', { scope: 'international', kind: 'cup', confederation: 'afc' }),
        false,
      ),
    ).toBe('national');
  });

  it('files a domestic cup or super cup with the domestic cups, from any country', () => {
    expect(menuRegion(entry('fa', { kind: 'cup', country: country('ENG') }), false)).toBe('cups');
    expect(menuRegion(entry('hazfi', { kind: 'cup', country: country('IRN') }), false)).toBe(
      'cups',
    );
    expect(menuRegion(entry('shield', { kind: 'super_cup', country: country('ENG') }), true)).toBe(
      'cups',
    );
  });

  it('files a big-five country’s first league with the big five, and its others with Europe', () => {
    expect(menuRegion(entry('pl', { country: country('ENG') }), true)).toBe('big-five');
    expect(menuRegion(entry('champ', { country: country('ENG') }), false)).toBe('europe');
    expect(menuRegion(entry('ere', { country: country('NED') }), true)).toBe('europe');
  });

  it('files a continental competition by its confederation, UEFA’s as the European cups', () => {
    const cont = (confederation: CompetitionDirectoryEntry['confederation']) =>
      entry('x', { scope: 'continental', kind: 'cup', confederation });
    expect(menuRegion(cont('uefa'), false)).toBe('european-cups');
    expect(menuRegion(cont('afc'), false)).toBe('asia');
    expect(menuRegion(cont('conmebol'), false)).toBe('americas');
    expect(menuRegion(cont('concacaf'), false)).toBe('americas');
    expect(menuRegion(cont('caf'), false)).toBe('africa');
    expect(menuRegion(cont('ofc'), false)).toBe('oceania');
    // Nothing the data says: filed apart, never guessed (rule 3).
    expect(menuRegion(cont(null), false)).toBe('other');
    expect(menuRegion(entry('y', { scope: 'continental', kind: 'cup' }), false)).toBe('other');
  });

  it('files the other domestic leagues by their country’s confederation', () => {
    expect(menuRegion(entry('pgpl', { country: country('IRN') }), false)).toBe('asia');
    expect(menuRegion(entry('spl', { country: country('KSA') }), false)).toBe('asia');
    expect(menuRegion(entry('mls', { country: country('USA') }), false)).toBe('americas');
    expect(menuRegion(entry('bra', { country: country('BRA') }), false)).toBe('americas');
    expect(menuRegion(entry('egy', { country: country('EGY') }), false)).toBe('africa');
    expect(menuRegion(entry('spfl', { country: country('SCO') }), false)).toBe('europe');
    expect(menuRegion(entry('zz', { country: country('ZZZ') }), false)).toBe('other');
  });
});

describe('confederationOf', () => {
  it('takes the API’s word, and for an older answer a domestic one’s country', () => {
    expect(confederationOf(entry('a', { country: country('ENG'), confederation: 'afc' }))).toBe(
      'afc',
    );
    expect(confederationOf(entry('b', { country: country('ENG') }))).toBe('uefa');
    expect(confederationOf(entry('c', { scope: 'continental', kind: 'cup' }))).toBeNull();
  });
});

describe('menuGroups', () => {
  const list = [
    entry('Championship', { country: country('ENG'), order: 10 }),
    entry('Premier League', { country: country('ENG'), order: 1 }),
    entry('UEFA Champions League', {
      scope: 'continental',
      kind: 'cup',
      order: 2,
      confederation: 'uefa',
    }),
    entry('LaLiga', { country: country('ESP'), order: 3 }),
    entry('Pro League', { country: country('IRN'), order: 9 }),
    entry('FA Cup', { kind: 'cup', country: country('ENG') }),
    entry('Eredivisie', { country: country('NED'), order: 11 }),
    entry('Bundesliga', { country: country('GER'), order: 5 }),
    entry('Friendlies', { scope: 'international', kind: 'friendly' }),
    entry('Allsvenskan', { country: country('SWE') }),
    entry('Mystery Cup', { scope: 'continental', kind: 'cup', confederation: null }),
  ];
  const groups = menuGroups(list, 'en');
  const of = (region: string) =>
    groups.find((g) => g.region === region)?.competitions.map((c) => c.id);

  it('lists the groups in reading order, none empty', () => {
    expect(groups.map((g) => g.region)).toEqual([
      'big-five',
      'european-cups',
      'europe',
      'cups',
      'national',
      'asia',
      'other',
    ]);
  });

  it('keeps the product’s order inside a group, then the name', () => {
    expect(of('big-five')).toEqual(['Premier League', 'LaLiga', 'Bundesliga']);
    expect(of('europe')).toEqual(['Championship', 'Eredivisie', 'Allsvenskan']);
    expect(of('european-cups')).toEqual(['UEFA Champions League']);
    expect(of('cups')).toEqual(['FA Cup']);
    expect(of('national')).toEqual(['Friendlies']);
    expect(of('asia')).toEqual(['Pro League']);
    expect(of('other')).toEqual(['Mystery Cup']);
  });

  it('places every competition exactly once', () => {
    expect(groups.flatMap((g) => g.competitions)).toHaveLength(list.length);
  });

  it('lays the columns out as the approved canvas does, each region once', () => {
    expect(MENU_COLUMNS.flat().sort()).toEqual([...MENU_REGIONS].sort());
    expect(MENU_COLUMNS[0]).toEqual(['big-five', 'european-cups']);
    expect(MENU_COLUMNS[1]).toEqual(['europe']);
    expect(MENU_COLUMNS[2]).toEqual(['cups', 'national']);
  });
});

describe('menuStatus', () => {
  it('is the rail’s when a match is live or still to come today', () => {
    expect(menuStatus(today({ status: 'live' }, { status: 'live' }, {}), null, NOW, ZONE)).toEqual({
      kind: 'live',
      count: 2,
    });
    expect(menuStatus(today({ status: 'finished' }, {}), null, NOW, ZONE)).toEqual({
      kind: 'later',
      at: '2026-10-29T19:00:00.000Z',
    });
  });

  it('marks a league whose matches today are all over, with its next match day', () => {
    expect(
      menuStatus(
        today({ status: 'finished', kickoff_at: '2026-10-29T10:00:00.000Z' }),
        '2026-10-31T15:00:00.000Z',
        NOW,
        ZONE,
      ),
    ).toEqual({
      kind: 'finished',
      next: { kind: 'day', at: '2026-10-31T15:00:00.000Z', days: 2 },
    });
    expect(
      menuStatus(today({ status: 'finished' }, { status: 'postponed' }), null, NOW, ZONE),
    ).toEqual({ kind: 'finished', next: null });
  });

  it('is no FT for a day whose matches were all called off, or one suspended', () => {
    expect(
      menuStatus(today({ status: 'postponed' }), '2026-11-01T15:00:00.000Z', NOW, ZONE),
    ).toEqual({ kind: 'day', at: '2026-11-01T15:00:00.000Z', days: 3 });
    expect(menuStatus(today({ status: 'suspended' }), null, NOW, ZONE)).toEqual({ kind: 'none' });
  });

  it('is the next match day with nothing today, and nothing when none is known', () => {
    expect(menuStatus(null, '2026-11-12T15:00:00.000Z', NOW, ZONE)).toEqual({
      kind: 'day',
      at: '2026-11-12T15:00:00.000Z',
      days: 14,
    });
    expect(menuStatus(null, null, NOW, ZONE)).toEqual({ kind: 'none' });
  });
});

describe('menuStatusText', () => {
  const words = { live: (n: number) => `${n} live`, finished: 'FT' };
  it('says the rail’s words, and FT with the next match day', () => {
    expect(menuStatusText({ kind: 'live', count: 2 }, 'en', ZONE, NOW, words)).toEqual({
      text: '2 live',
      next: null,
    });
    expect(
      menuStatusText({ kind: 'later', at: '2026-10-29T19:00:00.000Z' }, 'en', ZONE, NOW, words),
    ).toEqual({ text: '19:00', next: null });
    expect(
      menuStatusText(
        { kind: 'finished', next: { kind: 'day', at: '2026-10-31T15:00:00.000Z', days: 2 } },
        'en',
        ZONE,
        NOW,
        words,
      ),
    ).toEqual({ text: 'FT', next: 'Sat' });
    expect(menuStatusText({ kind: 'none' }, 'en', ZONE, NOW, words)).toBeNull();
  });

  it('writes Persian digits and days on /fa', () => {
    expect(
      menuStatusText(
        { kind: 'later', at: '2026-10-29T19:00:00.000Z' },
        'fa',
        'Asia/Tehran',
        NOW,
        words,
      )?.text,
    ).toBe('۲۲:۳۰');
  });
});

describe('menuCounts', () => {
  it('counts the live, today’s and every competition', () => {
    expect(
      menuCounts([
        { live: true, today: true },
        { live: false, today: true },
        { live: false, today: false },
      ]),
    ).toEqual({ live: 1, today: 2, all: 3 });
  });
});

describe('rowShown', () => {
  const row = (name: string, live = false, isToday = false) => ({
    fold: foldName(name),
    live,
    today: isToday,
  });
  it('keeps a row holding every word typed, in any order, case and letters aside', () => {
    expect(rowShown(row('Premier League England Big five'), 'league prem', 'all')).toBe(true);
    expect(rowShown(row('Premier League England'), 'LIGA', 'all')).toBe(false);
    expect(rowShown(row('لیگ برتر خلیج فارس ایران'), 'ليگ', 'all')).toBe(true);
    expect(rowShown(row('Atlético'), 'atletico', 'all')).toBe(true);
    expect(rowShown(row('anything'), '   ', 'all')).toBe(true);
  });

  it('keeps today’s or the live ones by the toggles, with the filter', () => {
    expect(rowShown(row('A', true, true), '', 'live')).toBe(true);
    expect(rowShown(row('A', false, true), '', 'live')).toBe(false);
    expect(rowShown(row('A', false, true), '', 'today')).toBe(true);
    expect(rowShown(row('A', false, false), '', 'today')).toBe(false);
    expect(rowShown(row('Alpha', true, true), 'beta', 'live')).toBe(false);
  });
});
