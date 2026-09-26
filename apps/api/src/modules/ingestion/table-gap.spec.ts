import { describe, expect, it } from 'vitest';
import { tableGap } from './ingestion-jobs.service';

/** T-030: the provider's table as a check on ours, without false alarms. */
describe('a gap in our table', () => {
  it('names a club the provider has played for and we have not, or not as often', () => {
    expect(tableGap('Arsenal', 5, undefined)).toBe(
      'Arsenal: provider 5 played, we hold no table row',
    );
    expect(tableGap('Arsenal', 5, 4)).toBe('Arsenal: provider 5 played, we have 4');
  });

  it('says nothing when the counts agree, or when the club has played nothing yet', () => {
    expect(tableGap('Arsenal', 5, 5)).toBeNull();
    // A league stage tabled before its first matchday: all zeros, no gap.
    expect(tableGap('Brighton', 0, undefined)).toBeNull();
  });
});
