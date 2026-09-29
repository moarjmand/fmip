import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORY_TYPES } from '@fmip/contracts';
import { parseFeed } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import {
  type CategoryMapping,
  STORY_TYPE_MAPPING,
  feedHost,
  mappedType,
} from './story-type-mapping';

/**
 * The publisher-category mapping (T-1002, D-123): exact strings only, no
 * type for an ambiguous item, and every committed entry held to a recorded
 * item from its feed.
 */
const SPEC: readonly CategoryMapping[] = [
  { host: 'feeds.example.test', category: 'Transfers', type: 'transfer', recorded: 'spec-only' },
  { host: 'feeds.example.test', category: 'Opinion', type: 'opinion', recorded: 'spec-only' },
  { host: 'feeds.example.test', category: 'Comment', type: 'opinion', recorded: 'spec-only' },
  { host: 'other.example.test', category: 'Injuries', type: 'injury', recorded: 'spec-only' },
];
const FEED = 'https://feeds.example.test/football/rss';

describe('mappedType', () => {
  it('maps an exact string on the entry host, naming the category that gave the type', () => {
    expect(mappedType(FEED, ['Football', 'Transfers'], SPEC)).toEqual({
      type: 'transfer',
      category: 'Transfers',
    });
  });

  it('gives no type for anything that is not the exact string on the exact host', () => {
    expect(mappedType(FEED, ['transfers'], SPEC)).toBeNull();
    expect(mappedType(FEED, ['Transfers news'], SPEC)).toBeNull();
    expect(mappedType(FEED, ['Transfer'], SPEC)).toBeNull();
    expect(mappedType(FEED, ['Injuries'], SPEC)).toBeNull();
    expect(mappedType('https://www.feeds.example.test/rss', ['Transfers'], SPEC)).toBeNull();
    expect(mappedType(FEED, [], SPEC)).toBeNull();
    expect(mappedType('not a url', ['Transfers'], SPEC)).toBeNull();
  });

  it('gives no type when mapped categories name two types, and one when they agree', () => {
    expect(mappedType(FEED, ['Transfers', 'Opinion'], SPEC)).toBeNull();
    expect(mappedType(FEED, ['Comment', 'Opinion'], SPEC)).toEqual({
      type: 'opinion',
      category: 'Comment',
    });
  });

  it('reads the host as the URL parser does, case-insensitively and with a port', () => {
    expect(feedHost('https://FEEDS.example.test/rss')).toBe('feeds.example.test');
    expect(feedHost('https://feeds.example.test:8443/rss')).toBe('feeds.example.test:8443');
  });
});

describe('the committed mapping', () => {
  const RECORDED = join(__dirname, '..', '_recorded');

  it('names each (host, category) once, with a known type', () => {
    const keys = STORY_TYPE_MAPPING.map((m) => `${m.host}\u0000${m.category}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of STORY_TYPE_MAPPING) {
      expect(STORY_TYPES).toContain(m.type);
      expect(feedHost(`https://${m.host}/`)).toBe(m.host);
    }
  });

  it('holds every entry to a recorded item from its feed that carries the exact string', () => {
    for (const m of STORY_TYPE_MAPPING) {
      const file = join(RECORDED, m.recorded);
      expect(existsSync(file), `${m.host} "${m.category}" has no recording at ${file}`).toBe(true);
      const feed = parseFeed(readFileSync(file, 'utf8'));
      expect('items' in feed, `${m.recorded} is not a feed`).toBe(true);
      if (!('items' in feed)) continue;
      const carrying = feed.items.filter((i) => i.categories.includes(m.category));
      expect(carrying.length, `${m.recorded} carries no item with "${m.category}"`).toBeGreaterThan(
        0,
      );
    }
  });
});
