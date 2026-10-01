import { describe, expect, it } from 'vitest';
import { STALE_LIVE_AFTER_MS } from '@fmip/contracts';
import { INITIAL_CLOCK, STALE_AFTER_MS, feedTrouble, isBehind, liveLabel, liveState } from './live';
import { scoresWords } from './words-server';

const EN_WORDS = scoresWords('en').m;
const FA_WORDS = scoresWords('fa').m;

describe('isBehind', () => {
  const now = Date.parse('2026-09-12T20:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('flags a live match whose data stopped changing, on the client clock or the API word', () => {
    expect(isBehind({ status: 'live', last_updated_at: ago(0) }, now)).toBe(false);
    expect(isBehind({ status: 'live', last_updated_at: ago(STALE_LIVE_AFTER_MS + 1) }, now)).toBe(
      true,
    );
    expect(isBehind({ status: 'live', last_updated_at: ago(0), freshness: 'stale' }, now)).toBe(
      true,
    );
    expect(isBehind({ status: 'suspended', last_updated_at: ago(600_000) }, now)).toBe(true);
  });

  it('never applies before kick-off or after the end', () => {
    expect(isBehind({ status: 'scheduled', last_updated_at: ago(3_600_000) }, now)).toBe(false);
    expect(isBehind({ status: 'finished', last_updated_at: ago(3_600_000) }, now)).toBe(false);
  });
});

describe('feedTrouble', () => {
  const run = (status: 'succeeded' | 'failed' | 'partial') => ({
    checked_at: '2026-09-12T20:00:00.000Z',
    last_run: {
      id: 'r',
      provider: 'api_football',
      job: 'live',
      scope: null,
      status,
      started_at: '2026-09-12T19:58:00.000Z',
      finished_at: '2026-09-12T19:59:30.000Z',
      items_seen: 0,
      items_written: 0,
      error: status === 'succeeded' ? null : 'boom',
      requests: 1,
    },
    last_failure: null,
    failed_last_24h: 0,
    running: 0,
    recent: [],
    pollable: { provider: 'api_football', reason: null, competitions: 1, with_current_season: 1 },
    requests_today: 1,
    request_budget: null,
  });

  it('names a failed or partial latest run with its time, and says nothing otherwise', () => {
    expect(feedTrouble(run('failed'), 'en', 'Asia/Tehran')).toEqual({
      kind: 'failure',
      at: '23:29',
    });
    expect(feedTrouble(run('partial'), 'en', 'UTC')).toEqual({ kind: 'partial', at: '19:59' });
    expect(feedTrouble(run('succeeded'), 'en', 'UTC')).toBeNull();
    expect(feedTrouble(null, 'en', 'UTC')).toBeNull();
    expect(feedTrouble({ ...run('failed'), last_run: null }, 'en', 'UTC')).toBeNull();
  });
});

const T0 = Date.parse('2026-09-11T20:31:07Z');

describe('liveState', () => {
  it('is connecting until the first event, live after it, stale when heartbeats stop', () => {
    expect(liveState(INITIAL_CLOCK, T0)).toBe('connecting');
    const clock = { lastEventAt: T0, lastSnapshotAt: T0, broken: false };
    expect(liveState(clock, T0 + 10_000)).toBe('live');
    expect(liveState(clock, T0 + STALE_AFTER_MS)).toBe('live');
    expect(liveState(clock, T0 + STALE_AFTER_MS + 1)).toBe('stale');
  });

  it('calls a broken feed stale when it has a picture and unavailable when it never had one', () => {
    expect(liveState({ lastEventAt: T0, lastSnapshotAt: T0, broken: true }, T0)).toBe('stale');
    expect(liveState({ lastEventAt: null, lastSnapshotAt: null, broken: true }, T0)).toBe(
      'unavailable',
    );
  });
});

describe('liveLabel', () => {
  it('says what it knows in the viewer zone', () => {
    const clock = { lastEventAt: T0, lastSnapshotAt: T0, broken: false };
    const W = EN_WORDS;
    expect(liveLabel('live', clock, 'en', 'UTC', W)).toBe('Live · updated 20:31:07');
    expect(liveLabel('live', clock, 'en', 'Asia/Tehran', W)).toBe('Live · updated 00:01:07');
    expect(liveLabel('stale', clock, 'en', 'UTC', W)).toBe('Stale · last update 20:31:07');
    // The stamp is a clock reading: the same digits in Spanish.
    expect(liveLabel('live', clock, 'es', 'UTC', W)).toBe('Live · updated 20:31:07');
    expect(liveLabel('connecting', INITIAL_CLOCK, 'en', 'UTC', W)).toBe(
      'Connecting to live updates…',
    );
    expect(liveLabel('unavailable', INITIAL_CLOCK, 'en', 'UTC', W)).toBe(
      'Live updates unavailable',
    );
  });

  it('says it in Persian with Persian digits on /fa (T-1303)', () => {
    const clock = { lastEventAt: T0, lastSnapshotAt: T0, broken: false };
    expect(liveLabel('live', clock, 'fa', 'UTC', FA_WORDS)).toBe('زنده · به‌روزشده ۲۰:۳۱:۰۷');
  });
});
