import { NEWS_SECTIONS, type NewsEntity } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import {
  FRONT_CARDS,
  NEWS_STALE_AFTER_MS,
  REASON_KEY,
  RECENT_MS,
  SECTION_KEY,
  apiQuery,
  entityHref,
  feedsStale,
  frontPage,
  isFiltered,
  orderedEntities,
  panelMarks,
  recentAge,
  pageHref,
  readNewsQuery,
  VERSION_STATUS_KEY,
  readStoryQuery,
  storyHref,
  versionStatus,
} from './news';

const TEAM = '0e230000-0000-4000-8000-000000000001';

describe('readNewsQuery', () => {
  it('defaults to latest with no filters', () => {
    expect(readNewsQuery({})).toEqual({
      section: 'latest',
      country: null,
      competition: null,
      team: null,
      language: null,
      type: null,
      player: null,
      from: null,
      to: null,
      before: null,
    });
  });

  it('reads every filter, lower-casing ids and taking the first of a repeated parameter', () => {
    const q = readNewsQuery({
      section: ['trending', 'latest'],
      team: TEAM.toUpperCase(),
      language: 'pt-BR',
      before: '2026-09-18T00:00:00Z',
    });
    expect(q.section).toBe('trending');
    expect(q.team).toBe(TEAM);
    expect(q.language).toBe('pt-BR');
    expect(q.before).toBe('2026-09-18T00:00:00Z');
  });

  it('drops a malformed value rather than passing it on to be refused', () => {
    const q = readNewsQuery({
      section: 'opinion',
      team: 'arsenal',
      country: '',
      language: 'not a tag!',
      before: 'yesterday',
    });
    expect(q).toEqual({
      section: 'latest',
      country: null,
      competition: null,
      team: null,
      language: null,
      type: null,
      player: null,
      from: null,
      to: null,
      before: null,
    });
  });
});

describe('the type, player and date filters (T-1003, D-124)', () => {
  it('reads a known type, a player id and real calendar days, and drops anything else', () => {
    const q = readNewsQuery({
      type: 'transfer',
      player: TEAM.toUpperCase(),
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(q).toMatchObject({
      type: 'transfer',
      player: TEAM,
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(isFiltered(q)).toBe(true);
    expect(
      readNewsQuery({ type: 'gossip', player: 'salah', from: '2026-02-30x', to: '31/03/2026' }),
    ).toMatchObject({ type: null, player: null, from: null, to: null });
    expect(isFiltered(readNewsQuery({ before: '2026-09-18T00:00:00Z' }))).toBe(false);
  });

  it("sends the viewer's zone only with a date, and keeps the filters on the page's links", () => {
    const typed = readNewsQuery({ type: 'injury' });
    expect(apiQuery(typed, 'Asia/Tehran')).toBe('?section=latest&type=injury');
    const dated = readNewsQuery({ from: '2026-03-11', to: '2026-03-11' });
    expect(apiQuery(dated, 'Asia/Tehran')).toBe(
      `?section=latest&from=2026-03-11&to=2026-03-11&tz=${encodeURIComponent('Asia/Tehran')}`,
    );
    expect(pageHref('en', dated, { section: 'trending' })).toBe(
      '/en/news?section=trending&from=2026-03-11&to=2026-03-11',
    );
    expect(pageHref('en', readNewsQuery({ player: TEAM, type: 'opinion' }), { player: null })).toBe(
      '/en/news?type=opinion',
    );
  });
});

describe('apiQuery and pageHref', () => {
  const q = readNewsQuery({ section: 'following', team: TEAM, before: '2026-09-18T00:00:00Z' });

  it('sends the section and every set filter to the API', () => {
    expect(apiQuery(q)).toBe(
      `?section=following&team=${TEAM}&before=${encodeURIComponent('2026-09-18T00:00:00Z')}`,
    );
    expect(apiQuery(readNewsQuery({}))).toBe('?section=latest');
  });

  it('builds the page URL without the cursor unless asked, and without a default section', () => {
    expect(pageHref('ar', q)).toBe(`/ar/news?section=following&team=${TEAM}`);
    expect(pageHref('ar', q, { section: 'latest' })).toBe(`/ar/news?team=${TEAM}`);
    expect(pageHref('en', readNewsQuery({}))).toBe('/en/news');
    expect(pageHref('en', q, { before: '2026-09-01T00:00:00Z' })).toContain(
      `before=${encodeURIComponent('2026-09-01T00:00:00Z')}`,
    );
    expect(pageHref('en', q, { team: null })).toBe('/en/news?section=following');
  });
});

describe('the story page', () => {
  it('reads a language when one is asked for, and drops one that is not a tag', () => {
    expect(readStoryQuery({})).toEqual({ language: null });
    expect(readStoryQuery({ language: 'ar' })).toEqual({ language: 'ar' });
    expect(readStoryQuery({ language: 'not a tag!' })).toEqual({ language: null });
  });

  it('links a card to its story, in a language only when asked', () => {
    expect(storyHref('en', TEAM)).toBe(`/en/news/story/${TEAM}`);
    expect(storyHref('ar', TEAM, 'pt-BR')).toBe(`/ar/news/story/${TEAM}?language=pt-BR`);
  });
});

describe('versionStatus', () => {
  it('names whose words a version carries, and has a sentence for each', () => {
    expect(versionStatus({ origin: 'publisher', review_state: null })).toBe('publisher');
    expect(versionStatus({ origin: 'translation', review_state: 'translated' })).toBe('translated');
    expect(versionStatus({ origin: 'translation', review_state: 'reviewed' })).toBe('reviewed');
    for (const key of Object.values(VERSION_STATUS_KEY)) expect(EN[key]).toBeDefined();
  });
});

describe('entityHref', () => {
  it('sends each entity to its own page by id', () => {
    const entity = { entity_id: TEAM, name: 'x', localised_name: null } as const;
    expect(entityHref('en', { ...entity, entity_type: 'team' })).toBe(`/en/team/${TEAM}`);
    expect(entityHref('en', { ...entity, entity_type: 'competition' })).toBe(
      `/en/competition/${TEAM}`,
    );
    expect(entityHref('en', { ...entity, entity_type: 'person' })).toBe(`/en/player/${TEAM}`);
    expect(entityHref('en', { ...entity, entity_type: 'fixture' })).toBe(`/en/match/${TEAM}`);
  });
});

describe('feedsStale', () => {
  const now = new Date('2026-09-18T12:00:00Z');

  it('is stale when nothing was ever read, or the newest read is older than the threshold', () => {
    expect(feedsStale(null, now)).toBe(true);
    expect(feedsStale(new Date(now.getTime() - NEWS_STALE_AFTER_MS - 1).toISOString(), now)).toBe(
      true,
    );
    expect(feedsStale(new Date(now.getTime() - 60_000).toISOString(), now)).toBe(false);
  });
});

describe('the catalogue', () => {
  it('has a sentence for every section and every reason the API can give', () => {
    for (const section of NEWS_SECTIONS) expect(EN[SECTION_KEY[section]]).toBeDefined();
    for (const key of Object.values(REASON_KEY)) expect(EN[key]).toBeDefined();
  });
});

describe('the front page (T-1613, D-284)', () => {
  const ten = Array.from({ length: 10 }, (_, i) => i);

  it("is the lead, a row of cards, then the list, in the section's own order", () => {
    const page = frontPage(ten, true);
    expect(page.lead).toBe(0);
    expect(page.cards).toEqual([1, 2, 3, 4]);
    expect(page.cards).toHaveLength(FRONT_CARDS);
    expect(page.rest).toEqual([5, 6, 7, 8, 9]);
  });

  it('takes what there is when a section is short', () => {
    expect(frontPage([7], true)).toEqual({ lead: 7, cards: [], rest: [] });
    expect(frontPage([7, 8], true)).toEqual({ lead: 7, cards: [8], rest: [] });
    expect(frontPage([], true)).toEqual({ lead: null, cards: [], rest: [] });
  });

  it('is the list alone on an older page', () => {
    expect(frontPage(ten, false)).toEqual({ lead: null, cards: [], rest: ten });
  });
});

describe("a story's tags and panel marks (T-1613, D-284)", () => {
  const crest = (id: string): NewsEntity['media'] => ({
    coverage: 'available',
    url: `/api/media/crest/${id}/abc.png`,
  });
  const none: NewsEntity['media'] = { coverage: 'not_supplied', url: null };
  const entity = (
    type: NewsEntity['entity_type'],
    id: string,
    media?: NewsEntity['media'],
  ): NewsEntity => ({
    entity_type: type,
    entity_id: id,
    name: type === 'fixture' ? null : id,
    localised_name: null,
    ...(media === undefined ? {} : { media }),
  });

  it('orders clubs, competition, people, then the match, keeping the API order within each', () => {
    const list = [
      entity('fixture', 'f'),
      entity('person', 'p'),
      entity('team', 't1'),
      entity('competition', 'c'),
      entity('team', 't2'),
    ];
    expect(orderedEntities(list).map((e) => e.entity_id)).toEqual(['t1', 't2', 'c', 'p', 'f']);
  });

  it("marks only what we hold an image of, clubs first, at most the panel's number", () => {
    const list = [
      entity('competition', 'c', { coverage: 'available', url: '/api/media/logo/c/abc.png' }),
      entity('team', 't1', crest('t1')),
      entity('team', 't2', none),
      entity('team', 't3', crest('t3')),
      entity('fixture', 'f'),
      entity('person', 'p'),
    ];
    expect(panelMarks(list, 3).map((e) => e.entity_id)).toEqual(['t1', 't3', 'c']);
    expect(panelMarks(list, 2).map((e) => e.entity_id)).toEqual(['t1', 't3']);
  });

  it('marks nothing it cannot draw from our own origin', () => {
    const list = [
      entity('team', 'a', none),
      entity('team', 'b'),
      entity('team', 'c', { coverage: 'available', url: 'https://media.example.org/x.png' }),
    ];
    expect(panelMarks(list, 3)).toEqual([]);
  });
});

describe('recentAge (T-1613)', () => {
  const now = new Date('2026-10-26T12:00:00Z');

  it('says how long ago under a day, and leaves the rest to the date', () => {
    expect(recentAge('2026-10-26T09:00:00Z', now)).toBe(3 * 60 * 60 * 1000);
    expect(recentAge(new Date(now.getTime() - RECENT_MS).toISOString(), now)).toBeNull();
    expect(recentAge('2026-10-20T09:00:00Z', now)).toBeNull();
  });

  it('reads a publisher a little ahead of the clock as now, and an unreadable time as none', () => {
    expect(recentAge('2026-10-26T12:05:00Z', now)).toBe(0);
    expect(recentAge('not a time', now)).toBeNull();
  });
});
