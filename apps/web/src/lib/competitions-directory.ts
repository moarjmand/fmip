import type { CompetitionDirectoryEntry } from '@fmip/contracts';

/**
 * The competitions directory's pure choices (T-1433): what the header's
 * competitions bar shows, how the All competitions page groups every
 * competition, and what its filter matches. The list arrives in the
 * product's order (D-207) with names in the reader's language (T-1312).
 */

/** How many competitions the bar names before "All competitions" covers the rest. */
export const BAR_COMPETITIONS = 12;

/** The bar's competitions: the first `BAR_COMPETITIONS` of the product's order. */
export function barCompetitions(
  list: readonly CompetitionDirectoryEntry[],
  size = BAR_COMPETITIONS,
): CompetitionDirectoryEntry[] {
  return list.slice(0, size);
}

/** The bar's label for a competition: its short form when it has one in this language. */
export function barName(entry: Pick<CompetitionDirectoryEntry, 'name' | 'short_name'>): string {
  return entry.short_name ?? entry.name;
}

/** One group on the page: the world, a continent's competitions, or one country. */
export interface DirectoryGroup {
  /** `international`, `continental`, or the country's id. */
  key: string;
  kind: 'international' | 'continental' | 'country';
  /** The country's name in the reader's language; `null` for the two region groups. */
  name: string | null;
  competitions: CompetitionDirectoryEntry[];
}

/**
 * The page's groups: international competitions first, then continental
 * ones, then one group per country. A country with a competition in the
 * product's order comes in that order (its first competition's place);
 * the countries with none follow by their name in the reader's language.
 * Inside a group the product's order holds. A competition without a
 * country that is neither continental nor international (none today) is
 * filed with the international ones rather than dropped.
 */
export function directoryGroups(
  list: readonly CompetitionDirectoryEntry[],
  locale: string,
): DirectoryGroup[] {
  const international: CompetitionDirectoryEntry[] = [];
  const continental: CompetitionDirectoryEntry[] = [];
  const countries = new Map<string, DirectoryGroup & { placed: boolean }>();
  for (const entry of list) {
    if (entry.scope === 'continental' && entry.country === null) {
      continental.push(entry);
      continue;
    }
    if (entry.country === null) {
      international.push(entry);
      continue;
    }
    const group = countries.get(entry.country.id) ?? {
      key: entry.country.id,
      kind: 'country' as const,
      name: entry.country.name,
      competitions: [],
      placed: false,
    };
    group.placed ||= entry.order !== null;
    group.competitions.push(entry);
    countries.set(entry.country.id, group);
  }
  const all = [...countries.values()];
  const placed = all.filter((g) => g.placed);
  const collator = new Intl.Collator(locale);
  const rest = all
    .filter((g) => !g.placed)
    .sort((a, b) => collator.compare(a.name ?? '', b.name ?? ''));
  return [
    ...(international.length > 0
      ? [
          {
            key: 'international',
            kind: 'international' as const,
            name: null,
            competitions: international,
          },
        ]
      : []),
    ...(continental.length > 0
      ? [
          {
            key: 'continental',
            kind: 'continental' as const,
            name: null,
            competitions: continental,
          },
        ]
      : []),
    ...[...placed, ...rest].map(({ placed: _placed, ...group }) => group),
  ];
}

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

/**
 * Whether a competition answers the filter: its name, its short form or its
 * country's name contains every word typed, in any order. An empty filter
 * matches everything.
 */
export function matchesFilter(
  entry: CompetitionDirectoryEntry,
  groupName: string | null,
  filter: string,
): boolean {
  const words = foldName(filter).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldName(
    [entry.name, entry.short_name ?? '', entry.country?.name ?? '', groupName ?? ''].join(' '),
  );
  return words.every((word) => haystack.includes(word));
}
