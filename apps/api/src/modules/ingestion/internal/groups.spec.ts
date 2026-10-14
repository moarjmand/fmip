import { describe, expect, it } from 'vitest';
import { groupMembers, groupPlayed } from './groups';

describe('groupPlayed (T-1399)', () => {
  // Argentina: the Apertura and the Clausura each have a group A.
  const ours = [
    { stageId: 'apertura', name: 'A', rows: [{ team: { id: 't1' }, played: 16 }] },
    { stageId: 'clausura', name: 'A', rows: [{ team: { id: 't1' }, played: 12 }] },
    { stageId: 'clausura', name: 'B', rows: [{ team: { id: 't2' }, played: 12 }] },
  ];

  it("reads the provider's group in the stage its table names", () => {
    expect(groupPlayed(ours, { group: 'A', stageId: 'apertura' }).get('t1')).toBe(16);
    expect(groupPlayed(ours, { group: 'A', stageId: 'clausura' }).get('t1')).toBe(12);
    expect(groupPlayed(ours, { group: 'B', stageId: 'apertura' }).size).toBe(0);
  });

  it('reads every group of that name when the table names no stage, as before', () => {
    const one = [ours[0]!, ours[2]!];
    expect(groupPlayed(one, { group: 'A', stageId: null }).get('t1')).toBe(16);
    expect(groupPlayed(one, { group: 'B', stageId: null }).get('t2')).toBe(12);
  });
});

describe('groupMembers (T-1333)', () => {
  it("puts each team of the provider's group tables in its group", () => {
    expect(
      groupMembers([
        { group: 'A', teamIds: ['t1', 't2'] },
        { group: 'B', teamIds: ['t3', 't4'] },
      ]),
    ).toEqual([
      { teamId: 't1', group: 'A' },
      { teamId: 't2', group: 'A' },
      { teamId: 't3', group: 'B' },
      { teamId: 't4', group: 'B' },
    ]);
  });

  it('reads no group from a table that is not one', () => {
    expect(groupMembers([{ group: null, teamIds: ['t1', 't2'] }])).toEqual([]);
  });

  it('puts a team named in two groups in neither, rather than guess', () => {
    expect(
      groupMembers([
        { group: 'A', teamIds: ['t1', 't2'] },
        { group: 'B', teamIds: ['t2', 't3'] },
      ]),
    ).toEqual([
      { teamId: 't1', group: 'A' },
      { teamId: 't3', group: 'B' },
    ]);
  });

  it('keeps a team named twice in the same group', () => {
    // The Nations League's leagues each have a "Group 1": a team is in one.
    expect(
      groupMembers([
        { group: '1', teamIds: ['t1'] },
        { group: '1', teamIds: ['t1', 't2'] },
      ]),
    ).toEqual([
      { teamId: 't1', group: '1' },
      { teamId: 't2', group: '1' },
    ]);
  });
});
