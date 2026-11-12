import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_STEPS,
  NAME_WRAP,
  NARROW_STEPS,
  PHONE_STEPS,
  ROW_STEPS,
  longestWord,
  nameFit,
  statusFit,
  widthStep,
} from './word-fit';

/** A name or a status word is whole, never broken inside a word (T-1796, D-395). */
describe('word-fit', () => {
  it('counts the letters of the longest word, split at spaces and hyphens', () => {
    expect(longestWord('Mönchengladbach')).toBe(15);
    expect(longestWord('Borussia Mönchengladbach')).toBe(15);
    expect(longestWord('Paris Saint-Germain')).toBe(7);
    expect(longestWord('Awaiting update')).toBe(8);
    expect(longestWord('')).toBe(0);
  });

  it('steps the width down only for a word longer than the cell holds', () => {
    // The phone row holds about twelve letters (107px at 375).
    expect(widthStep('Bournemouth', 12)).toBe(0);
    expect(widthStep('Wolverhampton Wanderers', 12)).toBe(1);
    expect(widthStep('Mönchengladbach', 12)).toBe(2);
    // The band holds about ten (96px): "Erzurumspor" steps once.
    expect(widthStep('Erzurumspor', 10)).toBe(1);
    expect(widthStep('Rizespor', 10)).toBe(0);
  });

  it('writes each step as a whole class for its scope', () => {
    expect(nameFit('Liverpool', 12, ROW_STEPS)).toBe('');
    expect(nameFit('Mönchengladbach', 12, ROW_STEPS)).toBe('@max-xl:font-stretch-condensed');
    expect(nameFit('Erzurumspor', 10, NARROW_STEPS)).toBe('max-md:font-stretch-semi-condensed');
    expect(nameFit('Mönchengladbach', 12, ALL_STEPS)).toBe('font-stretch-condensed');
    expect(nameFit('Mönchengladbach', 11, PHONE_STEPS)).toBe('max-sm:font-stretch-condensed');
  });

  it('sets a status word at 11px and 75%, a time or a minute as before', () => {
    expect(statusFit('Postponed')).toContain('text-[11px]');
    expect(statusFit('Postponed')).toContain('font-stretch-condensed');
    expect(statusFit('Awaiting update')).toContain('text-[11px]');
    expect(statusFit('14:30')).toContain('@xl:text-sm');
    expect(statusFit('FT')).not.toContain('text-[11px]');
    for (const label of ['Postponed', '14:30']) expect(statusFit(label)).toContain(NAME_WRAP);
  });

  it('wraps between words and never hyphenates or breaks anywhere', () => {
    expect(NAME_WRAP).toBe('break-words hyphens-manual');
    const source = readFileSync(join(__dirname, 'word-fit.ts'), 'utf8');
    expect(source).not.toMatch(/hyphens-auto|\[overflow-wrap:anywhere\]|wrap-anywhere/);
  });
});
