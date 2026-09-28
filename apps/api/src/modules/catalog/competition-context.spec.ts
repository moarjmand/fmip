import type { TableRow } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { tieOf, type BracketFixture } from './internal/bracket';
import { contextTable, phaseOf, standingOf } from './internal/competition-context';

// T-840: the match centre's competition context. Which part of the
// competition a match is in, a side's line with the gaps the table supports,
// and the knockout tie a match belongs to -- never an empty table for a cup.

const team = (id: string) => ({ id, name: id.toUpperCase(), short_name: null });

function row(position: number, id: string, points: number): TableRow {
  return {
    position,
    team: team(id),
    played: 10,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points,
    form: ['W', 'D'],
  };
}

const TABLE = [row(1, 'a', 25), row(2, 'b', 22), row(3, 'c', 22), row(4, 'd', 15)];

describe('phaseOf', () => {
  const base = { stage: null, round: null, groupName: null } as const;

  it('takes the stage kind when our records name one', () => {
    const stage = (kind: string) => ({
      ...base,
      competitionKind: 'cup' as const,
      stage: { id: 's', kind },
    });
    expect(phaseOf(stage('league'))).toEqual({ kind: 'league' });
    expect(phaseOf({ ...stage('group'), groupName: 'B' })).toEqual({
      kind: 'group',
      stageId: 's',
      groupName: 'B',
    });
    for (const kind of ['knockout', 'playoff', 'qualifying']) {
      expect(phaseOf(stage(kind))).toEqual({ kind: 'knockout' });
    }
  });

  it("reads a stage-less match from the competition, then the round's words", () => {
    expect(phaseOf({ ...base, competitionKind: 'league' })).toEqual({ kind: 'league' });
    expect(phaseOf({ ...base, competitionKind: 'cup', round: 'League Stage - 3' })).toEqual({
      kind: 'league',
    });
    expect(
      phaseOf({ ...base, competitionKind: 'cup', round: 'Group C - 2', groupName: 'C' }),
    ).toEqual({
      kind: 'group',
      stageId: null,
      groupName: 'C',
    });
    expect(phaseOf({ ...base, competitionKind: 'cup', round: 'Round of 16' })).toEqual({
      kind: 'knockout',
    });
    expect(phaseOf({ ...base, competitionKind: 'super_cup', round: null })).toEqual({
      kind: 'knockout',
    });
  });

  it('gives a friendly no competition context', () => {
    expect(phaseOf({ ...base, competitionKind: 'friendly', round: 'Round of 16' })).toEqual({
      kind: 'none',
    });
  });
});

describe('standingOf', () => {
  it('states the gaps to first, to the place above and over the place below', () => {
    expect(standingOf(TABLE, 'c')).toMatchObject({
      position: 3,
      points: 22,
      points_from_top: 3,
      points_to_place_above: 0,
      points_clear_of_place_below: 7,
      form: ['W', 'D'],
    });
  });

  it('has no place above the leader and none below the last', () => {
    expect(standingOf(TABLE, 'a')).toMatchObject({
      points_from_top: 0,
      points_to_place_above: null,
      points_clear_of_place_below: 3,
    });
    expect(standingOf(TABLE, 'd')).toMatchObject({
      points_from_top: 10,
      points_to_place_above: 7,
      points_clear_of_place_below: null,
    });
  });

  it('is null for a side not in the table', () => {
    expect(standingOf(TABLE, 'z')).toBeNull();
  });
});

describe('contextTable', () => {
  const at = '2086-03-01T12:00:00.000Z';
  const table = { coverage: 'available' as const, last_updated_at: at, data: TABLE };

  it('carries both sides, the leader, and never a guessed qualification place', () => {
    const out = contextTable(
      { table, counted: 20, teams: 4, declared: 'available' },
      'league',
      null,
      'b',
      'd',
    );
    expect(out.coverage).toBe('available');
    expect(out.data).toMatchObject({
      scope: 'league',
      matches_counted: 20,
      teams: 4,
      leader: { team: { id: 'a' }, points: 25 },
      home: { position: 2 },
      away: { position: 4 },
      places: 'not_supplied',
    });
  });

  it('is limited when a side is missing from a table that has rows', () => {
    const out = contextTable(
      { table, counted: 20, teams: 4, declared: 'available' },
      'league',
      null,
      'b',
      'z',
    );
    expect(out.coverage).toBe('limited');
    expect(out.data?.away).toBeNull();
  });

  it('says a declared table has not started, with no positions, before its first match', () => {
    const none = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
    const out = contextTable(
      { table: none, counted: 0, teams: 4, declared: 'available' },
      'group',
      'A',
      'a',
      'b',
    );
    expect(out).toEqual({
      coverage: 'available',
      last_updated_at: null,
      data: {
        scope: 'group',
        group_name: 'A',
        places: 'not_supplied',
        matches_counted: 0,
        teams: 4,
        leader: null,
        home: null,
        away: null,
      },
    });
  });

  it('is the absence itself when nothing is declared and nothing is played', () => {
    const none = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
    expect(
      contextTable({ table: none, counted: 0, teams: 4, declared: null }, 'league', null, 'a', 'b'),
    ).toEqual(none);
    const delayed = { coverage: 'delayed' as const, last_updated_at: null, data: null };
    expect(
      contextTable(
        { table: delayed, counted: 0, teams: 4, declared: 'delayed' },
        'league',
        null,
        'a',
        'b',
      ).coverage,
    ).toBe('delayed');
  });
});

describe('tieOf', () => {
  let seq = 0;
  function fixture(
    round: string | null,
    kickoff: string,
    home: string,
    away: string,
    score: [number, number] | null,
  ): BracketFixture {
    seq += 1;
    return {
      id: `f${seq}`,
      kickoff_at: `${kickoff}T20:00:00.000Z`,
      status: score === null ? 'scheduled' : 'finished',
      round,
      stage: null,
      leg: null,
      home: team(home),
      away: team(away),
      score: score === null ? null : { home: score[0], away: score[1] },
      after_extra_time: false,
      penalties: null,
    };
  }

  it('finds both legs of a continental tie and its aggregate once both are played', () => {
    const first = fixture('Round of 16', '2027-03-03', 'a', 'b', [2, 1]);
    const second = fixture('Round of 16', '2027-03-10', 'b', 'a', [1, 1]);
    const other = fixture('Round of 16', '2027-03-04', 'c', 'd', [0, 0]);
    const earlier = fixture('League Stage - 1', '2026-09-16', 'a', 'b', [0, 3]);
    const found = tieOf([earlier, first, other, second], second.id, {
      continental: true,
      stageLegs: null,
    });
    expect(found?.roundKey).toBe('round_of_16');
    expect(found?.legs).toBe(2);
    expect(found?.tie.legs.map((l) => l.fixture_id)).toEqual([first.id, second.id]);
    expect(found?.tie.aggregate).toEqual([3, 2]);
    expect(found?.tie.winner?.id).toBe('a');
  });

  it('shows the first leg of a tie whose second is not played, undecided', () => {
    const first = fixture('Round of 16', '2027-03-03', 'a', 'b', [2, 1]);
    const second = fixture('Round of 16', '2027-03-10', 'b', 'a', null);
    const found = tieOf([first, second], second.id, { continental: true, stageLegs: null });
    expect(found?.tie.legs).toHaveLength(2);
    expect(found?.tie.aggregate).toBeNull();
    expect(found?.tie.winner).toBeNull();
  });

  it("takes a domestic cup's legs from its stage, else two held matches, else judges nothing", () => {
    const single = fixture('3rd Round', '2027-01-10', 'a', 'b', [2, 0]);
    expect(tieOf([single], single.id, { continental: false, stageLegs: 1 })).toMatchObject({
      roundKey: null,
      legs: 1,
      tie: { winner: { id: 'a' }, decided_by: 'score' },
    });
    // No stage record and one match held: it may have a second leg we lack.
    expect(tieOf([single], single.id, { continental: false, stageLegs: null })).toMatchObject({
      legs: null,
      tie: { aggregate: null, winner: null, decided_by: null },
    });
    const semi1 = fixture('Semi-finals', '2027-02-01', 'a', 'b', [1, 0]);
    const semi2 = fixture('Semi-finals', '2027-03-01', 'b', 'a', [0, 0]);
    expect(tieOf([semi1, semi2], semi1.id, { continental: false, stageLegs: null })).toMatchObject({
      legs: 2,
      tie: { aggregate: [1, 0], decided_by: 'aggregate' },
    });
  });

  it('is null for a fixture not among those given', () => {
    expect(tieOf([], 'nope', { continental: false, stageLegs: null })).toBeNull();
  });
});
