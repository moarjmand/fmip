/**
 * The filters' one way of comparing names (T-1433; its own module since
 * T-1643, D-301): the competitions menu folds the words typed in the
 * reader's browser, and this file is all it carries there for that.
 */

/**
 * A name as the filter compares it: case folded, Arabic and Persian letter
 * variants made one (ي/ی, ك/ک, ة/ه, the hamza seats), diacritics, the
 * tatweel and the zero-width non-joiner removed, so «ليگ» finds «لیگ» and
 * "Ligue" finds "LIGUE" -- and "Atletico" finds "Atlético".
 */
export function foldName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟـ‌‍]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ی')
    .toLocaleLowerCase('en')
    .replace(/\s+/g, ' ')
    .trim();
}
