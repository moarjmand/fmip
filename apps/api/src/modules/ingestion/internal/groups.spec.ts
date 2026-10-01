import { describe, expect, it } from 'vitest';
import { groupMembers } from './groups';

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
