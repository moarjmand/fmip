import type { FeedItem, FeedSignal } from '@fmip/contracts';
import { FEED_SIGNALS } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import {
  KIND_KEY,
  REASON_KEY,
  SIGNAL_KEY,
  feedItemHref,
  feedItemKey,
  feedItemTitle,
  signalValue,
} from './feed';

const TEAMS = { home: { id: 'h', name: 'Liverpool' }, away: { id: 'a', name: 'Everton' } };
const BASE = { at: '2026-09-18T12:00:00Z', because: [] as FeedSignal[], rank: 0 };

const fixture: FeedItem = {
  ...BASE,
  kind: 'fixture',
  fixture_id: 'f1',
  kickoff_at: '2026-09-19T15:00:00Z',
  status: 'scheduled',
  competition: { id: 'c', name: 'Premier League' },
  ...TEAMS,
  score: null,
};
const story: FeedItem = {
  ...BASE,
  kind: 'story',
  story_id: 's1',
  headline: 'Liverpool name their side',
  language: 'en',
  published_at: null,
  source_name: 'Gazette',
  url: 'https://gazette.test/x',
};
const analysis: FeedItem = {
  ...BASE,
  kind: 'founder_analysis',
  fixture_id: 'f1',
  published_at: '2026-09-18T09:00:00Z',
  predicted_outcome: 'home',
  confidence: 3,
  ...TEAMS,
};
const post: FeedItem = {
  ...BASE,
  kind: 'panel_post',
  post_id: 'p1',
  fixture_id: 'f1',
  author: { username: 'ana', display_name: 'Ana' },
  excerpt: 'Cagey first half.',
  created_at: '2026-09-18T11:00:00Z',
  ...TEAMS,
};

describe("the feed page's helpers", () => {
  it('sends each item to the thing it is about, by id', () => {
    expect(feedItemHref('en', fixture)).toBe('/en/match/f1');
    expect(feedItemHref('ar', story)).toBe('/ar/news/story/s1');
    expect(feedItemHref('en', analysis)).toBe('/en/match/f1');
    expect(feedItemHref('en', post)).toBe('/en/match/f1');
  });

  it('names an item and keys it apart from another kind about the same match', () => {
    expect(feedItemTitle(fixture)).toBe('Liverpool – Everton');
    expect(feedItemTitle(story)).toBe('Liverpool name their side');
    expect(feedItemTitle(post)).toBe('Ana on Liverpool – Everton');
    expect(new Set([fixture, story, analysis, post].map(feedItemKey)).size).toBe(4);
  });

  it('has a sentence for every kind, every signal and every reason, from the contract', () => {
    for (const key of Object.values(KIND_KEY)) expect(EN[key]).toBeDefined();
    for (const signal of FEED_SIGNALS) expect(EN[SIGNAL_KEY[signal]], signal).toBeDefined();
    for (const key of Object.values(REASON_KEY)) expect(EN[key]).toBeDefined();
    // No signal for views: the ranking rule has none, and the page cannot invent one.
    expect(FEED_SIGNALS).not.toContain('views');
  });

  it('shows the followed name beside a follow or a favourite, and nothing beside a bare fact', () => {
    expect(
      signalValue({ kind: 'follows', entity_type: 'team', entity_id: 'h', name: 'Liverpool' }),
    ).toBe('Liverpool');
    expect(signalValue({ kind: 'favourite', name: 'Liverpool' })).toBe('Liverpool');
    expect(signalValue({ kind: 'live' })).toBeNull();
    expect(signalValue({ kind: 'discussed', participants: 3, window_hours: 48 })).toBeNull();
  });
});
