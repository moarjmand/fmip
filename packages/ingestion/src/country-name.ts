/**
 * How two spellings of a country's name compare (T-1428, D-220): lower case,
 * no accents, every run of anything but letters and digits one space, so
 * "Côte d'Ivoire", "Cote-d’Ivoire" and "COTE D IVOIRE" are one name.
 */
export function foldCountry(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
