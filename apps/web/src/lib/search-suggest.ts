import type { EntityMedia, SearchEntityType, SearchResponse } from '@fmip/contracts';
import { SEARCH_ENTITY_TYPES } from '@fmip/contracts';
import type { EntityImageKind } from '@/components/entity-image';
import type { SearchSuggestWords } from '@/components/search-combobox';
import { DEFAULT_LOCALE, isPseudoLocale } from '@/i18n/locales';
import { type MessageKey, message } from '@/i18n/messages';
import { pageLocale } from '@/lib/competition';
import {
  MIN_QUERY_LENGTH,
  RESULT_IMAGE_KIND,
  SECTION_TITLE_KEY,
  resultHref,
  resultLine,
} from '@/lib/search';

/**
 * The suggestions under a search field while a reader types (T-1844, D-435):
 * teams, competitions and players only, at most six, grouped by kind in the
 * results page's order. Built on the server, in the route the field asks
 * (`/api/search/suggest`), so the client receives words and links, never the
 * catalogues or a provider's field (rules 2, T-1040).
 */

/** Rows shown at most, across the groups. */
export const SUGGEST_LIMIT = 6;
/** Rows asked of `GET /search`: more than shown, so the people a word does not start can be left out. */
export const SUGGEST_FETCH = 12;
/** The longest term the API takes (`QUERY_MAX_LENGTH`). */
export const SUGGEST_MAX_LENGTH = 64;

export interface SuggestRow {
  type: SearchEntityType;
  id: string;
  name: string;
  /** The second line (a team's league or place, a competition's country, a player's club); null when none is on record. */
  line: string | null;
  href: string;
  image: EntityMedia | null;
  imageKind: EntityImageKind;
}

export interface SuggestGroup {
  type: SearchEntityType;
  heading: string;
  /** Set when the heading is the English standing in for an untranslated one. */
  headingLang: string | null;
  rows: SuggestRow[];
}

export interface SuggestAnswer {
  term: string;
  groups: SuggestGroup[];
}

/** The term as the API takes it, or null when it is too short or too long to ask. */
export function suggestTerm(raw: string | null): string | null {
  const term = (raw ?? '').trim().replace(/\s+/g, ' ');
  return term.length < MIN_QUERY_LENGTH || term.length > SUGGEST_MAX_LENGTH ? null : term;
}

/** The `GET /search` query for a term, names in the reader's language (T-1312; a pseudo-locale reads English). */
export function suggestApiQuery(term: string, locale: string): string {
  const lang = pageLocale(locale);
  const names = isPseudoLocale(lang) ? DEFAULT_LOCALE : lang;
  return (
    `q=${encodeURIComponent(term)}&types=${SEARCH_ENTITY_TYPES.join(',')}` +
    `&limit=${SUGGEST_FETCH}&locale=${encodeURIComponent(names)}`
  );
}

/** Latin letters NFD does not take apart, as `unaccent` writes them (Ødegaard, Błaszczykowski, Großkreutz). */
const LETTERS: Record<string, string> = {
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  ħ: 'h',
  ı: 'i',
  ŀ: 'l',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
};

/**
 * Lower case, accents off, the letters NFD keeps whole spelled out, Arabic
 * letter forms as Persian writes them, and the marks inside a word
 * (apostrophes, the zero-width non-joiner) dropped rather than read as a
 * break ("N'Golo" is "ngolo", a Persian name joined by the non-joiner is read as one word): close enough to
 * the API's `search_key()` to compare word starts.
 */
export function foldForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[øłđðħıŀßæœþ]/g, (c) => LETTERS[c] ?? c)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/['’ʼ`\u200c\u200d]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether the text is written in Latin letters (any of them). */
function isLatin(text: string): boolean {
  return /\p{Script=Latin}/u.test(text);
}

/**
 * Whether some word of the name starts with the term, read word by word
 * ("lionel messi" for "messi", "manchester united" for "manchester un").
 * The designer's decision 4 (D-435): a player is suggested only so, since
 * a fuzzy near miss ("Preijs" for "premier") reads as a mistake in a short
 * list; the results page keeps every match.
 */
export function startsAWord(name: string, term: string): boolean {
  // A name shown in another script than the term was matched by its
  // canonical spelling, which the answer does not carry ("messi" on the
  // Persian site finds «لیونل مسی»): nothing here can say it does not start.
  if (isLatin(name) !== isLatin(term)) return true;
  const words = foldForMatch(name).split(' ');
  const wanted = foldForMatch(term)
    .split(' ')
    .filter((w) => w !== '');
  if (wanted.length === 0) return false;
  // Every word of the term starts a word of the name, in order.
  let from = 0;
  for (const w of wanted) {
    const at = words.findIndex((word, i) => i >= from && word.startsWith(w));
    if (at < 0) return false;
    from = at + 1;
  }
  return true;
}

/**
 * The answer's groups: the API's best matches in its order, players only
 * where a word of the name or the matched alias starts with the term, cut to
 * {@link SUGGEST_LIMIT}, then grouped team, competition, player. A group
 * with nothing in it is left out.
 */
export function buildSuggestions(
  locale: string,
  term: string,
  found: SearchResponse,
): SuggestAnswer {
  const lang = pageLocale(locale);
  const kept = found.results
    .filter(
      (hit) =>
        hit.type !== 'person' ||
        startsAWord(hit.name, term) ||
        (hit.alias !== null && startsAWord(hit.alias, term)),
    )
    .slice(0, SUGGEST_LIMIT);
  const groups: SuggestGroup[] = [];
  for (const type of SEARCH_ENTITY_TYPES) {
    const rows = kept
      .filter((hit) => hit.type === type)
      .map((hit) => {
        const line = resultLine(lang, hit);
        return {
          type,
          id: hit.id,
          name: hit.name,
          line: line.length === 0 ? null : line.join(' · '),
          href: resultHref(lang, hit),
          image: hit.image ?? null,
          imageKind: RESULT_IMAGE_KIND[type],
        };
      });
    if (rows.length === 0) continue;
    const heading = message(lang, SECTION_TITLE_KEY[type]);
    groups.push({
      type,
      heading: heading.text,
      headingLang: heading.status === 'untranslated' ? 'en' : null,
      rows,
    });
  }
  return { term, groups };
}

/** The keys the field's list says, resolved for the reader on the server (T-1040). */
const SUGGEST_WORD_KEYS = {
  list: 'searchSuggest.list',
  seeAll: 'searchSuggest.seeAll',
  alsoSearches: 'searchSuggest.alsoSearches',
  none: 'searchSuggest.none',
  unavailable: 'searchSuggest.unavailable',
  loading: 'searchSuggest.loading',
  count: 'searchSuggest.count',
} as const satisfies Record<keyof SearchSuggestWords, MessageKey>;

/** The list's words in the reader's locale, the English marked where it stands in. */
export function suggestWords(locale: string): SearchSuggestWords {
  const lang = pageLocale(locale);
  const words = {} as SearchSuggestWords;
  for (const [slot, key] of Object.entries(SUGGEST_WORD_KEYS) as [
    keyof SearchSuggestWords,
    MessageKey,
  ][]) {
    const m = message(lang, key);
    words[slot] = m.status === 'untranslated' ? { text: m.text, lang: 'en' } : { text: m.text };
  }
  return words;
}
