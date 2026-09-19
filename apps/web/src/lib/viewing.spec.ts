import type { Highlight, MatchViewing, ViewingOption } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  carriedTerritory,
  embeddable,
  highlightsState,
  optionsState,
  readTerritoryQuery,
  serviceNames,
  watchHref,
  withTerritory,
} from './viewing';

const desk = { id: 'src', name: 'Editorial desk', rights: 'link' as const };
const chosen = { state: 'chosen' as const, territory: { code: 'IR', name: 'Iran' } };
const none = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const empty = { coverage: 'available' as const, last_updated_at: '2026-09-18T10:00:00Z', data: [] };

const option: ViewingOption = {
  id: 'o1',
  broadcaster: { id: 'b1', name: 'IRIB Varzesh', homepage_url: null, kind: 'tv' },
  access: 'free',
  url: 'https://varzesh.test/live',
  territory: 'IR',
  source: desk,
  last_updated_at: '2026-09-18T10:00:00Z',
};

const page: Highlight = {
  id: 'h1',
  kind: 'official_page',
  url: 'https://official.test/h',
  embed_url: null,
  thumbnail_url: null,
  territory: 'IR',
  source: desk,
  last_updated_at: '2026-09-18T10:00:00Z',
};

function viewing(over: Partial<MatchViewing>): MatchViewing {
  return { fixture_id: 'f', territory: chosen, options: none, highlights: none, ...over };
}

describe('readTerritoryQuery', () => {
  it('takes a code in any case and drops anything that is not one, rather than sending it on', () => {
    expect(readTerritoryQuery({ territory: 'ir' })).toBe('IR');
    expect(readTerritoryQuery({ territory: ['GB', 'IE'] })).toBe('GB');
    expect(readTerritoryQuery({})).toBeUndefined();
    expect(readTerritoryQuery({ territory: 'Iran' })).toBeUndefined();
    expect(readTerritoryQuery({ territory: '' })).toBeUndefined();
  });
});

describe('optionsState', () => {
  it('asks with no territory, says not_supplied with no coverage, and only then reads an empty list as a fact', () => {
    expect(optionsState(viewing({ territory: { state: 'not_chosen' } }))).toBe('ask');
    expect(optionsState(viewing({}))).toBe('not_supplied');
    expect(optionsState(viewing({ options: empty }))).toBe('nothing_listed');
    expect(optionsState(viewing({ options: { ...empty, data: [option] } }))).toBe('listed');
  });
});

describe('highlightsState and embeddable', () => {
  it('is a page from a link-only source and a player only from a source that grants one', () => {
    expect(highlightsState(viewing({}))).toBe('not_supplied');
    expect(highlightsState(viewing({ highlights: empty }))).toBe('none');
    expect(highlightsState(viewing({ highlights: { ...empty, data: [page] } }))).toBe('page');
    const player: Highlight = {
      ...page,
      kind: 'embed',
      embed_url: 'https://player.test/1',
      source: { ...desk, rights: 'embed' },
    };
    expect(highlightsState(viewing({ highlights: { ...empty, data: [player] } }))).toBe('embed');
    // A row that claims an embed under a source that grants less is rendered as the page.
    expect(embeddable({ ...player, source: desk })).toBe(false);
    expect(embeddable({ ...player, embed_url: null })).toBe(false);
  });
});

describe('links', () => {
  it("keeps a guest's territory on a link and never a member's, whose choice is stored", () => {
    expect(withTerritory('/en/match/f', 'IR')).toBe('/en/match/f?territory=IR');
    expect(withTerritory('/en/match/f?tz=UTC', 'IR')).toBe('/en/match/f?tz=UTC&territory=IR');
    expect(withTerritory('/en/match/f', undefined)).toBe('/en/match/f');
    expect(carriedTerritory(viewing({}), false)).toBe('IR');
    expect(carriedTerritory(viewing({}), true)).toBeUndefined();
    expect(
      carriedTerritory(viewing({ territory: { state: 'not_chosen' } }), false),
    ).toBeUndefined();
  });

  it('addresses the Watch page with the day, an explicit zone and the territory', () => {
    const q = {
      date: '2026-09-18',
      today: '2026-09-18',
      timezone: 'Asia/Tehran',
      explicitTimezone: false,
      live: false,
      favourites: false,
    };
    expect(watchHref('en', q, 'IR')).toBe('/en/watch?date=2026-09-18&territory=IR');
    expect(
      watchHref('en', { ...q, explicitTimezone: true }, undefined, { date: '2026-09-19' }),
    ).toBe('/en/watch?date=2026-09-19&tz=Asia%2FTehran');
  });
});

describe('serviceNames', () => {
  it('names the services in the order given', () => {
    expect(
      serviceNames([
        option,
        { ...option, id: 'o2', broadcaster: { ...option.broadcaster, name: 'Sky' } },
      ]),
    ).toBe('IRIB Varzesh, Sky');
  });
});
