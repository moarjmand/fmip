import { NEWS_SECTIONS } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import {
  NEWS_STALE_AFTER_MS,
  REASON_KEY,
  SECTION_KEY,
  apiQuery,
  entityHref,
  feedsStale,
  pageHref,
  readNewsQuery,
  readStoryQuery,
  storyHref,
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
      before: null,
    });
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
