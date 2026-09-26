import { describe, expect, it } from 'vitest';
import {
  MIN_OTHER_TEAMS,
  coachContinuity,
  measureLineup,
  measureStability,
  positionAmong,
  xiContinuity,
  type SeasonMatch,
  type SquadContext,
} from './internal/power-index-squad';

/**
 * T-112, D-081: the two Power Index components our own match records reach.
 * Each is a position among the competition's teams, never points, and each
 * says what it could not measure rather than inventing a middle value.
 */

const day = (n: number) => new Date(Date.UTC(2026, 7, n));
const xi = (team: string, from = 0) => Array.from({ length: 11 }, (_, i) => `${team}-p${from + i}`);

/** Six teams, one match each, team `t<k>`'s starters rated `5 + k/10`. */
function league(extra: Partial<SquadContext> = {}): SquadContext {
  const matches = new Map<string, SeasonMatch[]>();
  const ratings = new Map<string, number>();
  for (let k = 0; k < 6; k += 1) {
    const team = `t${k}`;
    matches.set(team, [{ kickoffAt: day(20), coachId: `c${k}`, starters: xi(team) }]);
    for (const id of xi(team)) ratings.set(id, 5 + k / 10);
  }
  return { matches, ratings, confirmed: new Map(), out: new Map(), ...extra };
}

describe('positions', () => {
  it('counts the others below, ties at half', () => {
    expect(positionAmong(3, [1, 2, 3, 4])).toBe(0.625);
    expect(positionAmong(0, [1, 2])).toBe(0);
  });
});

describe('line-up quality', () => {
  it('places the expected XI -- the last one -- among every other team’s', () => {
    const top = measureLineup(league(), 't5');
    expect(top.value).toBe(1);
    expect(top.state).toBe('limited');
    expect(top.note).toContain('expected');
    expect(measureLineup(league(), 't0').value).toBe(0);
  });

  it('uses the announced XI when there is one, and calls it available when every starter is rated', () => {
    const context = league();
    // t0 names the strongest team's rated players: its XI now outranks everyone.
    context.confirmed.set('t0', xi('t5'));
    const measured = measureLineup(context, 't0');
    expect(measured.state).toBe('available');
    expect(measured.note).toContain('announced');
    expect(measured.value).toBeCloseTo(positionAmong(5.5, [5.1, 5.2, 5.3, 5.4, 5.5]), 6);
  });

  it('takes the players reported out off the expected XI, and says how many', () => {
    const context = league();
    context.out.set('t3', ['t3-p0', 't3-p1']);
    const measured = measureLineup(context, 't3');
    expect(measured.note).toContain('less 2 reported out');
    expect(measured.value).not.toBeNull();
  });

  it('declines when too few starters are rated, or too few teams to rank against', () => {
    const unrated = league();
    for (const id of xi('t2').slice(0, 5)) unrated.ratings.delete(id);
    expect(measureLineup(unrated, 't2')).toMatchObject({ value: null });

    const small = league();
    for (const team of ['t1', 't2', 't3']) small.matches.delete(team);
    expect(MIN_OTHER_TEAMS).toBe(5);
    expect(measureLineup(small, 't0').value).toBeNull();
  });
});

describe('stability', () => {
  it('reads a coach’s run and how much of the XI carries over', () => {
    const matches: SeasonMatch[] = [
      { kickoffAt: day(1), coachId: 'old', starters: xi('a') },
      { kickoffAt: day(8), coachId: 'new', starters: xi('a', 1) },
      { kickoffAt: day(15), coachId: 'new', starters: xi('a', 1) },
    ];
    expect(coachContinuity(matches)).toBeCloseTo(2 / 3, 6);
    // 10 of 11 kept, then all 11.
    expect(xiContinuity(matches)).toBeCloseTo((10 / 11 + 1) / 2, 6);
    expect(xiContinuity(matches.slice(0, 1))).toBeNull();
  });

  it('places both halves among the competition and averages them', () => {
    const context = league();
    // Give everyone a second match; t5 changes its coach and its whole XI.
    for (const [team, list] of context.matches) {
      const changed = team === 't5';
      list.push({
        kickoffAt: day(27),
        coachId: changed ? 'someone-else' : `c${team.slice(1)}`,
        starters: changed ? xi(team, 20) : xi(team),
      });
    }
    const unsettled = measureStability(context, 't5');
    expect(unsettled).toMatchObject({ value: 0, state: 'available' });
    const settled = measureStability(context, 't0');
    expect(settled.value).toBeGreaterThan(0.5);
  });

  it('uses the coach alone, and says so, when no XI carries over yet', () => {
    const measured = measureStability(league(), 't0');
    expect(measured.state).toBe('limited');
    expect(measured.note).toContain('coach');
    expect(measured.value).toBe(0.5);
  });
});
