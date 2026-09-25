import { describe, expect, it } from 'vitest';
import { SharedSnapshots } from './internal/shared-snapshots';

/** A read the test finishes by hand, and a count of how many were started. */
function reads() {
  let started = 0;
  const pending: ((text: string) => void)[] = [];
  const failing: ((error: Error) => void)[] = [];
  return {
    render: () => {
      started += 1;
      return new Promise<string>((resolve, reject) => {
        pending.push(resolve);
        failing.push(reject);
      });
    },
    finish: (index: number, text: string) => pending[index]?.(text),
    fail: (index: number, error: Error) => failing[index]?.(error),
    get started() {
      return started;
    },
  };
}

describe('SharedSnapshots', () => {
  it('serves every stream asking the same question from one read', async () => {
    const shared = new SharedSnapshots();
    const read = reads();
    const asks = Array.from({ length: 1000 }, () => shared.event('scores:a', read.render));
    expect(read.started).toBe(1);
    read.finish(0, 'snapshot');
    expect(new Set(await Promise.all(asks))).toEqual(new Set(['snapshot']));
  });

  it('reads once per distinct question', () => {
    const shared = new SharedSnapshots();
    const read = reads();
    void shared.event('scores::{"date":"2026-09-20"}', read.render);
    void shared.event('scores:member:{"date":"2026-09-20"}', read.render);
    void shared.event('fixture:x', read.render);
    expect(read.started).toBe(3);
    expect(shared.reading).toBe(3);
  });

  /**
   * Rule 4: a read that began before a change cannot show it, so a stream
   * that asks after the change must not be handed that read.
   */
  it('never hands out a read that began before the latest change', async () => {
    const shared = new SharedSnapshots();
    const read = reads();
    const before = shared.event('scores:a', read.render);
    shared.noteChange();
    const after = shared.event('scores:a', read.render);
    expect(read.started).toBe(2);

    // And the newer read is the one later askers join.
    const later = shared.event('scores:a', read.render);
    expect(read.started).toBe(2);

    read.finish(0, 'old');
    read.finish(1, 'new');
    expect(await before).toBe('old');
    expect(await after).toBe('new');
    expect(await later).toBe('new');
  });

  it('keeps nothing once a read has settled: it is not a cache', async () => {
    const shared = new SharedSnapshots();
    const read = reads();
    const first = shared.event('scores:a', read.render);
    read.finish(0, 'first');
    await first;
    expect(shared.reading).toBe(0);

    void shared.event('scores:a', read.render);
    expect(read.started).toBe(2);
  });

  it('gives every joiner the failure, and forgets the read that failed', async () => {
    const shared = new SharedSnapshots();
    const read = reads();
    const one = shared.event('scores:a', read.render);
    const two = shared.event('scores:a', read.render);
    read.fail(0, new Error('database gone'));
    await expect(one).rejects.toThrow('database gone');
    await expect(two).rejects.toThrow('database gone');
    expect(shared.reading).toBe(0);
  });
});
