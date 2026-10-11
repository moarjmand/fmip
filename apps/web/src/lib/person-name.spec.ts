import { describe, expect, it } from 'vitest';
import { listName } from './person-name';

describe('listName (T-1395): one name style on a match page', () => {
  it("shortens a full Latin name to the feed's initial-and-surname style", () => {
    expect(listName('en', 'Mohamed Salah')).toBe('M. Salah');
    expect(listName('en', 'Kevin De Bruyne')).toBe('K. De Bruyne');
    expect(listName('en', 'Jean-Philippe Mateta')).toBe('J. Mateta');
    expect(listName('en', 'Martin Ødegaard')).toBe('M. Ødegaard');
  });

  it('leaves a name already in that style, or a single name, as it is', () => {
    expect(listName('en', 'M. Salah')).toBe('M. Salah');
    expect(listName('en', 'V. van Dijk')).toBe('V. van Dijk');
    expect(listName('en', 'Rodri')).toBe('Rodri');
    expect(listName('en', 'van Dijk')).toBe('van Dijk');
  });

  it('never mangles a name it cannot read safely', () => {
    expect(listName('en', 'Vinícius Júnior')).toBe('Vinícius Júnior');
    expect(listName('en', 'Player 7')).toBe('Player 7');
    expect(listName('en', 'محمد صلاح')).toBe('محمد صلاح');
    expect(listName('en', 'Алексей Миранчук')).toBe('Алексей Миранчук');
  });

  it('keeps every name as stored on a Persian page', () => {
    expect(listName('fa', 'Mohamed Salah')).toBe('Mohamed Salah');
  });
});
