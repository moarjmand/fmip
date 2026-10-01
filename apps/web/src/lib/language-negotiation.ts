/**
 * The language a first request is sent to when the reader has not chosen one
 * (T-1310, D-175): the first language in their browser's `Accept-Language`
 * that the product offers, else none. Only the language subtag is compared,
 * so `fa-IR` asks for Persian; quality values order the list, and `q=0`
 * refuses a language.
 */
export function negotiatedLanguage(
  acceptLanguage: string | null,
  offered: readonly string[],
): string | null {
  if (acceptLanguage === null || acceptLanguage.trim() === '') return null;
  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number(q);
      return {
        language: tag.trim().toLowerCase().split('-')[0] ?? '',
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .filter((entry) => entry.language !== '' && entry.language !== '*' && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const entry of ranked) {
    if (offered.includes(entry.language)) return entry.language;
  }
  return null;
}
