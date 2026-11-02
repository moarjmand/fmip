import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_PERSON_NAMES, isPlaceholderPersonName } from './placeholder-name';

describe('a line-up label that names nobody (T-1707, D-342)', () => {
  it.each([
    'Trialist',
    'TRIALIST',
    ' trialist ',
    'Unknown',
    'Unknown  Player',
    'TBA',
    'tbc',
    'TBD',
    'N/A',
    '-',
    '?',
  ])('treats %j as a placeholder', (name) => {
    expect(isPlaceholderPersonName(name)).toBe(true);
  });

  it('treats an empty or missing name as a placeholder', () => {
    expect(isPlaceholderPersonName('')).toBe(true);
    expect(isPlaceholderPersonName('   ')).toBe(true);
    expect(isPlaceholderPersonName(null)).toBe(true);
    expect(isPlaceholderPersonName(undefined)).toBe(true);
  });

  it.each([
    'Mohamed Ali',
    'Kiko Bondoso',
    'Giannis Michailidis',
    'Ali Unknown',
    'Tbaraki',
    'Trialists FC',
    'J. Bellingham',
  ])('keeps %j a person', (name) => {
    expect(isPlaceholderPersonName(name)).toBe(false);
  });

  it('keeps the list small and in its compared form', () => {
    expect(PLACEHOLDER_PERSON_NAMES.length).toBeLessThanOrEqual(12);
    for (const label of PLACEHOLDER_PERSON_NAMES) {
      expect(label).toBe(label.trim().replace(/\s+/g, ' ').toLowerCase());
    }
  });
});
