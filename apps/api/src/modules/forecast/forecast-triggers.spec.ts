import { describe, expect, it } from 'vitest';
import type { ForecastKind } from '@fmip/contracts';
import {
  EARLY_WINDOW_DAYS,
  MILLISECONDS_PER_DAY,
  dueKind,
  type FixtureState,
} from './internal/forecast-triggers';

// When a forecast version is due (T-120, blueprint 6.4). The acceptance
// criterion is "each kind is produced once per fixture and named", and both
// halves of that are properties of this function rather than of a cron.

const NOW = new Date('2026-01-05T12:00:00Z');

function fixture(over: Partial<FixtureState> = {}): FixtureState {
  return {
    fixtureId: 'f1',
    kickoffAt: new Date(NOW.getTime() + 2 * MILLISECONDS_PER_DAY),
    status: 'scheduled',
    hasLineup: false,
    existingKinds: [],
    ...over,
  };
}

describe('which version is due', () => {
  it('is the early one, once, for a match inside the window', () => {
    expect(dueKind(fixture(), NOW)).toEqual({ kind: 'early' });
    // And never again: a version is a statement about the moment it was made.
    expect(dueKind(fixture({ existingKinds: ['early'] }), NOW)).toEqual({
      skip: 'the early version is recorded and no line-up has arrived yet',
    });
  });

  it('is the confirmed-line-up one as soon as a line-up exists, ahead of the early one', () => {
    // A line-up is the most informative thing that happens before kick-off, so
    // it takes priority over an early version that has not been written yet.
    expect(dueKind(fixture({ hasLineup: true }), NOW)).toEqual({ kind: 'lineups_confirmed' });
    expect(dueKind(fixture({ hasLineup: true, existingKinds: ['early'] }), NOW)).toEqual({
      kind: 'lineups_confirmed',
    });
    expect(
      dueKind(fixture({ hasLineup: true, existingKinds: ['early', 'lineups_confirmed'] }), NOW),
    ).toEqual({ skip: 'every kind this data can produce has been recorded' });
  });

  it('never produces `lineups_predicted`, because nothing supplies predicted line-ups', () => {
    // Producing it automatically would mean labelling a *confirmed* line-up as
    // a predicted one. It stays available to an operator over HTTP, which is
    // the honest place for a judgement nobody's data can make.
    const everything: FixtureState[] = [
      fixture(),
      fixture({ hasLineup: true }),
      fixture({ existingKinds: ['early'] }),
      fixture({ hasLineup: true, existingKinds: ['early', 'lineups_confirmed'] }),
    ];
    const kinds = everything
      .map((state) => dueKind(state, NOW))
      .filter((due): due is { kind: ForecastKind } => 'kind' in due)
      .map((due) => due.kind);
    expect(kinds).not.toContain('lineups_predicted');
  });

  it('waits until the match is close enough to be worth forecasting', () => {
    const distant = fixture({
      kickoffAt: new Date(NOW.getTime() + (EARLY_WINDOW_DAYS + 3) * MILLISECONDS_PER_DAY),
    });
    expect(dueKind(distant, NOW)).toEqual({ skip: 'kick-off is 10 days away' });
  });

  it('produces nothing once kick-off has passed, whatever the status says', () => {
    const kickedOff = fixture({ kickoffAt: new Date(NOW.getTime() - 60 * 1000) });
    expect(dueKind(kickedOff, NOW)).toEqual({ skip: 'kick-off has passed' });

    for (const status of ['live', 'finished', 'postponed', 'cancelled']) {
      expect(dueKind(fixture({ status }), NOW)).toEqual({
        skip: `status is ${status}, and a pre-match version is only due before kick-off`,
      });
    }
  });

  it('names a reason every time it produces nothing', () => {
    const states = [
      fixture({ status: 'finished' }),
      fixture({ kickoffAt: new Date(NOW.getTime() - 1) }),
      fixture({ existingKinds: ['early'] }),
      fixture({ kickoffAt: new Date(NOW.getTime() + 30 * MILLISECONDS_PER_DAY) }),
    ];
    for (const state of states) {
      const due = dueKind(state, NOW);
      expect('skip' in due && due.skip.length > 0).toBe(true);
    }
  });
});
