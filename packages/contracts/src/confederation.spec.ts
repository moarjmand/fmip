import { describe, expect, it } from 'vitest';
import {
  CONFEDERATIONS,
  CONFEDERATION_BY_COUNTRY,
  continentalConfederation,
  countryConfederation,
} from './confederation';

describe('the confederation table (T-1643, D-301)', () => {
  it('holds every FIFA member association once, each a FIFA trigram', () => {
    const codes = Object.keys(CONFEDERATION_BY_COUNTRY);
    expect(codes).toHaveLength(211);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{3}$/);
    const sizes = Object.fromEntries(
      CONFEDERATIONS.map((body) => [
        body,
        Object.values(CONFEDERATION_BY_COUNTRY).filter((b) => b === body).length,
      ]),
    );
    expect(sizes).toEqual({ uefa: 55, afc: 46, caf: 54, concacaf: 35, conmebol: 10, ofc: 11 });
  });

  it('places a country by the confederation it plays in, not by its map', () => {
    expect(countryConfederation('ENG')).toBe('uefa');
    expect(countryConfederation('SCO')).toBe('uefa');
    expect(countryConfederation('ISR')).toBe('uefa');
    expect(countryConfederation('KAZ')).toBe('uefa');
    expect(countryConfederation('IRN')).toBe('afc');
    expect(countryConfederation('KSA')).toBe('afc');
    expect(countryConfederation('AUS')).toBe('afc');
    expect(countryConfederation('EGY')).toBe('caf');
    expect(countryConfederation('BRA')).toBe('conmebol');
    expect(countryConfederation('USA')).toBe('concacaf');
    expect(countryConfederation('SUR')).toBe('concacaf');
    expect(countryConfederation('NZL')).toBe('ofc');
  });

  it('reads a code case aside, and says none for no code or one outside the table', () => {
    expect(countryConfederation(' esp ')).toBe('uefa');
    expect(countryConfederation(null)).toBeNull();
    expect(countryConfederation(undefined)).toBeNull();
    expect(countryConfederation('')).toBeNull();
    expect(countryConfederation('XYZ')).toBeNull();
  });
});

describe('continentalConfederation', () => {
  it('is the confederation whose leagues most of the clubs play in', () => {
    expect(
      continentalConfederation([
        { country_code: 'ENG', clubs: 6 },
        { country_code: 'ESP', clubs: 4 },
        { country_code: 'ISR', clubs: 1 },
        // A club of a league we follow outside the region does not move it.
        { country_code: 'KAZ', clubs: 1 },
      ]),
    ).toBe('uefa');
    expect(
      continentalConfederation([
        { country_code: 'KSA', clubs: 3 },
        { country_code: 'IRN', clubs: 2 },
        { country_code: 'QAT', clubs: 2 },
        { country_code: 'ENG', clubs: 1 },
      ]),
    ).toBe('afc');
    // Two bodies of the Americas are two bodies: the larger wins.
    expect(
      continentalConfederation([
        { country_code: 'BRA', clubs: 7 },
        { country_code: 'MEX', clubs: 2 },
      ]),
    ).toBe('conmebol');
  });

  it('says none when no club can be placed, or the top is a tie', () => {
    expect(continentalConfederation([])).toBeNull();
    expect(continentalConfederation([{ country_code: 'XYZ', clubs: 9 }])).toBeNull();
    expect(continentalConfederation([{ country_code: 'ENG', clubs: 0 }])).toBeNull();
    expect(
      continentalConfederation([
        { country_code: 'ENG', clubs: 2 },
        { country_code: 'IRN', clubs: 2 },
      ]),
    ).toBeNull();
  });
});
