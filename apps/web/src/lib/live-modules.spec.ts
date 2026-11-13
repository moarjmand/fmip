import type { MatchCentre, MatchIncident } from '@fmip/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  BEHIND_AFTER_MS,
  EVENT_WINDOW_MS,
  LITE_STATS_WAIT_MS,
  NO_REFRESH,
  type RefreshPlan,
  STATS_WINDOW_MS,
  liveChange,
  liveParts,
  liveSignature,
  modulesBehind,
  planRefresh,
  refreshDue,
  refreshSettled,
  refreshStarted,
  retryUnreachable,
  SHARED_FOR_MS,
  changedParts,
  markDrawn,
  planFollowUp,
  slotsReading,
} from './live-modules';

describe('only what changed, and only what was drawn (review m2, B2)', () => {
  const a = { events: 'e1', stats: 's1' };

  it('names every changed part among those read', () => {
    expect(changedParts(a, { events: 'e2', stats: 's2' }, ['events', 'stats'])).toEqual([
      'events',
      'stats',
    ]);
    expect(changedParts(a, { events: 'e2', stats: 's2' }, ['stats'])).toEqual(['stats']);
    expect(changedParts(a, a, ['events', 'stats'])).toEqual([]);
  });

  it('a call for a part draws the slots that read it', () => {
    expect(slotsReading(['events']).sort()).toEqual(['keyEvents', 'matchLineups']);
    expect(slotsReading(['stats']).sort()).toEqual(['matchLineups', 'matchStats', 'topRated']);
  });

  it('marks as drawn the server’s data for the parts it drew, and nothing else', () => {
    // The server read data older than the snapshot that asked: that is what is drawn.
    expect(markDrawn(a, { events: 'e0', stats: 's9' }, ['events'])).toEqual({
      events: 'e0',
      stats: 's1',
    });
  });

  it('asks again after the shared read has expired, within the event window', () => {
    const now = 1_000_000;
    const plan = planFollowUp(NO_REFRESH, { now, random: 0.5 });
    expect(plan.due).toBe(now + SHARED_FOR_MS + EVENT_WINDOW_MS / 2);
    // A sooner call already planned stays.
    expect(planFollowUp({ ...NO_REFRESH, due: now + 10 }, { now, random: 0.5 }).due).toBe(now + 10);
  });
});

describe('which server modules the page drew (T-1811)', () => {
  it('the key events read the events; a page without them makes no call', () => {
    expect(liveParts({ keyEvents: 'card' })).toEqual(['events']);
    // The statistics and Top rated read the statistics; the line-ups both (T-1813, T-1814).
    expect(liveParts({ matchStats: 'card', topRated: 'card' })).toEqual(['stats']);
    expect(liveParts({ matchLineups: 'card' }).sort()).toEqual(['events', 'stats']);
    expect(liveParts({ keyEvents: null })).toEqual([]);
    expect(liveParts({ outcome: 'card' })).toEqual([]);
  });
});

describe('one retry before "unreachable" (finding arc-2026-11-13-01)', () => {
  const answer = (ok: boolean, status: number) => ({ ok, status });

  it('asks again once when the API could not be reached or failed, and takes the second answer', async () => {
    for (const status of [0, 502]) {
      const read = vi
        .fn()
        .mockResolvedValueOnce(answer(false, status))
        .mockResolvedValueOnce(answer(true, 200));
      expect(await retryUnreachable(read, 0)).toEqual(answer(true, 200));
      expect(read).toHaveBeenCalledTimes(2);
    }
    const down = vi.fn().mockResolvedValue(answer(false, 0));
    expect(await retryUnreachable(down, 0)).toEqual(answer(false, 0));
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('a found match or a 404 is final: asked once', async () => {
    for (const first of [answer(true, 200), answer(false, 404)]) {
      const read = vi.fn().mockResolvedValue(first);
      expect(await retryUnreachable(read, 0)).toEqual(first);
      expect(read).toHaveBeenCalledTimes(1);
    }
  });
});

/**
 * When the match centre's server modules are drawn again in play (T-1810,
 * D-409): never for the clock, soon for an event, within fifteen seconds for
 * statistics, one call at a time, and in lite mode statistics wait.
 */

const at = (minute: number) => `2026-11-13T20:${String(minute).padStart(2, '0')}:00.000Z`;
const covered = <T>(data: T | null, updated: string | null = at(0)) => ({
  coverage: 'available' as const,
  last_updated_at: updated,
  data,
});

const goal: MatchIncident = {
  id: '00000000-0000-4000-8000-0000000000a1',
  sequence: 1,
  minute: 23,
  added_time: null,
  kind: 'goal',
  side: 'home',
  player: { id: 'p1', name: 'Mohamed Salah' },
  related_player: null,
  detail: null,
};

function snapshot(
  over: {
    minute?: number;
    score?: { home: number; away: number };
    incidents?: MatchIncident[];
    statsAt?: string;
    lineupsAt?: string;
    penalties?: { home: number; away: number } | null;
  } = {},
): MatchCentre {
  return {
    fixture: {
      id: 'f1',
      status: 'live',
      minute: over.minute ?? 30,
      kickoff_at: at(0),
      last_updated_at: at(over.minute ?? 30),
      scores: {
        current: over.score ?? { home: 0, away: 0 },
        half_time: null,
        full_time: null,
        extra_time: null,
        penalties: over.penalties ?? null,
        aggregate: null,
      },
      periods: [
        {
          kind: 'first_half',
          sequence: 1,
          started_at: at(0),
          ended_at: null,
          added_minutes: null,
        },
      ],
    },
    timeline: covered(over.incidents ?? []),
    statistics: covered([], over.statsAt ?? at(0)),
    player_statistics: covered([], over.statsAt ?? at(0)),
    player_expected_goals: covered([], at(0)),
    lineups: covered(null, over.lineupsAt ?? at(0)),
  } as unknown as MatchCentre;
}

const BOTH = ['events', 'stats'] as const;

describe('what a snapshot changed, for the server modules', () => {
  it('a snapshot that moved only the clock changes nothing: no call', () => {
    const before = liveSignature(snapshot({ minute: 30 }));
    const after = liveSignature(snapshot({ minute: 31 }));
    expect(after).toEqual(before);
    expect(liveChange(before, after, BOTH)).toBeNull();
  });

  it('the score alone is the band’s, not a module’s', () => {
    const before = liveSignature(snapshot());
    const after = liveSignature(snapshot({ score: { home: 1, away: 0 } }));
    expect(liveChange(before, after, BOTH)).toBeNull();
  });

  it('an event is an event, and wins over statistics written at the same time', () => {
    const before = liveSignature(snapshot());
    const after = liveSignature(snapshot({ incidents: [goal], statsAt: at(31) }));
    expect(liveChange(before, after, BOTH)).toBe('event');
  });

  it('an event corrected in place (a new scorer, the same id) is an event too', () => {
    const before = liveSignature(snapshot({ incidents: [goal] }));
    const after = liveSignature(
      snapshot({ incidents: [{ ...goal, player: { id: 'p2', name: 'Luis Díaz' } }] }),
    );
    expect(liveChange(before, after, BOTH)).toBe('event');
  });

  it('a kick of a shoot-out moves its score: an event', () => {
    const before = liveSignature(snapshot({ penalties: { home: 1, away: 1 } }));
    const after = liveSignature(snapshot({ penalties: { home: 2, away: 1 } }));
    expect(liveChange(before, after, BOTH)).toBe('event');
  });

  it('statistics or a line-up written again is a statistics change', () => {
    const before = liveSignature(snapshot());
    expect(liveChange(before, liveSignature(snapshot({ statsAt: at(33) })), BOTH)).toBe('stats');
    expect(liveChange(before, liveSignature(snapshot({ lineupsAt: at(33) })), BOTH)).toBe('stats');
  });

  it('only the parts the drawn modules read count', () => {
    const before = liveSignature(snapshot());
    const stats = liveSignature(snapshot({ statsAt: at(33) }));
    expect(liveChange(before, stats, ['events'])).toBeNull();
    const event = liveSignature(snapshot({ incidents: [goal] }));
    expect(liveChange(before, event, ['stats'])).toBeNull();
  });
});

describe('when the call goes', () => {
  const NOW = Date.parse(at(30));

  it('an event within three seconds, at random', () => {
    expect(planRefresh(NO_REFRESH, 'event', { now: NOW, random: 0, lite: false }).due).toBe(NOW);
    const late = planRefresh(NO_REFRESH, 'event', { now: NOW, random: 0.9999, lite: false });
    expect(late.due).toBeLessThan(NOW + EVENT_WINDOW_MS);
    expect(late.due).toBeGreaterThan(NOW + EVENT_WINDOW_MS - 10);
  });

  it('statistics within fifteen seconds, at random; a reopened stream likewise', () => {
    for (const reason of ['stats', 'reopen'] as const) {
      const plan = planRefresh(NO_REFRESH, reason, { now: NOW, random: 0.5, lite: false });
      expect(plan.due).toBe(NOW + STATS_WINDOW_MS / 2);
    }
  });

  it('a later change never delays an earlier one; an event brings statistics forward', () => {
    const stats = planRefresh(NO_REFRESH, 'stats', { now: NOW, random: 0.9, lite: false });
    const event = planRefresh(stats, 'event', { now: NOW + 1_000, random: 0.5, lite: false });
    expect(event.due).toBe(NOW + 1_000 + EVENT_WINDOW_MS / 2);
    const again = planRefresh(event, 'stats', { now: NOW + 2_000, random: 0.9, lite: false });
    expect(again.due).toBe(event.due);
  });

  it('in lite mode statistics wait six minutes, or for the next event', () => {
    const held = planRefresh(NO_REFRESH, 'stats', { now: NOW, random: 0, lite: true });
    expect(held.due).toBe(NOW + LITE_STATS_WAIT_MS);
    // The next minute's poll sees the same change: the wait does not restart.
    const polled = planRefresh(held, 'stats', { now: NOW + 60_000, random: 0, lite: true });
    expect(polled.due).toBe(NOW + LITE_STATS_WAIT_MS);
    // An event goes as usual and takes the statistics with it.
    const event = planRefresh(polled, 'event', { now: NOW + 120_000, random: 0, lite: true });
    expect(event.due).toBe(NOW + 120_000);
    // An event in lite mode is not held.
    expect(planRefresh(NO_REFRESH, 'event', { now: NOW, random: 0, lite: true }).due).toBe(NOW);
  });
});

describe('one call at a time, and one trailing call', () => {
  const NOW = Date.parse(at(30));
  const due = (plan: RefreshPlan, now: number) => refreshDue(plan, now);

  it('nothing before the due time, one call at it', () => {
    const plan = planRefresh(NO_REFRESH, 'event', { now: NOW, random: 0.5, lite: false });
    expect(due(plan, NOW).call).toBe(false);
    const fired = due(plan, NOW + EVENT_WINDOW_MS);
    expect(fired.call).toBe(true);
    expect(fired.plan.due).toBeNull();
    expect(due(NO_REFRESH, NOW).call).toBe(false);
  });

  it('changes while a call is in flight coalesce into one more call when it settles', () => {
    let plan = refreshStarted(refreshDue({ ...NO_REFRESH, due: NOW }, NOW).plan);
    expect(plan.inFlight).toBe(true);
    // Two events arrive during the call: one trailing call, not two.
    for (const offset of [100, 200]) {
      plan = planRefresh(plan, 'event', { now: NOW + offset, random: 0, lite: false });
      const fired = refreshDue(plan, NOW + offset);
      expect(fired.call).toBe(false);
      plan = fired.plan;
    }
    expect(plan.trailing).toBe(true);
    const settled = refreshSettled(plan);
    expect(settled.call).toBe(true);
    expect(settled.plan).toEqual(NO_REFRESH);
    // The trailing call settles with nothing new: the plan is idle.
    expect(refreshSettled(refreshStarted(settled.plan))).toEqual({
      plan: NO_REFRESH,
      call: false,
    });
  });

  it('a change still waiting for its time keeps its timer after a call settles', () => {
    let plan = refreshStarted(NO_REFRESH);
    plan = planRefresh(plan, 'stats', { now: NOW, random: 0.5, lite: false });
    const settled = refreshSettled(plan);
    expect(settled.call).toBe(false);
    expect(settled.plan).toEqual({
      due: NOW + STATS_WINDOW_MS / 2,
      inFlight: false,
      trailing: false,
    });
  });
});

describe('modules that may be behind (D-409 point 4)', () => {
  it('only once a change has waited more than a minute', () => {
    const seen = Date.parse(at(30));
    expect(modulesBehind(null, seen + 10 * 60_000)).toBe(false);
    expect(modulesBehind(seen, seen + BEHIND_AFTER_MS)).toBe(false);
    expect(modulesBehind(seen, seen + BEHIND_AFTER_MS + 1)).toBe(true);
  });
});
