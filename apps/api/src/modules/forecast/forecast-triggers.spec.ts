import { describe, expect, it } from 'vitest';
import type { ForecastKind } from '@fmip/contracts';
import {
  EARLY_WINDOW_DAYS,
  MILLISECONDS_PER_DAY,
  NO_MODEL_VERSION,
  REFRESH_MIN_HOURS,
  dueKind,
  inputsMovedOn,
  utcDay,
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
    newestPublished: null,
    newestResultOn: null,
    ...over,
  };
}

/** A fixture's newest published version, made a day before `NOW` (fit through the day before that). */
function newest(
  modelVersion: string,
  kind: ForecastKind,
  reason: string | null,
  computedAt = new Date(NOW.getTime() - MILLISECONDS_PER_DAY),
): NonNullable<FixtureState['newestPublished']> {
  return {
    modelVersion,
    kind,
    reason,
    computedAt,
    fitDate: reason === null ? utcDay(new Date(computedAt.getTime() - MILLISECONDS_PER_DAY)) : null,
  };
}

const OLD = 'dixon-coles-elo@0.1.0';
const NEW = 'dixon-coles-elo@0.6.0';

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

  describe('when the published model version changes (T-1373, D-191)', () => {
    const earlyByOld = fixture({
      existingKinds: ['early'],
      newestPublished: newest(OLD, 'early', null),
    });

    it('is the newest kind once more, from the new version, naming the one it replaces', () => {
      expect(dueKind(earlyByOld, NOW, NEW)).toEqual({ kind: 'early', replaces: OLD });
      const confirmedByOld = fixture({
        hasLineup: true,
        existingKinds: ['early', 'lineups_confirmed'],
        newestPublished: newest(OLD, 'lineups_confirmed', null),
      });
      expect(dueKind(confirmedByOld, NOW, NEW)).toEqual({
        kind: 'lineups_confirmed',
        replaces: OLD,
      });
    });

    it('is due once: nothing more once the newest is the new version', () => {
      const earlyByNew = fixture({
        existingKinds: ['early'],
        newestPublished: newest(NEW, 'early', null),
      });
      expect(dueKind(earlyByNew, NOW, NEW)).toEqual({
        skip: 'the early version is recorded and no line-up has arrived yet',
      });
    });

    it('never retries an answer no model version gave', () => {
      // An outage or the model's own `unavailable` is stored as none@0.0.0:
      // retrying it every tick would write a row a tick until it answered.
      const unanswered = fixture({
        existingKinds: ['early'],
        newestPublished: newest(NO_MODEL_VERSION, 'early', 'model_unreachable'),
      });
      expect('skip' in dueKind(unanswered, NOW, NEW)).toBe(true);
    });

    it('asks once about a cup match the published version was never asked about', () => {
      // Before D-191 a cup match's published version was `cross_competition`
      // with no model asked; the answer to the question is never that again.
      const neverAsked = fixture({
        existingKinds: ['early'],
        newestPublished: newest(NO_MODEL_VERSION, 'early', 'cross_competition'),
      });
      expect(dueKind(neverAsked, NOW, NEW)).toEqual({ kind: 'early', replaces: NO_MODEL_VERSION });
      expect('skip' in dueKind(neverAsked, NOW, null)).toBe(true);
      const askedAndRefused = fixture({
        existingKinds: ['early'],
        newestPublished: newest(NO_MODEL_VERSION, 'early', 'division_not_loaded'),
      });
      expect('skip' in dueKind(askedAndRefused, NOW, NEW)).toBe(true);
    });

    it('never writes `lineups_predicted` itself, even to replace an operator’s', () => {
      const predicted = fixture({
        existingKinds: ['early', 'lineups_predicted'],
        newestPublished: newest(OLD, 'lineups_predicted', null),
      });
      expect(dueKind(predicted, NOW, NEW)).toEqual({
        skip: 'the newest version is an operator’s; the new model waits for the next kind',
      });
    });

    it('waits when the published version cannot be asked', () => {
      expect('skip' in dueKind(earlyByOld, NOW, null)).toBe(true);
      expect('skip' in dueKind(earlyByOld, NOW)).toBe(true);
    });

    it('comes after a line-up that is due, and never after kick-off or outside the window', () => {
      expect(dueKind({ ...earlyByOld, hasLineup: true }, NOW, NEW)).toEqual({
        kind: 'lineups_confirmed',
      });
      expect(dueKind({ ...earlyByOld, kickoffAt: new Date(NOW.getTime() - 1) }, NOW, NEW)).toEqual({
        skip: 'kick-off has passed',
      });
      expect(
        dueKind(
          {
            ...earlyByOld,
            kickoffAt: new Date(NOW.getTime() + (EARLY_WINDOW_DAYS + 3) * MILLISECONDS_PER_DAY),
          },
          NOW,
          NEW,
        ),
      ).toEqual({ skip: 'kick-off is 10 days away' });
    });
  });

  describe('when results the newest forecast did not read are stored (T-1377, D-195)', () => {
    // NOW is 2026-01-05 12:00 UTC. A version made a day earlier fitted
    // results up to 2026-01-03; a fit made now reads them up to 2026-01-04.
    const twoDaysAgo = new Date(NOW.getTime() - 2 * MILLISECONDS_PER_DAY);
    const stale = fixture({
      existingKinds: ['early'],
      newestPublished: newest(NEW, 'early', null, twoDaysAgo),
      newestResultOn: '2026-01-04',
    });

    describe('the staleness rule', () => {
      const at = (fitDate: string | null, newestResultOn: string | null): boolean =>
        inputsMovedOn(
          fixture({
            newestPublished: { ...newest(NEW, 'early', null), fitDate },
            newestResultOn,
          }),
          NOW,
        );

      it('is stale when a result was played after the fit date and before today', () => {
        expect(at('2026-01-03', '2026-01-04')).toBe(true);
        expect(at('2025-12-29', '2026-01-01')).toBe(true);
      });

      it('is not stale for a result the fit already read', () => {
        expect(at('2026-01-03', '2026-01-03')).toBe(false);
        expect(at('2026-01-03', '2025-12-30')).toBe(false);
      });

      it('is not stale for a result played today, which a fit made now would not read', () => {
        expect(at('2026-01-03', '2026-01-05')).toBe(false);
      });

      it('is not stale with no result, or no fit (an unavailable version)', () => {
        expect(at('2026-01-03', null)).toBe(false);
        expect(at(null, '2026-01-04')).toBe(false);
        expect(inputsMovedOn(fixture({ newestResultOn: '2026-01-04' }), NOW)).toBe(false);
      });
    });

    it('is the early kind once more, naming the fit date it refreshes', () => {
      expect(dueKind(stale, NOW, NEW)).toEqual({ kind: 'early', refreshes: '2026-01-02' });
    });

    it('is the confirmed-line-up kind once one is recorded, never the operator’s kinds', () => {
      const confirmed = fixture({
        hasLineup: true,
        existingKinds: ['early', 'lineups_confirmed'],
        newestPublished: newest(NEW, 'lineups_confirmed', null, twoDaysAgo),
        newestResultOn: '2026-01-04',
      });
      expect(dueKind(confirmed, NOW, NEW)).toEqual({
        kind: 'lineups_confirmed',
        refreshes: '2026-01-02',
      });
      for (const kind of ['manual', 'lineups_predicted'] as const) {
        const operators = fixture({
          existingKinds: ['early', kind],
          newestPublished: newest(NEW, kind, null, twoDaysAgo),
          newestResultOn: '2026-01-04',
        });
        expect(dueKind(operators, NOW, NEW)).toEqual({ kind: 'early', refreshes: '2026-01-02' });
      }
    });

    it('is due at most once a day: not until the newest version is 24 hours old', () => {
      expect(REFRESH_MIN_HOURS).toBe(24);
      const young = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
      const recent = fixture({
        existingKinds: ['early'],
        // Made yesterday at 13:00, so its fit stopped at 2026-01-03.
        newestPublished: newest(NEW, 'early', null, young),
        newestResultOn: '2026-01-04',
      });
      expect(dueKind(recent, NOW, NEW)).toEqual({
        skip: 'newer results are stored, and the newest version is less than 24 hours old',
      });
      const dayOld = new Date(NOW.getTime() - MILLISECONDS_PER_DAY);
      expect(
        dueKind({ ...recent, newestPublished: newest(NEW, 'early', null, dayOld) }, NOW, NEW),
      ).toEqual({ kind: 'early', refreshes: '2026-01-03' });
    });

    it('is due once: the refreshed version read every result before today', () => {
      const refreshed = fixture({
        existingKinds: ['early'],
        newestPublished: { ...newest(NEW, 'early', null, NOW), fitDate: '2026-01-04' },
        newestResultOn: '2026-01-04',
      });
      expect(dueKind(refreshed, NOW, NEW)).toEqual({
        skip: 'the early version is recorded and no line-up has arrived yet',
      });
    });

    it('waits when the model service cannot be asked, and never refreshes an unavailable version', () => {
      expect('skip' in dueKind(stale, NOW, null)).toBe(true);
      expect('skip' in dueKind(stale, NOW)).toBe(true);
      const unanswered = fixture({
        existingKinds: ['early'],
        newestPublished: newest(NO_MODEL_VERSION, 'early', 'model_unreachable', twoDaysAgo),
        newestResultOn: '2026-01-04',
      });
      expect('skip' in dueKind(unanswered, NOW, NEW)).toBe(true);
    });

    it('comes after a line-up that is due and a new published version, and never after kick-off', () => {
      expect(dueKind({ ...stale, hasLineup: true }, NOW, NEW)).toEqual({
        kind: 'lineups_confirmed',
      });
      const byOld = { ...stale, newestPublished: newest(OLD, 'early', null, twoDaysAgo) };
      expect(dueKind(byOld, NOW, NEW)).toEqual({ kind: 'early', replaces: OLD });
      expect(dueKind({ ...stale, kickoffAt: new Date(NOW.getTime() - 1) }, NOW, NEW)).toEqual({
        skip: 'kick-off has passed',
      });
      expect(dueKind({ ...stale, status: 'live' }, NOW, NEW)).toEqual({
        skip: 'status is live, and a pre-match version is only due before kick-off',
      });
      expect(
        dueKind(
          {
            ...stale,
            kickoffAt: new Date(NOW.getTime() + (EARLY_WINDOW_DAYS + 3) * MILLISECONDS_PER_DAY),
          },
          NOW,
          NEW,
        ),
      ).toEqual({ skip: 'kick-off is 10 days away' });
    });
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
