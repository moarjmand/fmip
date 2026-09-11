import { describe, expect, it, vi } from 'vitest';
import { debounce, sseEvent } from './internal/sse';

describe('sseEvent', () => {
  it('frames one event with its name, id and one data line', () => {
    expect(sseEvent('snapshot', { a: 1 }, '2026-09-11T10:00:00.000Z')).toBe(
      'event: snapshot\nid: 2026-09-11T10:00:00.000Z\ndata: {"a":1}\n\n',
    );
    expect(sseEvent('heartbeat', { at: 't' })).toBe('event: heartbeat\ndata: {"at":"t"}\n\n');
  });

  it('cannot be broken by content: JSON carries no raw newline', () => {
    const framed = sseEvent('snapshot', { text: 'line one\nline two' });
    expect(framed.split('\n\n')).toHaveLength(2);
    expect(framed).toContain('\\n');
  });
});

describe('debounce', () => {
  it('collapses a burst into one run and can be cancelled', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const d = debounce(100, run);
    d.trigger();
    d.trigger();
    vi.advanceTimersByTime(60);
    d.trigger();
    vi.advanceTimersByTime(99);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    d.trigger();
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
