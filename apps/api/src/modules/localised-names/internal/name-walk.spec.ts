import { describe, expect, it } from 'vitest';
import { namedIds, withNames } from './name-walk';

const TEAM = '00000000-0000-4000-8000-000000000604';
const COMP = '00000000-0000-4000-8000-000000000201';

const answer = () => ({
  groups: [
    {
      competition: { id: COMP, name: 'Pro League', short_name: 'PGPL' },
      fixtures: [
        {
          id: 'not-a-uuid',
          home: { id: TEAM.toUpperCase(), name: 'Persepolis', short_name: 'PER' },
        },
      ],
    },
  ],
  // A page's own entity keeps its canonical name beside the localised one (T-303).
  team: { id: TEAM, name: 'Persepolis', localised_name: 'پرسپولیس' },
});

describe('localised names walk (T-1312)', () => {
  it('finds each named entity once, by UUID, and skips page entities', () => {
    expect(namedIds(answer()).sort()).toEqual([COMP, TEAM].sort());
  });

  it('puts the names into a copy, drops the English short form, and leaves the answer alone', () => {
    const original = answer();
    const out = withNames(original, new Map([[TEAM, 'پرسپولیس']]));
    expect(out.groups[0]!.fixtures[0]!.home).toEqual({
      id: TEAM.toUpperCase(),
      name: 'پرسپولیس',
      short_name: null,
    });
    expect(out.groups[0]!.competition).toEqual(original.groups[0]!.competition);
    expect(out.team.name).toBe('Persepolis');
    expect(original.groups[0]!.fixtures[0]!.home.name).toBe('Persepolis');
  });

  it('answers the same object when there is nothing to replace', () => {
    const original = answer();
    expect(withNames(original, new Map())).toBe(original);
  });
});
