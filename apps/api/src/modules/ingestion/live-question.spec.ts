import { describe, expect, it } from 'vitest';
import type { PollTarget } from './internal/ingest-store';
import { clockStopped, liveQuestion } from './ingestion-jobs.service';

/**
 * T-501: the live job asks the provider once a tick, not once per competition,
 * and every fixture in the answer goes back to the competition it came from.
 */

const target = (competitionId: string, seasonLabel: string): PollTarget =>
  ({ competitionId, seasonLabel }) as PollTarget;

describe('the live question', () => {
  it('asks once for every competition with a match in the window', () => {
    const premier = target('pl', '2026/27');
    const liga = target('ll', '2026/27');
    const quiet = target('bl', '2026/27');
    const question = liveQuestion([
      { target: premier, externalIds: ['1', '2'] },
      { target: quiet, externalIds: [] },
      { target: liga, externalIds: ['3'] },
    ]);

    expect(question.externalIds).toEqual(['1', '2', '3']);
    expect(question.targetOf.get('2')).toBe(premier);
    expect(question.targetOf.get('3')).toBe(liga);
    // Only the competitions that asked are named if the answer is a refusal.
    expect(question.seasonLabels).toHaveLength(2);
  });

  it('asks nothing when nothing is in the window', () => {
    const question = liveQuestion([{ target: target('pl', '2026/27'), externalIds: [] }]);
    expect(question.externalIds).toEqual([]);
    expect(question.seasonLabels).toEqual([]);
  });
});

/**
 * T-1394 (D-209): the matches the live list answered about without a change
 * are told to the open pages only where the stored clock stands still.
 */
describe('a stopped clock', () => {
  it('is half-time, added time, a break or a suspension', () => {
    for (const minute of [45, 90, 105, 120]) {
      expect(clockStopped({ status: 'live', minute })).toBe(true);
    }
    expect(clockStopped({ status: 'suspended', minute: null })).toBe(true);
  });

  it('is not play in progress, a match with no minute, or a match over', () => {
    expect(clockStopped({ status: 'live', minute: 63 })).toBe(false);
    expect(clockStopped({ status: 'live', minute: null })).toBe(false);
    expect(clockStopped({ status: 'finished', minute: null })).toBe(false);
  });
});
