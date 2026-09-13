import { describe, expect, it } from 'vitest';
import { combine } from './internal/power-index';
import {
  CONGESTION_CEILING,
  FORM_WINDOW_MATCHES,
  MIN_MATCHES_FOR_STRENGTH,
  REST_CEILING_DAYS,
  REST_FLOOR_DAYS,
  formOf,
  measure,
  percentile,
  records,
  restOf,
  strengthOf,
  venueFormOf,
  type HistoryMatch,
} from './internal/power-index-measure';

// Measuring the components (T-111). Every one of them is a position in a
// distribution rather than a score, because the blueprint forbids "arbitrary
// fixed points" — so the tests are about where a team lands among its league,
// and about what happens when it cannot be placed at all.

/** A round-robin division where team strength is by construction ordered. */
function league(teams: string[], rounds = 2): HistoryMatch[] {
  const matches: HistoryMatch[] = [];
  let day = 0;
  for (let round = 0; round < rounds; round += 1) {
    for (let i = 0; i < teams.length; i += 1) {
      for (let j = 0; j < teams.length; j += 1) {
        if (i === j) continue;
        day += 1;
        // Earlier in the array = stronger, by exactly one goal per place.
        const margin = j - i;
        matches.push({
          date: new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10),
          home: teams[i] as string,
          away: teams[j] as string,
          homeGoals: Math.max(0, margin),
          awayGoals: 0,
        });
      }
    }
  }
  return matches;
}

const TEAMS = ['best', 'good', 'middling', 'poor', 'worst'];
const HISTORY = league(TEAMS);
const RESTED = { daysSincePrevious: 7, matchesInWindow: 1 };

describe('where a team sits in its division', () => {
  it('puts the strongest at the top of the distribution and the weakest at the bottom', () => {
    const all = records(HISTORY);
    const strengths = TEAMS.map((team) => strengthOf(all.get(team)!));
    expect(strengths[0]).toBeGreaterThan(strengths[4] as number);

    const best = percentile(strengths[0] as number, strengths);
    const worst = percentile(strengths[4] as number, strengths);
    expect(best).toBeGreaterThan(0.8);
    expect(worst).toBeLessThan(0.2);
  });

  it('gives tied teams the same percentile, and a league of equals 0.5', () => {
    // Mid-rank: everything strictly below plus half the ties. A division where
    // every team is identical sits in the middle, not at the top.
    expect(percentile(1, [1, 1, 1, 1])).toBe(0.5);
    expect(percentile(2, [1, 2, 2, 3])).toBe(0.5);
    expect(percentile(9, [1, 2, 3])).toBe(1);
    expect(percentile(0, [1, 2, 3])).toBe(0);
  });
});

describe('recent form, adjusted for the opponent', () => {
  it('rates the same points higher when they came against stronger teams', () => {
    const strengths = new Map([
      ['strong', 0.9],
      ['weak', 0.1],
    ]);
    const beatStrong = {
      team: 'x',
      appearances: [
        {
          date: '2025-02-01',
          side: 'home' as const,
          opponent: 'strong',
          points: 3,
          goalDifference: 1,
        },
      ],
    };
    const beatWeak = {
      team: 'y',
      appearances: [
        {
          date: '2025-02-01',
          side: 'home' as const,
          opponent: 'weak',
          points: 3,
          goalDifference: 1,
        },
      ],
    };
    expect(formOf(beatStrong, strengths)!).toBeGreaterThan(formOf(beatWeak, strengths)!);
  });

  it('looks only at the recent window, not the whole record', () => {
    const appearances = Array.from({ length: 20 }, (_, index) => ({
      date: `2025-03-${String(20 - index).padStart(2, '0')}`,
      side: 'home' as const,
      opponent: 'other',
      // The newest six are wins, everything before them a loss.
      points: index < FORM_WINDOW_MATCHES ? 3 : 0,
      goalDifference: index < FORM_WINDOW_MATCHES ? 1 : -1,
    }));
    const strengths = new Map([['other', 0.5]]);
    // Every match in the window is a win, so form is at its maximum for an
    // average opponent: (3/3) * (0.5 + 0.5).
    expect(formOf({ team: 'x', appearances }, strengths)).toBeCloseTo(1, 6);
  });
});

describe('the venue effect', () => {
  it("is the team's record at this venue, not its record overall", () => {
    const all = records(HISTORY);
    const middling = all.get('middling')!;
    // In this construction the home side always wins or draws, so every team's
    // home record beats its away record.
    expect(venueFormOf(middling, 'home')!).toBeGreaterThan(venueFormOf(middling, 'away')!);
  });

  it('is absent when a team has not played at that venue in the window', () => {
    const homeOnly = {
      team: 'x',
      appearances: [
        { date: '2025-02-01', side: 'home' as const, opponent: 'y', points: 3, goalDifference: 2 },
      ],
    };
    expect(venueFormOf(homeOnly, 'away')).toBeNull();
  });
});

describe('rest and congestion', () => {
  it('rises with days off and falls with matches behind', () => {
    expect(restOf({ daysSincePrevious: REST_FLOOR_DAYS, matchesInWindow: 1 })).toBe(0);
    expect(restOf({ daysSincePrevious: REST_CEILING_DAYS, matchesInWindow: 1 })).toBe(1);
    expect(restOf({ daysSincePrevious: 30, matchesInWindow: 1 })).toBe(1);
    expect(
      restOf({ daysSincePrevious: REST_CEILING_DAYS, matchesInWindow: CONGESTION_CEILING }),
    ).toBe(0);
  });

  it('takes the binding constraint, not the average of the two', () => {
    // A clear week behind four matches in a fortnight is not a rested team, and
    // a mean would quietly say it was.
    const clearWeekButCongested = restOf({ daysSincePrevious: 7, matchesInWindow: 4 });
    expect(clearWeekButCongested).toBe(0);
  });

  it('is absent, not zero, when no previous fixture is on record', () => {
    expect(restOf({ daysSincePrevious: null, matchesInWindow: 0 })).toBeNull();
  });
});

describe('the measurement as a whole', () => {
  it('supplies five components and names the two it cannot reach', () => {
    const measured = measure({
      trainingName: 'good',
      side: 'home',
      history: HISTORY,
      rest: RESTED,
    });
    const combined = combine(measured)!;

    expect(combined.completeness).toBeCloseTo(0.7, 4);
    const absent = combined.components.filter((c) => c.state === 'not_supplied');
    expect(absent.map((c) => c.key).sort()).toEqual([
      'competition_context',
      'lineup_quality',
      'stability',
    ]);
    // Every absence says why. A blank panel row teaches nothing.
    expect(absent.every((c) => (c.note ?? '').length > 0)).toBe(true);
  });

  it('never calls rest `available`, because travel is not modelled', () => {
    const measured = measure({
      trainingName: 'good',
      side: 'home',
      history: HISTORY,
      rest: RESTED,
    });
    expect(measured.rest_and_congestion?.state).toBe('limited');
  });

  it('ranks a strong team above a weak one on the same history', () => {
    const strong = combine(
      measure({ trainingName: 'best', side: 'home', history: HISTORY, rest: RESTED }),
    )!;
    const weak = combine(
      measure({ trainingName: 'worst', side: 'home', history: HISTORY, rest: RESTED }),
    )!;
    expect(strong.value).toBeGreaterThan(weak.value);
    expect(strong.leading).toContain('underlying_strength');
  });

  it('reports a team the division has never seen as unmeasurable, not as weak', () => {
    const measured = measure({
      trainingName: 'a team nobody has played',
      side: 'home',
      history: HISTORY,
      rest: RESTED,
    });
    expect(measured.underlying_strength?.value).toBeNull();
    expect(measured.underlying_strength?.note).toContain('no recorded matches');
    // Only rest survives, so the index is 5% of the blueprint's weight — small,
    // and honest about being small, rather than a plausible-looking 50.
    expect(combine(measured)?.completeness).toBeCloseTo(0.05, 4);
  });

  it('marks a team with too little history `limited` rather than ranking it silently', () => {
    const thin: HistoryMatch[] = [
      ...HISTORY,
      { date: '2025-06-01', home: 'newcomer', away: 'best', homeGoals: 0, awayGoals: 1 },
    ];
    const measured = measure({
      trainingName: 'newcomer',
      side: 'home',
      history: thin,
      rest: RESTED,
    });
    expect(measured.underlying_strength?.state).toBe('limited');
    expect(measured.underlying_strength?.note).toContain('1 matches of history');
    expect(MIN_MATCHES_FOR_STRENGTH).toBeGreaterThan(1);
  });

  it('declines to rank at all in a division with too few teams to rank against', () => {
    const tiny = league(['one', 'two'], 3);
    const measured = measure({
      trainingName: 'one',
      side: 'home',
      history: tiny,
      rest: RESTED,
    });
    expect(measured.underlying_strength?.value).toBeNull();
    expect(measured.underlying_strength?.note).toContain('teams in this division');
  });
});
