import type { Territory } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { territoryName, territoryOptions, territoryValue } from './territory';

const SOME: Territory[] = [
  { code: 'ZA', name: 'South Africa' },
  { code: 'DE', name: 'Germany' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AX', name: 'Åland Islands' },
];

describe('territoryName', () => {
  it("names a territory in the reader's language from the platform's own region names", () => {
    expect(territoryName('en', { code: 'DE', name: 'Germany' })).toBe('Germany');
    expect(territoryName('de', { code: 'DE', name: 'Germany' })).toBe('Deutschland');
    expect(territoryName('fr', { code: 'GB', name: 'United Kingdom' })).toBe('Royaume-Uni');
  });

  it("falls back to the API's name for a locale or a code the platform cannot name", () => {
    expect(territoryName('x-rtl', { code: 'GB', name: 'United Kingdom' })).toBe('United Kingdom');
    expect(territoryName('en', { code: 'QQ', name: 'Somewhere' })).toBe('Somewhere');
  });
});

describe('territoryOptions', () => {
  it("puts the empty choice first as a sentence, then the territories sorted in the reader's language", () => {
    const options = territoryOptions('en', SOME, 'Not chosen yet');
    expect(options[0]).toEqual({ value: '', label: 'Not chosen yet' });
    expect(options.slice(1).map((o) => o.label)).toEqual([
      'Åland Islands',
      'Germany',
      'South Africa',
      'United Kingdom',
    ]);
    // German sorts and names differently, and the order follows the names shown.
    const german = territoryOptions('de', SOME, 'Noch nicht gewählt').slice(1);
    expect(german.map((o) => o.value)).toEqual(['AX', 'DE', 'ZA', 'GB']);
    expect(german.map((o) => o.label)).toEqual([
      'Ålandinseln',
      'Deutschland',
      'Südafrika',
      'Vereinigtes Königreich',
    ]);
  });
});

describe('territoryValue', () => {
  it('is the code when chosen and the empty choice when not', () => {
    expect(territoryValue({ state: 'chosen', territory: SOME[2]! })).toBe('GB');
    expect(territoryValue({ state: 'not_chosen' })).toBe('');
  });
});
