import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANES, RECORD_SURFACES, routeOf, TILE_GROUPS, tileHref } from './about-content';

const LOCALE_ROUTES = join(__dirname, '..');

describe("the About page's diagram (T-1615)", () => {
  it('runs the three prediction products in lanes of their own, in the order every page shows them', () => {
    expect(LANES.map((lane) => lane.product)).toEqual(['model', 'founder', 'community']);
  });

  it('ends every lane at a record of its own: nothing is shared, so nothing is blended (rule 6)', () => {
    const outcomes = LANES.map((lane) => lane.outcome.name);
    expect(new Set(outcomes).size).toBe(LANES.length);
    const words = LANES.flatMap((lane) => [
      lane.name,
      lane.body,
      lane.outcome.name,
      lane.outcome.body,
    ]);
    expect(new Set(words).size).toBe(words.length);
  });

  it('feeds every surface the match record serves, once each', () => {
    expect(RECORD_SURFACES).toHaveLength(5);
    expect(new Set(RECORD_SURFACES).size).toBe(RECORD_SURFACES.length);
  });
});

describe('"Find your way" (T-1615)', () => {
  const tiles = TILE_GROUPS.flatMap((group) => group.tiles);

  it('has the main sections, each once', () => {
    expect(tiles.map((tile) => tile.id)).toEqual([
      'matches',
      'centre',
      'competitions',
      'news',
      'highlights',
      'watch',
      'model',
      'analysis',
      'predictions',
      'leaderboard',
    ]);
  });

  it.each(tiles.map((tile) => [tile.id, tile.path] as const))(
    '%s leads to a page that exists (%s)',
    (_, path) => {
      expect(existsSync(join(LOCALE_ROUTES, routeOf(path), 'page.tsx'))).toBe(true);
    },
  );

  it('colours the football in the brand, and each forecast in its own product', () => {
    const football = TILE_GROUPS.find((group) => group.id === 'football');
    expect(football?.tiles.every((tile) => tile.tone === 'accent')).toBe(true);
    const forecasts = TILE_GROUPS.find((group) => group.id === 'forecasts');
    expect(forecasts?.tiles.map((tile) => [tile.id, tile.tone])).toEqual([
      ['model', 'model'],
      ['analysis', 'founder'],
      ['predictions', 'community'],
      ['leaderboard', 'community'],
    ]);
  });

  it('keeps a query and a fragment in the address, under the locale', () => {
    expect(tileHref('fa', '/scores?unpicked=1')).toBe('/fa/scores?unpicked=1');
    expect(tileHref('en', '/scores#analysis')).toBe('/en/scores#analysis');
    expect(routeOf('/scores#analysis')).toBe('scores');
    expect(routeOf('/scores?unpicked=1')).toBe('scores');
    expect(routeOf('/model-accuracy')).toBe('model-accuracy');
  });
});
