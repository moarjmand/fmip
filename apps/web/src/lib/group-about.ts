import type { GroupFavourite } from '@fmip/contracts';

/**
 * A group's language and favourite as a reader meets them (T-1022, D-133).
 *
 * The language is a BCP 47 tag the members write in. Its name is the
 * reader's own language's name for it (`Intl.DisplayNames`), and the tag
 * itself when the runtime has no name for it -- never a guess.
 */
export function languageName(locale: string, tag: string): string {
  try {
    const names = new Intl.DisplayNames([locale, 'en'], { type: 'language' });
    return names.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Where a favourite's own page is: the club's or the competition's (by id, rule 1). */
export function favouriteHref(locale: string, favourite: GroupFavourite): string {
  const kind = favourite.type === 'team' ? 'team' : 'competition';
  return `/${locale}/${kind}/${encodeURIComponent(favourite.id)}`;
}

/** The directory filtered to groups about the same club or competition. */
export function favouriteDirectoryHref(locale: string, favourite: GroupFavourite): string {
  return `/${locale}/groups?${favourite.type}=${encodeURIComponent(favourite.id)}`;
}
