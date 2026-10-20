import { describe, expect, it } from 'vitest';
import { AskPacer, BULK_ASK_GAP_MS } from './ask-pacer';

function clock() {
  let at = 1_000;
  const waits: number[] = [];
  return {
    waits,
    advance: (ms: number) => {
      at += ms;
    },
    now: () => at,
    wait: (ms: number) => {
      waits.push(ms);
      at += ms;
      return Promise.resolve();
    },
  };
}

describe('AskPacer (T-1422)', () => {
  it('lets the first ask go at once and holds the next to the gap', async () => {
    const c = clock();
    const pacer = new AskPacer(BULK_ASK_GAP_MS, c.now, c.wait);
    await pacer.pace();
    await pacer.pace();
    await pacer.pace();
    expect(c.waits).toEqual([BULK_ASK_GAP_MS, BULK_ASK_GAP_MS]);
  });

  it('waits only for what is left of the gap', async () => {
    const c = clock();
    const pacer = new AskPacer(500, c.now, c.wait);
    await pacer.pace();
    c.advance(300);
    await pacer.pace();
    expect(c.waits).toEqual([200]);
  });

  it('does not slow an ask whose predecessor already took longer than the gap', async () => {
    const c = clock();
    const pacer = new AskPacer(500, c.now, c.wait);
    await pacer.pace();
    c.advance(800);
    await pacer.pace();
    expect(c.waits).toEqual([]);
  });

  it('keeps 200 asks to at most 120 a minute', async () => {
    const c = clock();
    const pacer = new AskPacer(BULK_ASK_GAP_MS, c.now, c.wait);
    const start = c.now();
    for (let i = 0; i < 200; i += 1) await pacer.pace();
    expect(c.now() - start).toBeGreaterThanOrEqual(199 * BULK_ASK_GAP_MS);
  });
});
