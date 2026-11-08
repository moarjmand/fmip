import { describe, expect, it } from 'vitest';
import { type FirstStepsInput, firstSteps, settledProgress, showsProgress } from './first-steps';

/** A member who has just registered: nothing read is anything yet. */
const NEW: FirstStepsInput = {
  settled: 0,
  predictions: 0,
  followsTeam: false,
  favouriteTeams: 0,
  bio: null,
};

const done = (input: FirstStepsInput) =>
  Object.fromEntries(firstSteps(input).steps.map((step) => [step.id, step.done]));

describe('the first steps (T-1787, D-390)', () => {
  it('lists a pick, a team and a bio, in that order, none done for a new member', () => {
    const { steps, shown } = firstSteps(NEW);
    expect(steps.map((step) => step.id)).toEqual(['pick', 'follow', 'bio']);
    expect(steps.every((step) => !step.done)).toBe(true);
    expect(shown).toBe(true);
  });

  it('ticks the pick on a stored prediction, or on a settled one when the history could not be read', () => {
    expect(done({ ...NEW, predictions: 1 }).pick).toBe(true);
    expect(done({ ...NEW, predictions: null, settled: 2 }).pick).toBe(true);
    expect(done({ ...NEW, predictions: null }).pick).toBe(false);
  });

  it('ticks the team on a followed team, and on a favourite when the follows could not be read', () => {
    expect(done({ ...NEW, followsTeam: true }).follow).toBe(true);
    // A favourite is a followed team, but the follows' own answer wins when there is one.
    expect(done({ ...NEW, followsTeam: false, favouriteTeams: 1 }).follow).toBe(false);
    expect(done({ ...NEW, followsTeam: null, favouriteTeams: 1 }).follow).toBe(true);
    expect(done({ ...NEW, followsTeam: null }).follow).toBe(false);
  });

  it('ticks the bio only when it has words', () => {
    expect(done({ ...NEW, bio: 'Weekend picks.' }).bio).toBe(true);
    expect(done({ ...NEW, bio: '   ' }).bio).toBe(false);
  });

  it('keeps the card until there is a settled pick and every step is done', () => {
    const all = { ...NEW, predictions: 3, followsTeam: true, bio: 'Hi' };
    expect(firstSteps(all).shown).toBe(true);
    expect(firstSteps({ ...all, settled: 1 }).shown).toBe(false);
    expect(firstSteps({ ...all, settled: 1, bio: null }).shown).toBe(true);
    // A rating that could not be read is not a settled pick.
    expect(firstSteps({ ...all, settled: null }).shown).toBe(true);
  });
});

describe('the way to the floor', () => {
  it('counts the settled picks against the floor it is given, never a typed one', () => {
    expect(settledProgress(0, 30)).toEqual({ count: 0, floor: 30, percent: 0 });
    expect(settledProgress(7, 30)).toEqual({ count: 7, floor: 30, percent: 23 });
    expect(settledProgress(12, 40)).toEqual({ count: 12, floor: 40, percent: 30 });
  });

  it('never fills past the end', () => {
    expect(settledProgress(45, 30).percent).toBe(100);
    expect(settledProgress(-1, 30).count).toBe(0);
  });

  it('is drawn under the floor and not from it', () => {
    expect(showsProgress(0, 30)).toBe(true);
    expect(showsProgress(29, 30)).toBe(true);
    expect(showsProgress(30, 30)).toBe(false);
  });
});
