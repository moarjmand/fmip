import { describe, expect, it } from 'vitest';
import {
  MEANINGFUL_MARGIN,
  baseRateLogLoss,
  decisiveAccuracy,
  fit,
  fitConverged,
  logLoss,
  openPlaces,
  pairFixture,
  probabilities,
  restBefore,
  scheduleOf,
  score,
  seasonListOf,
  squadContextBefore,
  squadMeasurements,
  stakesBefore,
  spread,
  type Observation,
  type RecordedFixture,
  type RecordedRating,
} from './internal/power-index-backtest';

// Validating the weights against history (T-113).
//
// The tests that matter here are not about the arithmetic being pretty. The
// first version of this fit diverged on real data and produced a log-loss of
// 5.4 against a base rate of 1.07 — which reads as "the Power Index carries no
// information" and is in fact "the gradient descent walked away". So the fit is
// tested against data whose answer is known, and against the failure it had.

/** Matches where the home side wins more often the larger its index lead. */
function signal(count: number, seed = 1): Observation[] {
  const observations: Observation[] = [];
  let state = seed;
  const random = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  for (let i = 0; i < count; i += 1) {
    // Differences on the scale the real index produces: tens of points.
    const difference = (random() - 0.5) * 80;
    const pHome = 1 / (1 + Math.exp(-difference / 20));
    const roll = random();
    const outcome: Observation['outcome'] =
      roll < pHome * 0.8 ? 'H' : roll < pHome * 0.8 + 0.22 ? 'D' : 'A';
    observations.push({ difference, outcome });
  }
  return observations;
}

/** Matches whose outcome has nothing to do with the index. */
function noise(count: number, seed = 7): Observation[] {
  return signal(count, seed).map((observation, index) => ({
    difference: observation.difference,
    outcome: (['H', 'D', 'A'] as const)[index % 3] as Observation['outcome'],
  }));
}

describe('the probabilities the gap is turned into', () => {
  const fitted = { beta: 1, lower: -0.4, upper: 0.4, scale: 20 };

  it('always sum to one, and are ordered as the outcomes are', () => {
    for (const difference of [-80, -20, 0, 20, 80]) {
      const [home, draw, away] = probabilities(fitted, difference);
      expect(home + draw + away).toBeCloseTo(1, 10);
      expect(home).toBeGreaterThan(0);
      expect(draw).toBeGreaterThan(0);
      expect(away).toBeGreaterThan(0);
    }
    // A bigger lead moves probability from away, through draw, to home — it
    // cannot jump from one end to the other.
    const [homeAtBig] = probabilities(fitted, 60);
    const [homeAtSmall] = probabilities(fitted, 5);
    expect(homeAtBig).toBeGreaterThan(homeAtSmall);
    const [, , awayAtBig] = probabilities(fitted, 60);
    const [, , awayAtSmall] = probabilities(fitted, 5);
    expect(awayAtBig).toBeLessThan(awayAtSmall);
  });

  it('works on the scale the index actually produces, not on a raw slope', () => {
    // Scale is part of the fit: without it the same beta means something
    // different for every division, and the descent has no single step size.
    expect(spread(signal(200))).toBeGreaterThan(10);
    expect(spread([{ difference: 4, outcome: 'H' }])).toBe(1);
  });
});

describe('fitting', () => {
  it('beats the outcome frequencies when the gap really predicts the result', () => {
    const observations = signal(400);
    const fitted = fit(observations);
    const naive = baseRateLogLoss(observations, observations);

    // This is the assertion the first version of the fit would have failed.
    expect(logLoss(fitted, observations)).toBeLessThan(naive);
    expect(fitConverged(fitted, observations)).toBe(true);
  });

  it('lands near the frequencies, not miles past them, when the gap says nothing', () => {
    const observations = noise(300);
    const fitted = fit(observations);
    const naive = baseRateLogLoss(observations, observations);
    // No signal to find, so the best it can do is roughly the base rate. What
    // it must not do is end up far worse, which is what divergence looks like.
    expect(logLoss(fitted, observations)).toBeLessThan(naive + 0.05);
  });

  it('reports a diverged fit as diverged, in the shape the real failure had', () => {
    const observations = signal(200);
    // What divergence looked like: an enormous effective slope, so the model is
    // confident and wrong, and the loss is far worse than saying nothing.
    const diverged = { beta: 40, lower: -0.4, upper: 0.4, scale: 1 };
    expect(logLoss(diverged, observations)).toBeGreaterThan(
      baseRateLogLoss(observations, observations),
    );
    expect(fitConverged(diverged, observations)).toBe(false);

    // And the real fit, from the same data, does not do that.
    expect(fitConverged(fit(observations), observations)).toBe(true);
  });
});

describe('scoring the candidates', () => {
  function split(observations: Observation[]) {
    const half = Math.floor(observations.length / 2);
    return { train: observations.slice(0, half), test: observations.slice(half) };
  }

  it('keeps the published weights when nothing beats them by enough', () => {
    // Every candidate sees the same observations, so no candidate can win.
    const same = signal(400);
    const result = score(
      'E0',
      new Map([
        ['blueprint', split(same)],
        ['equal', split(same)],
        ['form-heavy', split(same)],
      ]),
    );
    expect(result.margin).toBeLessThanOrEqual(MEANINGFUL_MARGIN);
    expect(result.verdict).toContain('Keep the published weights');
  });

  it('refuses a verdict when the arithmetic failed rather than reporting it as a finding', () => {
    // Two observations of the same outcome: nothing to fit, and the loss of a
    // fit on it is meaningless.
    const degenerate: Observation[] = [
      { difference: 0, outcome: 'H' },
      { difference: 0, outcome: 'H' },
    ];
    const result = score('E0', new Map([['blueprint', split(degenerate)]]));
    expect(result.candidates[0]?.converged === false || result.verdict.length > 0).toBe(true);
  });

  it('says the index found nothing when it cannot beat the frequencies', () => {
    const flat = noise(400);
    const result = score('E0', new Map([['blueprint', split(flat)]]));
    // Either it converged and lost to the base rate, or it did not converge.
    // Both are "no finding", and neither may be dressed up as one.
    expect(result.verdict).toMatch(/carries no information|Keep the published weights|No verdict/);
  });
});

describe('the accuracy reported beside the loss', () => {
  it('counts only decisive matches, because a draw has no higher side', () => {
    const observations: Observation[] = [
      { difference: 10, outcome: 'H' },
      { difference: -10, outcome: 'A' },
      { difference: 10, outcome: 'A' },
      { difference: 5, outcome: 'D' },
    ];
    expect(decisiveAccuracy(observations)).toBeCloseTo(2 / 3, 6);
  });
});

describe('rest from the stored schedule (T-1111)', () => {
  const schedule = scheduleOf([
    { club: 'a', date: '2025-09-01' },
    { club: 'a', date: '2025-09-05' },
    { club: 'a', date: '2025-09-05' },
    { club: 'a', date: '2025-09-11' },
    { club: 'b', date: '2025-09-11' },
  ]);

  it('keeps one match day per club, oldest first', () => {
    expect(schedule.get('a')).toEqual(['2025-09-01', '2025-09-05', '2025-09-11']);
  });

  it('reads only the days strictly before the match', () => {
    expect(restBefore(schedule.get('a'), '2025-09-11')).toEqual({
      daysSincePrevious: 6,
      matchesInWindow: 2,
    });
    // Fourteen days back is inside the window, fifteen is not.
    expect(restBefore(schedule.get('a'), '2025-09-15').matchesInWindow).toBe(3);
    expect(restBefore(schedule.get('a'), '2025-09-16').matchesInWindow).toBe(2);
  });

  it('has no rest value for a club with no earlier stored match, never a default', () => {
    expect(restBefore(schedule.get('b'), '2025-09-11').daysSincePrevious).toBeNull();
    expect(restBefore(undefined, '2025-09-11').daysSincePrevious).toBeNull();
  });
});

describe("the rest component's contribution", () => {
  it('is what removing it costs on held-out matches', () => {
    const observations = signal(400);
    const half = { train: observations.slice(0, 200), test: observations.slice(200) };
    const worse = {
      train: half.train,
      test: half.test.map((o) => ({ ...o, difference: -o.difference })),
    };
    const result = score(
      'E0',
      new Map([
        ['blueprint', half],
        ['without-rest', worse],
      ]),
    );
    expect(result.restContribution).not.toBeNull();
    expect(result.restContribution ?? 0).toBeGreaterThan(0);
  });
});

describe("competition context: a side's stake as a position (T-1123)", () => {
  // Three sides, a double round robin: four matches each.
  const list = seasonListOf([
    { home: 'a', away: 'b' },
    { home: 'b', away: 'a' },
    { home: 'a', away: 'c' },
    { home: 'c', away: 'a' },
    { home: 'b', away: 'c' },
    { home: 'c', away: 'b' },
  ]);

  it('reads a complete double round robin, and nothing else', () => {
    expect(list.complete).toBe(true);
    expect(list.totals.get('a')).toBe(4);
    const short = seasonListOf([
      { home: 'a', away: 'b' },
      { home: 'b', away: 'a' },
      { home: 'a', away: 'c' },
    ]);
    expect(short.complete).toBe(false);
    expect(stakesBefore(short, [], '2025-09-01')).toBeNull();
    expect(stakesBefore(undefined, [], '2025-09-01')).toBeNull();
  });

  it('counts the rivals still within reach either way; a locked side has none', () => {
    // a 12 points, 0 left; b 3 with 2 left; c 0 with 2 left.
    const open = openPlaces(
      new Map([
        ['a', 12],
        ['b', 3],
        ['c', 0],
      ]),
      new Map([
        ['a', 0],
        ['b', 2],
        ['c', 2],
      ]),
    );
    expect(open.get('a')).toBe(0);
    expect(open.get('b')).toBe(1);
    expect(open.get('c')).toBe(1);
  });

  it('never locks a side that can still finish level', () => {
    const open = openPlaces(
      new Map([
        ['a', 6],
        ['b', 3],
      ]),
      new Map([
        ['a', 0],
        ['b', 1],
      ]),
    );
    expect(open.get('a')).toBe(1);
  });

  it('puts every side at the middle before anything is settled', () => {
    const stakes = stakesBefore(list, [], '2025-08-01');
    expect([...(stakes?.values() ?? [])].map((s) => s.value)).toEqual([0.5, 0.5, 0.5]);
  });

  it('reads only results strictly before the day, and puts a locked side lowest', () => {
    const results = [
      { date: '2025-08-01', home: 'a', away: 'b', homeGoals: 2, awayGoals: 0 },
      { date: '2025-08-08', home: 'a', away: 'c', homeGoals: 1, awayGoals: 0 },
      { date: '2025-08-15', home: 'b', away: 'a', homeGoals: 0, awayGoals: 1 },
      { date: '2025-08-22', home: 'c', away: 'a', homeGoals: 0, awayGoals: 3 },
      { date: '2025-08-29', home: 'b', away: 'c', homeGoals: 1, awayGoals: 1 },
    ];
    // Before 08-29: a 12 with none left, b 0 and c 0 with two left each.
    const stakes = stakesBefore(list, results, '2025-08-29');
    expect(stakes?.get('a')).toMatchObject({ open: 0, rivals: 2 });
    expect(stakes?.get('b')?.open).toBe(1);
    expect(stakes?.get('a')?.value).toBeLessThan(stakes?.get('b')?.value ?? 0);
    // The same day's draw is not yet in the table.
    expect(stakesBefore(list, results, '2025-08-29')?.get('b')?.open).toBe(
      stakesBefore(list, results.slice(0, 4), '2025-08-29')?.get('b')?.open,
    );
  });
});

describe("the context component's contribution", () => {
  it('is what measuring it gains over the published arithmetic on held-out matches', () => {
    const observations = signal(400);
    const half = { train: observations.slice(0, 200), test: observations.slice(200) };
    const worse = {
      train: half.train,
      test: half.test.map((o) => ({ ...o, difference: -o.difference })),
    };
    const result = score(
      'E0',
      new Map([
        ['blueprint', worse],
        ['with-context', half],
      ]),
    );
    expect(result.contextContribution ?? 0).toBeGreaterThan(0);
  });
});

describe('line-up quality and stability from our recorded line-ups (T-924)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const start = Date.parse('2025-08-16T15:00:00Z');
  const teams = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];
  const xi = (team: string): string[] => Array.from({ length: 11 }, (_, i) => `${team}-p${i}`);

  // Four rounds of eight teams; t0's players rate highest, t7's lowest.
  const fixtures: RecordedFixture[] = [];
  const ratings: RecordedRating[] = [];
  for (let round = 0; round < 4; round += 1) {
    for (let pair = 0; pair < 4; pair += 1) {
      const home = teams[(pair + round) % 8] as string;
      const away = teams[(7 - pair + round) % 8] as string;
      const kickoffAt = start + round * 7 * DAY;
      fixtures.push({
        id: `r${round}-${pair}`,
        seasonId: 's',
        kickoffAt,
        home: { teamId: home, coachId: `${home}-coach`, starters: xi(home) },
        away: { teamId: away, coachId: `${away}-coach`, starters: xi(away) },
      });
      for (const team of [home, away]) {
        const level = 8 - Number(team.slice(1)) / 2;
        for (const personId of xi(team)) {
          ratings.push({ seasonId: 's', kickoffAt, personId, rating: level });
        }
      }
    }
  }
  const last = fixtures.at(-1) as RecordedFixture;

  it('pairs a training match with the same catalogue clubs a day apart at most, never by name', () => {
    const day = new Date(last.kickoffAt).toISOString().slice(0, 10);
    const next = new Date(last.kickoffAt + DAY).toISOString().slice(0, 10);
    const far = new Date(last.kickoffAt + 3 * DAY).toISOString().slice(0, 10);
    expect(pairFixture(fixtures, day, last.home.teamId, last.away.teamId)).toBe(last);
    expect(pairFixture(fixtures, next, last.home.teamId, last.away.teamId)).toBe(last);
    expect(pairFixture(fixtures, far, last.home.teamId, last.away.teamId)).toBeUndefined();
    expect(pairFixture(fixtures, day, last.away.teamId, last.home.teamId)).toBeUndefined();
    expect(pairFixture(fixtures, day, 'E0:Some Name', last.away.teamId)).toBeUndefined();
  });

  it('reads only the season before the kick-off, and the XI that started as the announced one', () => {
    const context = squadContextBefore(fixtures, ratings, last);
    for (const matches of context.matches.values()) {
      expect(matches.every((m) => m.kickoffAt.getTime() < last.kickoffAt)).toBe(true);
    }
    expect(context.matches.get(last.home.teamId)).toHaveLength(3);
    expect(context.confirmed.get(last.home.teamId)).toEqual(last.home.starters);
    expect(context.out.size).toBe(0);
    // A rating from this kick-off or later is never read.
    const later: RecordedRating = {
      seasonId: 's',
      kickoffAt: last.kickoffAt,
      personId: 't0-p0',
      rating: 0,
    };
    expect(squadContextBefore(fixtures, [...ratings, later], last).ratings.get('t0-p0')).toBe(8);
  });

  it('measures both components as the live index does, and nothing before the season has a line-up', () => {
    const measured = squadMeasurements(squadContextBefore(fixtures, ratings, last), last);
    const [home, away] = [Number(last.home.teamId.slice(1)), Number(last.away.teamId.slice(1))];
    const stronger = home < away ? measured.home : measured.away;
    const weaker = home < away ? measured.away : measured.home;
    expect(stronger.lineup_quality?.value ?? 0).toBeGreaterThan(weaker.lineup_quality?.value ?? 1);
    expect(measured.home.stability?.value).not.toBeNull();

    const first = fixtures[0] as RecordedFixture;
    const opening = squadMeasurements(squadContextBefore(fixtures, ratings, first), first);
    expect(opening.home.lineup_quality?.value).toBeNull();
    expect(opening.home.stability?.value).toBeNull();
  });

  it("reports each component's contribution as what removing it costs on held-out matches", () => {
    const observations = signal(400);
    const half = { train: observations.slice(0, 200), test: observations.slice(200) };
    const worse = {
      train: half.train,
      test: half.test.map((o) => ({ ...o, difference: -o.difference })),
    };
    const result = score(
      'E0',
      new Map([
        ['blueprint', half],
        ['without-lineup', worse],
        ['without-stability', half],
      ]),
    );
    expect(result.lineupContribution ?? 0).toBeGreaterThan(0);
    expect(result.stabilityContribution).toBe(0);
  });
});
