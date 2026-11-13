import {
  NEWS_CURSOR_MAX_SKIP,
  newsSourcesMixed,
  readNewsCursor,
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
    const top = mixSources(burst(), 40, true);
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
    const all = mixSources(input, input.length, true);
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
    expect(ids(mixSources(input, 10, true))).toEqual([
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
    expect(ids(mixSources(mixed, 8, true))).toEqual(ids(mixed));
    const alone = rows([['Y', 10]]);
    expect(ids(mixSources(alone, 10, true))).toEqual(ids(alone));
    expect(mixSources([], 10, true)).toEqual([]);
  });

  it('is deterministic: a shorter list begins the longer, and a partial read agrees with the whole', () => {
    for (const seed of [1, 2, 3, 99, 2026]) {
      const input = stream(600, seed);
      const whole = mixSources(input, input.length, true);
      for (const count of [1, 6, 40, 80, 160]) {
        expect(ids(mixSources(input, count, true))).toEqual(ids(whole.slice(0, count)));
        // The newest rows only, as a page reads them: what it composes begins the whole.
        for (const read of [count + SOURCE_MIX.lookahead, count * 2 + 10 + SOURCE_MIX.lookahead]) {
          const part = mixSources(input.slice(0, read), count, false);
          expect(ids(part), `seed ${seed}, count ${count}, read ${read}`).toEqual(
            ids(whole.slice(0, part.length)),
          );
        }
      }
    }
  });

  it('stops short rather than guess when the rows end before a place’s reach', () => {
    const input = burst();
    expect(mixSources(input.slice(0, SOURCE_MIX.lookahead - 1), 10, false)).toEqual([]);
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
  it('reads an instant, or an instant with the cards shown, and writes it back', () => {
    expect(readNewsCursor('2026-11-13T10:00:00Z')).toEqual({
      at: '2026-11-13T10:00:00.000Z',
      skip: 0,
    });
    const page = readNewsCursor('2026-11-13T10:00:00.000Z~40');
    expect(page).toEqual({ at: '2026-11-13T10:00:00.000Z', skip: 40 });
    expect(writeNewsCursor(page!)).toBe('2026-11-13T10:00:00.000Z~40');
    expect(writeNewsCursor({ at: '2026-11-13T10:00:00.000Z', skip: 0 })).toBe(
      '2026-11-13T10:00:00.000Z',
    );
  });

  it('refuses what is not one, and more cards shown than a page may re-read', () => {
    for (const bad of ['yesterday', 'yesterday~40', '2026-11-13T10:00:00Z~', '~40', '']) {
      expect(readNewsCursor(bad), bad).toBeNull();
    }
    expect(readNewsCursor(`2026-11-13T10:00:00Z~${NEWS_CURSOR_MAX_SKIP}`)).not.toBeNull();
    expect(readNewsCursor(`2026-11-13T10:00:00Z~${NEWS_CURSOR_MAX_SKIP + 1}`)).toBeNull();
  });
});
