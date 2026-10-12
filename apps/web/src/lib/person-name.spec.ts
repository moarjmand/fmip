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

  it("gives back the feed's short form of the full names T-1398 writes", () => {
    // Each pair: the short form the feed printed, the full name the people
    // names job writes from the profile (D-213). A list shows the short form
    // again; the player's own page shows the full name.
    const written: Array<[string, string]> = [
      ['M. Salah', 'Mohamed Salah'],
      ['E. Haaland', 'Erling Haaland'],
      ['K. De Bruyne', 'Kevin De Bruyne'],
      ['V. van Dijk', 'Virgil van Dijk'],
      ['T. Alexander-Arnold', 'Trent Alexander-Arnold'],
      ['R. Araújo', 'Ronald Araújo'],
      ["P. O'Neill", "Patrick O'Neill"],
      ['J. Mateta', 'Jean-Philippe Mateta'],
      ['S. Ødegaard', 'Sander Ødegaard'],
    ];
    for (const [short, full] of written) expect(listName('en', full)).toBe(short);
    // Several initials (about 1 % of short forms): only the first given name is
    // shortened, since a list cannot tell a second given name from a surname.
    expect(listName('en', 'António Sérgio Vaz dos Ramos')).toBe('A. Sérgio Vaz dos Ramos');
  });

  it('keeps every name as stored on a Persian page', () => {
    expect(listName('fa', 'Mohamed Salah')).toBe('Mohamed Salah');
  });
});
