import { describe, expect, it } from 'vitest';
import {
  batchBody,
  deriveMatchEvents,
  eventLine,
  keyEvents,
  scorerOf,
  type MatchIncident,
  type MatchState,
} from './internal/match-events';
import { composeBatch } from './match-alerts.service';

// The event derivation and its keys (T-830, D-096), as pure functions over two
// readings of one match. The database path is `match-alerts.http.spec.ts`.

const F = '00000000-0000-4000-8000-00000000f830';
const TEAMS = { home: 'Arsenal', away: 'Chelsea' };

function state(
  status: string,
  score: [number, number] | null,
  incidents: MatchIncident[] = [],
): MatchState {
  return {
    status,
    score: score === null ? null : { home: score[0], away: score[1] },
    incidents,
  };
}

function incident(
  sequence: number,
  kind: string,
  side: 'home' | 'away' | null,
  name: string | null,
  minute: number,
  addedTime: number | null = null,
): MatchIncident {
  return {
    sequence,
    kind,
    side,
    personId: name === null ? null : `person-${name}`,
    personName: name,
    minute,
    addedTime,
  };
}

describe('deriving events from two readings', () => {
  it('raises a kick-off only on the move from scheduled to live', () => {
    expect(deriveMatchEvents(state('scheduled', null), state('live', [0, 0]))).toEqual([
      { kind: 'kickoff' },
    ]);
    // A match already live the first time the job reads it is not kicking off.
    expect(deriveMatchEvents(state('live', [0, 0]), state('live', [0, 0]))).toEqual([]);
  });

  it("keys a goal by the side's count, so two goals in one tick invent no order", () => {
    expect(deriveMatchEvents(state('live', [0, 0]), state('live', [1, 1]))).toEqual([
      { kind: 'goal', side: 'home', count: 1 },
      { kind: 'goal', side: 'away', count: 1 },
    ]);
    expect(deriveMatchEvents(state('live', [1, 0]), state('live', [3, 0]))).toEqual([
      { kind: 'goal', side: 'home', count: 2 },
      { kind: 'goal', side: 'home', count: 3 },
    ]);
  });

  it('reads a score that went down as a withdrawn goal', () => {
    expect(deriveMatchEvents(state('live', [2, 0]), state('live', [1, 0]))).toEqual([
      { kind: 'goal_void', side: 'home', count: 2 },
    ]);
  });

  it('raises a red card once per player, from either card', () => {
    const red = incident(3, 'red_card', 'away', 'James', 67);
    const second = incident(4, 'second_yellow_card', 'home', 'Rice', 80);
    const before = state('live', [1, 0], [red]);
    const after = state('live', [1, 0], [red, second, { ...red, sequence: 5 }]);
    expect(deriveMatchEvents(before, after)).toEqual([{ kind: 'red_card', incident: second }]);
  });

  it('raises half-time only when the feed says the match is at the interval', () => {
    expect(
      deriveMatchEvents(state('live', [1, 0]), state('live', [1, 0]), { halfTimeBreak: true }),
    ).toEqual([{ kind: 'half_time' }]);
    // A feed that does not say is not guessed at.
    expect(deriveMatchEvents(state('live', [1, 0]), state('live', [1, 0]))).toEqual([]);
  });

  it('raises full-time on the move from live to finished, with the last goal before it', () => {
    expect(deriveMatchEvents(state('live', [1, 0]), state('finished', [2, 0]))).toEqual([
      { kind: 'goal', side: 'home', count: 2 },
      { kind: 'full_time' },
    ]);
  });

  it('raises nothing for a match that was never in play here', () => {
    // A backfill writing a finished match, or a postponement.
    expect(deriveMatchEvents(state('scheduled', null), state('finished', [3, 1]))).toEqual([]);
    expect(deriveMatchEvents(state('scheduled', null), state('postponed', null))).toEqual([]);
  });
});

describe('keys: one per event, whatever the feed does', () => {
  it('drops an event this match already has, so a retry or a replay reaches nobody twice', () => {
    const history = new Set<string>();
    const first = keyEvents(
      F,
      [{ kind: 'kickoff' }, { kind: 'goal', side: 'home', count: 1 }],
      history,
    );
    expect(first.map((e) => e.key)).toEqual([`${F}:kickoff`, `${F}:goal:home:1#1`]);
    const again = keyEvents(
      F,
      [{ kind: 'kickoff' }, { kind: 'goal', side: 'home', count: 1 }],
      history,
    );
    expect(again).toEqual([]);
  });

  it('turns a withdrawn goal into a correction that names the goal, once', () => {
    const history = new Set([`${F}:goal:home:1#1`]);
    const [correction] = keyEvents(F, [{ kind: 'goal_void', side: 'home', count: 1 }], history);
    expect(correction).toMatchObject({
      key: `${F}:goal-void:home:1#1`,
      kind: 'match_goal',
      withdraws: `${F}:goal:home:1#1`,
    });
    expect(keyEvents(F, [{ kind: 'goal_void', side: 'home', count: 1 }], history)).toEqual([]);
  });

  it('sends no correction for a goal nobody was told about', () => {
    expect(keyEvents(F, [{ kind: 'goal_void', side: 'away', count: 2 }], new Set())).toEqual([]);
  });

  it('treats a goal given, withdrawn and given again as a new goal', () => {
    const history = new Set<string>();
    const goal = { kind: 'goal' as const, side: 'home' as const, count: 1 };
    const voided = { kind: 'goal_void' as const, side: 'home' as const, count: 1 };
    const keys = [
      ...keyEvents(F, [goal], history),
      ...keyEvents(F, [voided], history),
      ...keyEvents(F, [goal], history),
      ...keyEvents(F, [goal], history),
    ].map((e) => e.key);
    expect(keys).toEqual([`${F}:goal:home:1#1`, `${F}:goal-void:home:1#1`, `${F}:goal:home:1#2`]);
  });

  it('keys a red card by the player, and half-time and full-time once each', () => {
    const red = incident(3, 'red_card', 'away', 'James', 67);
    const keyed = keyEvents(
      F,
      [{ kind: 'red_card', incident: red }, { kind: 'half_time' }, { kind: 'full_time' }],
      new Set(),
    );
    expect(keyed.map((e) => [e.key, e.kind])).toEqual([
      [`${F}:red:person-James`, 'match_red_card'],
      [`${F}:half-time`, 'match_half_time'],
      [`${F}:full-time`, 'match_full_time'],
    ]);
  });
});

describe('the scorer: named when the incidents say so, never guessed', () => {
  const saka = incident(1, 'goal', 'home', 'Saka', 23);
  const palmer = incident(2, 'penalty_goal', 'away', 'Palmer', 45, 2);

  it('names the nth goal of the side when its goals match its score', () => {
    expect(scorerOf(state('live', [1, 1], [saka, palmer]), 'away', 1)).toBe(palmer);
  });

  it('names nobody when the incidents are behind the score', () => {
    expect(scorerOf(state('live', [2, 1], [saka, palmer]), 'home', 2)).toBeNull();
  });

  it('names nobody in a match with an own goal, whose side a feed may credit either way', () => {
    const own = incident(3, 'own_goal', 'away', 'Colwill', 70);
    expect(scorerOf(state('live', [2, 1], [saka, palmer, own]), 'away', 1)).toBeNull();
  });

  it('writes the line with the scorer where known and without one where not', () => {
    const after = state('live', [1, 1], [saka, palmer]);
    expect(eventLine({ kind: 'goal', side: 'away', count: 1 }, TEAMS, after)).toBe(
      "Goal for Chelsea (Palmer 45+2', penalty): Arsenal 1–1 Chelsea.",
    );
    expect(eventLine({ kind: 'goal', side: 'home', count: 2 }, TEAMS, state('live', [2, 1]))).toBe(
      'Goal for Arsenal: Arsenal 2–1 Chelsea.',
    );
    expect(eventLine({ kind: 'goal_void', side: 'home', count: 2 }, TEAMS, after)).toBe(
      'Goal disallowed for Arsenal: Arsenal 1–1 Chelsea.',
    );
  });
});

describe('the other lines', () => {
  it('says what happened with the score as it stands', () => {
    const red = incident(3, 'second_yellow_card', 'away', 'James', 67);
    const after = state('live', [1, 0], [red]);
    expect(eventLine({ kind: 'kickoff' }, TEAMS, state('live', [0, 0]))).toBe(
      'Kick-off: Arsenal v Chelsea.',
    );
    expect(eventLine({ kind: 'red_card', incident: red }, TEAMS, after)).toBe(
      "Red card: James (Chelsea) 67', second yellow. Arsenal 1–0 Chelsea.",
    );
    expect(eventLine({ kind: 'half_time' }, TEAMS, after)).toBe('Half-time: Arsenal 1–0 Chelsea.');
    expect(eventLine({ kind: 'full_time' }, TEAMS, state('finished', null))).toBe(
      'Full-time: Arsenal v Chelsea.',
    );
  });
});

describe('one push for a burst', () => {
  const due = (id: string, fixture: string, headline: string) => ({
    id,
    user_id: 'member',
    kind: 'match_goal',
    subject_type: 'fixture',
    subject_id: fixture,
    subject_label: null,
    source: null,
    headline,
    email: 'm@example.test',
    locale: 'en',
  });

  it('shows the first lines and how many more', () => {
    expect(batchBody(['a', 'b', 'c', 'd', 'e'])).toBe('a\nb\nc\n+2 more');
    expect(batchBody(['a'])).toBe('a');
  });

  it('opens the match when every alert is about one, and the inbox otherwise', () => {
    const one = composeBatch([due('1', F, 'Goal A.'), due('2', F, 'Full-time.')]);
    expect(one?.push).toEqual({
      userId: 'member',
      title: 'FMIP',
      body: 'Goal A.\nFull-time.',
      url: `/en/match/${F}`,
    });
    // A match alert does not go by e-mail (D-096).
    expect(one?.email).toBeNull();
    const two = composeBatch([due('1', F, 'Goal A.'), due('2', 'other', 'Goal B.')]);
    expect(two?.push?.url).toBe('/en/notifications');
  });
});
