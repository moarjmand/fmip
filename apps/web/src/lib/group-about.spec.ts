import { describe, expect, it } from 'vitest';
import { favouriteDirectoryHref, favouriteHref, languageName } from './group-about';

describe("a group's language and favourite (T-1022)", () => {
  it("names a language in the reader's language, and falls back to the tag", () => {
    expect(languageName('en', 'pt-BR')).toMatch(/Portuguese/);
    expect(languageName('en', 'fa')).toBe('Persian');
    // A tag the runtime cannot name is shown as the tag, never a guess.
    expect(languageName('en', 'not a tag')).toBe('not a tag');
  });

  it('links a favourite by its id, never its name', () => {
    const team = { type: 'team' as const, id: 'a1b2', name: 'Some Club' };
    const competition = { type: 'competition' as const, id: 'c3d4', name: 'Some League' };
    expect(favouriteHref('en', team)).toBe('/en/team/a1b2');
    expect(favouriteHref('en', competition)).toBe('/en/competition/c3d4');
    expect(favouriteDirectoryHref('en', team)).toBe('/en/groups?team=a1b2');
    expect(favouriteDirectoryHref('en', competition)).toBe('/en/groups?competition=c3d4');
  });
});
