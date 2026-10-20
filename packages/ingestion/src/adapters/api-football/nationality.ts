/**
 * API-Football's spellings of a nationality that differ from the name our
 * `country` row carries, each to its FIFA trigram (T-1428, D-220). A
 * reviewed list, not a guess: a spelling missing here is matched by the
 * store to a country of exactly that name or left unmatched, and the
 * unmatched spelling is recorded so this list can grow.
 *
 * Keys are folded by `foldCountry`, so case, accents, hyphens and
 * apostrophes do not matter ("Cote d'Ivoire" and "Côte-d’Ivoire" are one key).
 */

import { foldCountry } from '../../country-name';

const SPELLINGS: Record<string, string> = {
  bosnia: 'BIH',
  'brunei darussalam': 'BRU',
  'cape verde islands': 'CPV',
  'cabo verde': 'CPV',
  'china pr': 'CHN',
  'congo dr': 'COD',
  'dr congo': 'COD',
  'democratic republic of the congo': 'COD',
  'czech republic': 'CZE',
  'east timor': 'TLS',
  'fyr macedonia': 'MKD',
  macedonia: 'MKD',
  holland: 'NED',
  'hong kong china': 'HKG',
  'ivory coast': 'CIV',
  'ir iran': 'IRN',
  'korea dpr': 'PRK',
  'korea republic': 'KOR',
  'kyrgyz republic': 'KGZ',
  macao: 'MAC',
  'republic of ireland': 'IRL',
  'st kitts and nevis': 'SKN',
  'st lucia': 'LCA',
  'st vincent and the grenadines': 'VIN',
  swaziland: 'SWZ',
  'sao tome e principe': 'STP',
  'the gambia': 'GAM',
  turkey: 'TUR',
  usa: 'USA',
  'united states of america': 'USA',
};

/** The FIFA trigram for one of the provider's spellings, or `null` when it is not listed. */
export function nationalityCode(name: string): string | null {
  return SPELLINGS[foldCountry(name)] ?? null;
}
