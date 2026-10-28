import { describe, expect, it } from 'vitest';
import {
  LINEUP_ASK_FROM_MINUTES,
  LINEUP_ASK_UNTIL_MINUTES,
  LINEUP_BATCH,
  type LineupCandidate,
  lineupAsks,
  lineupWindow,
} from './lineup-asks';

const NOW = new Date('2026-10-27T18:30:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

let n = 0;
function match(
  kickoffInMinutes: number,
  announced = false,
  status: string = kickoffInMinutes > 0 ? 'scheduled' : 'live',
): LineupCandidate {
  n += 1;
  const id = String(n).padStart(4, '0');
  return {
    externalId: `x${id}`,
    fixtureId: `f${id}`,
    kickoffAt: at(kickoffInMinutes),
    status,
    announced,
  };
}

/** T-1625, D-293: who the line-ups job asks, from 75 minutes before kick-off. */
describe('the line-up asks of one run', () => {
  it('reads kick-offs from an hour ago to 75 minutes ahead', () => {
    expect(lineupWindow(NOW)).toEqual({
      from: at(-LINEUP_ASK_UNTIL_MINUTES),
      to: at(LINEUP_ASK_FROM_MINUTES),
    });
  });

  it('asks a match from 75 minutes before kick-off, not earlier', () => {
    const early = match(LINEUP_ASK_FROM_MINUTES + 5);
    const first = match(LINEUP_ASK_FROM_MINUTES);
    const hour = match(60);
    expect(lineupAsks([early, first, hour], NOW)).toEqual([hour, first]);
  });

  it('asks what has no line-up before re-asking what has, however many matches are playing', () => {
    // 2026-10-27 19:15: ten slots went to Copa del Rey ties already playing,
    // and Serie A at 19:45 was never asked before full time.
    const playing = Array.from({ length: 12 }, () => match(-40, true, 'live'));
    const cupTies = Array.from({ length: 5 }, () => match(-15, false, 'live'));
    const serieA = [match(30), match(30)];
    const stored = match(10, true);
    const asks = lineupAsks([...playing, ...cupTies, stored, ...serieA], NOW);
    expect(asks.slice(0, 2)).toEqual(serieA);
    expect(asks.slice(2, 7)).toEqual(cupTies);
    expect(asks.slice(7)).toEqual([stored]);
  });

  it('never asks a playing match whose line-up is stored, nor one finished or postponed', () => {
    expect(
      lineupAsks(
        [match(-5, true, 'live'), match(-30, false, 'finished'), match(20, false, 'postponed')],
        NOW,
      ),
    ).toEqual([]);
  });

  it('stops asking for a line-up that never came an hour after kick-off', () => {
    const late = match(-LINEUP_ASK_UNTIL_MINUTES + 5, false, 'live');
    const gone = match(-LINEUP_ASK_UNTIL_MINUTES, false, 'live');
    expect(lineupAsks([gone, late], NOW)).toEqual([late]);
  });

  it('treats a match still marked scheduled after its kick-off as kicked off', () => {
    const lagging = match(-2, false, 'scheduled');
    const storedLagging = match(-2, true, 'scheduled');
    const next = match(5);
    expect(lineupAsks([storedLagging, lagging, next], NOW)).toEqual([next, lagging]);
  });

  it('asks the soonest kick-off first within each need, and at most a batch', () => {
    const many = Array.from({ length: LINEUP_BATCH + 5 }, (_, i) => match(70 - i));
    const asks = lineupAsks(many, NOW);
    expect(asks).toHaveLength(LINEUP_BATCH);
    expect(asks[0]?.kickoffAt).toBe(at(70 - (LINEUP_BATCH + 4)));
    const kickoffs = asks.map((a) => Date.parse(a.kickoffAt));
    expect([...kickoffs].sort((a, b) => a - b)).toEqual(kickoffs);
  });
});
