import {
  NEWS_CURSOR_MAX_WAITING,
  newsSourcesMixed,
  packId,
  readNewsCursor,
  unpackId,
  writeNewsCursor,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { SOURCE_MIX, mixSources } from './source-mix';

interface Row {
  id: string;
  source_id: string;
}

/** Rows newest first: `count` of each source in turn, named `<source><n>`. */
function rows(spec: readonly [string, number][]): Row[] {
  const out: Row[] = [];
  const n = new Map<string, number>();
  for (const [source, count] of spec) {
    for (let i = 0; i < count; i += 1) {
      const k = n.get(source) ?? 0;
      n.set(source, k + 1);
      out.push({ id: `${source}${k}`, source_id: source });
    }
  }
  return out;
}

/** Today's shape (D-411): forty from Yahoo, then five other sources in turn. */
function burst(): Row[] {
  const others = Array.from({ length: 12 }, () =>
    ['A', 'B', 'C', 'D', 'E'].map((s) => [s, 1] as [string, number]),
  ).flat();
  return rows([['Y', 40], ...others]);
}

/** A seeded stream: six sources, one of them heavy, in runs. */
function stream(length: number, seed: number): Row[] {
  let x = seed;
  const next = (): number => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
  const spec: [string, number][] = [];
  let total = 0;
  while (total < length) {
    const r = next();
    const source = r < 0.45 ? 'Y' : ['A', 'B', 'C', 'D', 'E'][Math.floor(next() * 5)]!;
    const count = Math.min(length - total, 1 + Math.floor(next() * (source === 'Y' ? 12 : 3)));
    spec.push([source, count]);
    total += count;
  }
  return rows(spec);
}

const ids = (list: readonly Row[]): string[] => list.map((r) => r.id);

function longestRun(list: readonly Row[]): number {
  let best = 0;
  let run = 0;
  list.forEach((r, i) => {
    run = i > 0 && list[i - 1]!.source_id === r.source_id ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

describe('mixSources (T-1816, D-411)', () => {
  it('breaks a forty-story run: never more than three in a row, no source above 30% of any top', () => {
    const top = mixSources(burst(), 40).cards;
    expect(top).toHaveLength(40);
    expect(longestRun(top)).toBeLessThanOrEqual(SOURCE_MIX.maxRun);
    for (let n = 1; n <= top.length; n += 1) {
      const counts = new Map<string, number>();
      for (const r of top.slice(0, n)) counts.set(r.source_id, (counts.get(r.source_id) ?? 0) + 1);
      for (const [source, count] of counts) {
        expect(count, `${source} in the first ${n}`).toBeLessThanOrEqual(Math.ceil(0.3 * n));
      }
    }
    expect(ids(top.slice(0, 6))).toEqual(['Y0', 'A0', 'B0', 'Y1', 'C0', 'D0']);
  });

  it('deletes nothing: the overflow moves down, and each source keeps its own order', () => {
    const input = burst();
    const all = mixSources(input, input.length).cards;
    expect([...ids(all)].sort()).toEqual([...ids(input)].sort());
    for (const source of ['Y', 'A', 'B', 'C', 'D', 'E']) {
      expect(ids(all.filter((r) => r.source_id === source))).toEqual(
        ids(input.filter((r) => r.source_id === source)),
      );
    }
    // Once the others are all placed, what is left of Yahoo follows in order.
    expect(ids(all.slice(-5))).toEqual(['Y35', 'Y36', 'Y37', 'Y38', 'Y39']);
  });

  it('reaches only so far: a burst longer than the reach still leads the list', () => {
    const input = rows([
      ['Y', SOURCE_MIX.lookahead + 5],
      ['A', 3],
      ['B', 3],
    ]);
    // Nothing else within reach for six places: Yahoo takes them, past three
    // in a row, rather than leave a place empty; then the others come within it.
    expect(ids(mixSources(input, 10).cards)).toEqual([
      'Y0',
      'Y1',
      'Y2',
      'Y3',
      'Y4',
      'Y5',
      'A0',
      'A1',
      'A2',
      'B0',
    ]);
  });

  it('keeps the plain order when no rule is broken, and one source alone as it came', () => {
    const mixed = rows([
      ['A', 1],
      ['B', 1],
      ['C', 1],
      ['D', 1],
      ['A', 1],
      ['B', 1],
      ['C', 1],
      ['D', 1],
    ]);
    expect(ids(mixSources(mixed, 8).cards)).toEqual(ids(mixed));
    const alone = rows([['Y', 10]]);
    expect(ids(mixSources(alone, 10).cards)).toEqual(ids(alone));
    expect(mixSources([], 10)).toEqual({ cards: [], run: null });
  });

  it('is deterministic: a shorter page begins the longer', () => {
    for (const seed of [1, 2, 3, 99, 2026]) {
      const input = stream(600, seed);
      const whole = mixSources(input, input.length).cards;
      for (const count of [1, 6, 40, 80, 160]) {
        expect(ids(mixSources(input, count).cards), `seed ${seed}`).toEqual(
          ids(whole.slice(0, count)),
        );
      }
    }
  });

  it('carries the run across a page’s end: never a fourth in a row', () => {
    const input = rows([
      ['Y', 4],
      ['A', 2],
    ]);
    // The page before ended with three from Y: Y waits for A.
    const next = mixSources(input, 3, { source: 'Y', length: 3 });
    expect(ids(next.cards)).toEqual(['A0', 'Y0', 'Y1']);
    expect(next.run).toEqual({ source: 'Y', length: 2 });
    // And says how the page ended, for the next.
    expect(mixSources(rows([['Y', 2]]), 2, { source: 'Y', length: 1 }).run).toEqual({
      source: 'Y',
      length: 3,
    });
  });
});

describe('newsSourcesMixed', () => {
  it('mixes for every reader but a Persian one, and not for an internal caller', () => {
    expect(newsSourcesMixed('en')).toBe(true);
    expect(newsSourcesMixed('en-GB')).toBe(true);
    expect(newsSourcesMixed('de')).toBe(true);
    expect(newsSourcesMixed('x-rtl')).toBe(true);
    expect(newsSourcesMixed('fa')).toBe(false);
    expect(newsSourcesMixed('fa-IR')).toBe(false);
    expect(newsSourcesMixed(null)).toBe(false);
  });
});

describe('the news cursor (NewsCursor)', () => {
  const STORY = '0b6f9c1e-3a52-4e0c-9d7a-1f2e3d4c5b6a';
  const SOURCE = '00000000-0000-4000-8000-000000000101';
  const OTHER = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

  it('packs an id in 22 URL-safe characters and back', () => {
    for (const id of [STORY, SOURCE, OTHER, '00000000-0000-0000-0000-000000000000']) {
      const packed = packId(id)!;
      expect(packed).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(unpackId(packed)).toBe(id);
    }
    expect(packId('not an id')).toBeNull();
    expect(unpackId('short')).toBeNull();
    // The last character carries four bits of padding, which must be zero.
    expect(unpackId(`${packId(STORY)!.slice(0, 21)}B`)).toBeNull();
  });

  it('reads a plain instant, and a mixed page’s boundary, run and waiting stories, and writes them back', () => {
    expect(readNewsCursor('2026-11-13T10:00:00Z')).toEqual({
      at: '2026-11-13T10:00:00.000Z',
      shown: null,
      run: null,
      waiting: [],
    });
    const cursor = {
      at: '2026-11-13T10:00:00.123Z',
      shown: STORY,
      run: { source: SOURCE, length: 3 },
      waiting: [OTHER, SOURCE],
    };
    const written = writeNewsCursor(cursor);
    expect(written).toMatch(
      /^2026-11-13T10:00:00\.123Z~[A-Za-z0-9_-]{22}~[A-Za-z0-9_-]{22}\.3~[A-Za-z0-9_-]{44}$/,
    );
    expect(readNewsCursor(written)).toEqual(cursor);
    const quiet = { ...cursor, run: null, waiting: [] };
    expect(readNewsCursor(writeNewsCursor(quiet))).toEqual(quiet);
    expect(writeNewsCursor({ ...quiet, shown: null })).toBe('2026-11-13T10:00:00.123Z');
  });

  it('refuses what is not one, and more waiting stories than a page can leave', () => {
    const id = packId(STORY)!;
    for (const bad of [
      '',
      'yesterday',
      '2026-11-13T10:00:00Z~40',
      `yesterday~${id}~-~`,
      `2026-11-13T10:00:00Z~${id}~-`,
      `2026-11-13T10:00:00Z~${id}~${id}.0~`,
      `2026-11-13T10:00:00Z~${id}~-~${id.slice(1)}`,
    ]) {
      expect(readNewsCursor(bad), bad).toBeNull();
    }
    const at = '2026-11-13T10:00:00Z';
    expect(readNewsCursor(`${at}~${id}~-~${id.repeat(NEWS_CURSOR_MAX_WAITING)}`)).not.toBeNull();
    expect(readNewsCursor(`${at}~${id}~-~${id.repeat(NEWS_CURSOR_MAX_WAITING + 1)}`)).toBeNull();
  });
});
