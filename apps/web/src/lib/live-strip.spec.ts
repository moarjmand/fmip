import type { ScoreCard } from '@fmip/contracts';
import { STALE_LIVE_AFTER_MS } from '@fmip/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  FRESH_ANSWER_MS,
  type KeptAnswer,
  STRIP_ANSWER_MS,
  STRIP_FAILURE_MS,
  sharedAnswer,
  stripBehindAt,
  stripIsBehind,
} from './live-strip';

/** The live strip's rules (T-1381, D-199) the moments rail keeps (T-1642, D-300). */

const NOW = Date.parse('2026-10-11T15:00:00.000Z');

function stripCard(over: Partial<ScoreCard> = {}): ScoreCard {
  return {
    id: '00000000-0000-4000-8000-000000001381',
    kickoff_at: '2026-10-11T13:30:00.000Z',
    status: 'scheduled',
    minute: null,
    competition: { id: 'c', name: 'Persian Gulf Pro League', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'Tractor', short_name: null, code: 'TRA' },
    away: { id: 'a', name: 'Esteghlal', short_name: null, code: 'EST' },
    scores: {
      current: null,
      half_time: null,
      full_time: null,
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: null,
    coverage: 'available',
    last_updated_at: '2026-10-11T14:59:30.000Z',
    freshness: null,
    pinned: false,
    ...over,
  };
}

describe('when the strip may be behind (rule 4)', () => {
  const generated = '2026-10-11T15:00:00.000Z';

  it('never, when every match is over', () => {
    const over = [stripCard({ status: 'finished', scores: score(1, 0) })];
    expect(stripBehindAt(over, generated)).toBeNull();
    expect(stripIsBehind(over, generated, NOW + 86_400_000)).toBe(false);
  });

  it('from the answer’s time when a match is live', () => {
    const live = [
      stripCard({ status: 'live', minute: 10, scores: score(0, 0), last_updated_at: generated }),
    ];
    expect(stripBehindAt(live, generated)).toBe(NOW + STALE_LIVE_AFTER_MS);
    expect(stripIsBehind(live, generated, NOW + STALE_LIVE_AFTER_MS - 1)).toBe(false);
    expect(stripIsBehind(live, generated, NOW + STALE_LIVE_AFTER_MS)).toBe(true);
  });

  it('from the kick-off when the next match has not started', () => {
    const later = [stripCard({ kickoff_at: '2026-10-11T17:00:00.000Z' })];
    expect(stripBehindAt(later, generated)).toBe(
      Date.parse('2026-10-11T17:00:00.000Z') + STALE_LIVE_AFTER_MS,
    );
  });

  it('at once when a chip is already behind', () => {
    const stuck = [
      stripCard({
        status: 'live',
        minute: 78,
        scores: score(1, 1),
        last_updated_at: new Date(NOW - STALE_LIVE_AFTER_MS - 1).toISOString(),
      }),
    ];
    expect(stripIsBehind(stuck, generated, NOW)).toBe(true);
  });
});

describe('the shared answer', () => {
  type Answer = { ok: boolean; n: number };

  it('is asked once for a key within its life, and again after', async () => {
    const kept = new Map<string, KeptAnswer<Answer>>();
    let n = 0;
    const ask = vi.fn(async () => ({ ok: true, n: ++n }));
    expect((await sharedAnswer(kept, 'k', 0, ask)).n).toBe(1);
    expect((await sharedAnswer(kept, 'k', STRIP_ANSWER_MS - 1, ask)).n).toBe(1);
    expect((await sharedAnswer(kept, 'k', STRIP_ANSWER_MS, ask)).n).toBe(2);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('is asked again sooner when the page saw a match move, and shared from then on (T-1635)', async () => {
    const kept = new Map<string, KeptAnswer<Answer>>();
    let n = 0;
    const ask = vi.fn(async () => ({ ok: true, n: ++n }));
    await sharedAnswer(kept, 'k', 0, ask);
    // Within the fresh life the kept answer still stands.
    expect((await sharedAnswer(kept, 'k', FRESH_ANSWER_MS - 1, ask, FRESH_ANSWER_MS)).n).toBe(1);
    // Older than that: asked again, and the new answer is the one shared.
    expect((await sharedAnswer(kept, 'k', FRESH_ANSWER_MS, ask, FRESH_ANSWER_MS)).n).toBe(2);
    expect((await sharedAnswer(kept, 'k', FRESH_ANSWER_MS + 1, ask)).n).toBe(2);
    expect((await sharedAnswer(kept, 'k', FRESH_ANSWER_MS + 1, ask, FRESH_ANSWER_MS)).n).toBe(2);
    // A longer max age never keeps an answer past its usual life.
    expect((await sharedAnswer(kept, 'k', FRESH_ANSWER_MS + STRIP_ANSWER_MS, ask, 60_000)).n).toBe(
      3,
    );
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('keeps one key per day, zone and language apart', async () => {
    const kept = new Map<string, KeptAnswer<Answer>>();
    let n = 0;
    const ask = async () => ({ ok: true, n: ++n });
    await sharedAnswer(kept, '2026-10-11|UTC|en', 0, ask);
    expect((await sharedAnswer(kept, '2026-10-11|UTC|fa', 0, ask)).n).toBe(2);
  });

  it('keeps a failure for less, so an API that is back is asked soon', async () => {
    const kept = new Map<string, KeptAnswer<Answer>>();
    let n = 0;
    const ask = async () => ({ ok: n++ > 0, n });
    expect((await sharedAnswer(kept, 'k', 0, ask)).ok).toBe(false);
    expect((await sharedAnswer(kept, 'k', STRIP_FAILURE_MS - 1, ask)).ok).toBe(false);
    expect((await sharedAnswer(kept, 'k', STRIP_FAILURE_MS, ask)).ok).toBe(true);
  });

  it('holds a bounded number of keys, dropping the oldest', async () => {
    const kept = new Map<string, KeptAnswer<Answer>>();
    const ask = async () => ({ ok: true, n: 0 });
    for (let i = 0; i < 40; i += 1) await sharedAnswer(kept, `k${i}`, 0, ask);
    expect(kept.size).toBe(32);
    expect(kept.has('k0')).toBe(false);
    expect(kept.has('k39')).toBe(true);
  });
});

function score(home: number, away: number): ScoreCard['scores'] {
  return {
    current: { home, away },
    half_time: null,
    full_time: { home, away },
    extra_time: null,
    penalties: null,
    aggregate: null,
  };
}
