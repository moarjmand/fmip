import { describe, expect, it } from 'vitest';
import type { PollTarget } from './internal/ingest-store';
import { liveQuestion } from './ingestion-jobs.service';

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
