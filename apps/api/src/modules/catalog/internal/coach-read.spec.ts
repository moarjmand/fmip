import { describe, expect, it } from 'vitest';
import { currentOpenSpell } from './coach-read';

describe("a team's current coach among the open spells", () => {
  it('is the open spell that started last', () => {
    // Manchester City as recorded on 2026-10-21: Guardiola's spell was never closed.
    expect(
      currentOpenSpell([
        { personId: 'guardiola', start: '2016-07-01' },
        { personId: 'maresca', start: '2026-08-01' },
      ]),
    ).toEqual({ personId: 'maresca', start: '2026-08-01' });
  });

  it('is none when there is no open spell, or two start on the same latest day', () => {
    expect(currentOpenSpell([])).toBeNull();
    expect(
      currentOpenSpell([
        { personId: 'a', start: '2026-08-01' },
        { personId: 'b', start: '2026-08-01' },
        { personId: 'c', start: '2020-01-01' },
      ]),
    ).toBeNull();
  });

  it('counts a spell without a start only when it is the only one', () => {
    expect(currentOpenSpell([{ personId: 'a', start: null }])).toEqual({
      personId: 'a',
      start: null,
    });
    expect(
      currentOpenSpell([
        { personId: 'a', start: null },
        { personId: 'b', start: '2019-01-01' },
      ]),
    ).toEqual({ personId: 'b', start: '2019-01-01' });
    expect(
      currentOpenSpell([
        { personId: 'a', start: null },
        { personId: 'b', start: null },
      ]),
    ).toBeNull();
  });

  it('reads one coach with two open spells at the team as his later one', () => {
    expect(
      currentOpenSpell([
        { personId: 'a', start: '2015-01-01' },
        { personId: 'a', start: '2024-01-01' },
        { personId: 'b', start: '2020-01-01' },
      ]),
    ).toEqual({ personId: 'a', start: '2024-01-01' });
  });
});
