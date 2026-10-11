import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LITE,
  LITE_POLL_MS,
  LITE_PREFERENCES,
  SLOW_COOKIE,
  liteMode,
  litePreferenceOf,
  parseLite,
  saveDataRequested,
  slowConnection,
  slowCookieString,
  slowHint,
} from './lite';
import {
  INITIAL_CLOCK,
  LITE_STALE_AFTER_MS,
  STALE_AFTER_MS,
  liveState,
  staleAfterMs,
} from './live';
import { openLiveSource } from './live-source';

/**
 * Lite mode's rules (T-1387, D-205): the preference read from a cookie or a
 * form, what counts as a slow connection on each side, the mode those make,
 * and the poll that replaces the open stream.
 */

describe('the lite preference', () => {
  it('is auto, on or off, exactly, and auto when nothing was chosen', () => {
    expect(LITE_PREFERENCES).toEqual(['auto', 'on', 'off']);
    expect(DEFAULT_LITE).toBe('auto');
    for (const value of LITE_PREFERENCES) expect(parseLite(value)).toBe(value);
    for (const raw of ['On', 'true', '1', '', ' on', undefined, null, 1, true]) {
      expect(parseLite(raw), String(raw)).toBeUndefined();
      expect(litePreferenceOf(raw), String(raw)).toBe('auto');
    }
  });
});

describe('a slow connection', () => {
  it('is `Save-Data: on` on the server, whatever its case and spaces', () => {
    expect(saveDataRequested('on')).toBe(true);
    expect(saveDataRequested(' On ')).toBe(true);
    for (const raw of ['off', '', '1', 'yes', null, undefined]) {
      expect(saveDataRequested(raw), String(raw)).toBe(false);
    }
  });

  it('is saveData, or a 3G or slower effective type, on the client', () => {
    expect(slowConnection({ saveData: true, effectiveType: '4g' })).toBe(true);
    for (const type of ['slow-2g', '2g', '3g']) {
      expect(slowConnection({ effectiveType: type }), type).toBe(true);
    }
    expect(slowConnection({ saveData: false, effectiveType: '4g' })).toBe(false);
    expect(slowConnection({ effectiveType: '4g' })).toBe(false);
  });

  it('is unknown, not fast, where the browser cannot say', () => {
    // Safari and Firefox have no `navigator.connection`.
    expect(slowConnection(undefined)).toBeUndefined();
    expect(slowConnection(null)).toBeUndefined();
    expect(slowConnection({})).toBeUndefined();
    expect(slowConnection({ saveData: false })).toBe(false);
  });

  it('is remembered for the server in a hint cookie: set for a week when slow, cleared when fast', () => {
    expect(slowCookieString(true, true)).toBe(
      `${SLOW_COOKIE}=1; max-age=604800; path=/; samesite=lax; secure`,
    );
    expect(slowCookieString(false, false)).toBe(`${SLOW_COOKIE}=; max-age=0; path=/; samesite=lax`);
    expect(slowHint('1')).toBe(true);
    for (const raw of ['', '0', 'true', undefined]) expect(slowHint(raw), String(raw)).toBe(false);
  });
});

describe('the mode', () => {
  it('is on when chosen, says so, and ignores the connection', () => {
    expect(liteMode('on', false)).toEqual({ on: true, reason: 'chosen' });
    expect(liteMode('on', true)).toEqual({ on: true, reason: 'chosen' });
  });

  it('on auto, follows the connection and says that is why', () => {
    expect(liteMode('auto', true)).toEqual({ on: true, reason: 'slow' });
    expect(liteMode('auto', false)).toEqual({ on: false, reason: null });
  });

  it('is never on when turned off, however slow the connection', () => {
    expect(liteMode('off', true)).toEqual({ on: false, reason: null });
  });
});

describe('fewer live updates', () => {
  it('judge a lite surface stale only after a missed poll plus the same slack', () => {
    expect(staleAfterMs(false)).toBe(STALE_AFTER_MS);
    expect(staleAfterMs(true)).toBe(LITE_POLL_MS + STALE_AFTER_MS);
    const at = 1_000_000;
    const clock = { ...INITIAL_CLOCK, lastEventAt: at, lastSnapshotAt: at };
    const later = at + STALE_AFTER_MS + 1_000;
    expect(liveState(clock, later)).toBe('stale');
    expect(liveState(clock, later, staleAfterMs(true))).toBe('live');
    expect(liveState(clock, at + LITE_STALE_AFTER_MS + 1, staleAfterMs(true))).toBe('stale');
  });

  class FakeSource {
    static opened: FakeSource[] = [];
    closed = false;
    listeners = new Map<string, ((event: unknown) => void)[]>();
    constructor(readonly url: string) {
      FakeSource.opened.push(this);
    }
    addEventListener(type: string, listener: (event: unknown) => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string): void {
      for (const listener of this.listeners.get(type) ?? []) listener({ data: '{}' });
    }
    close(): void {
      this.closed = true;
    }
  }

  beforeEach(() => {
    FakeSource.opened = [];
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keep the stream open when lite mode is off', () => {
    const seen: string[] = [];
    const stop = openLiveSource('/api/scores/stream', false, (source) =>
      source.addEventListener('snapshot', () => seen.push('snapshot')),
    );
    const [source] = FakeSource.opened;
    source!.emit('snapshot');
    source!.emit('snapshot');
    expect(seen).toEqual(['snapshot', 'snapshot']);
    expect(source!.closed).toBe(false);
    vi.advanceTimersByTime(LITE_POLL_MS * 2);
    expect(FakeSource.opened).toHaveLength(1);
    stop();
    expect(source!.closed).toBe(true);
  });

  it('in lite mode, take one snapshot, close, and ask again a minute later', () => {
    const seen: string[] = [];
    const stop = openLiveSource('/api/scores/stream', true, (source) =>
      source.addEventListener('snapshot', () => seen.push('snapshot')),
    );
    const first = FakeSource.opened[0]!;
    first.emit('snapshot');
    // The surface's own listener ran first, then the source closed.
    expect(seen).toEqual(['snapshot']);
    expect(first.closed).toBe(true);
    vi.advanceTimersByTime(LITE_POLL_MS - 1);
    expect(FakeSource.opened).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSource.opened).toHaveLength(2);
    const second = FakeSource.opened[1]!;
    expect(second.url).toBe('/api/scores/stream');
    second.emit('snapshot');
    expect(seen).toEqual(['snapshot', 'snapshot']);

    // Cleaning up between polls cancels the next one.
    stop();
    vi.advanceTimersByTime(LITE_POLL_MS * 3);
    expect(FakeSource.opened).toHaveLength(2);
  });
});
