import {
  type CompetitionDirectoryEntry,
  type Confederation,
  type ScoresGroup,
  type ScoresResponse,
  countryConfederation,
} from '@fmip/contracts';
import { type RailStatus, railStatus, railStatusText } from '@/lib/matchday-rail';

/**
 * The competitions menu's rules (T-1643, D-301), pure so they are
 * unit-tested (`competitions-menu.spec.ts`); `components/competitions-menu.tsx`
 * fetches and draws. The menu shows every competition at once, grouped by
 * region, each with what it is doing today -- the matchday rail's status
 * rules (D-292 item 2), plus a mark for a league whose matches today are
 * all over.
 *
 * Server-side only: it reads `@fmip/contracts`, which stays off the client
 * (T-808). What the client needs to filter is in `competitions-menu-state.ts`.
 */

/** A group of the menu, in reading order: the desktop's columns top to bottom, then left to right (start to end). */
export const MENU_REGIONS = [
  'big-five',
  'european-cups',
  'europe',
  'cups',
  'national',
  'asia',
  'americas',
  'africa',
  'oceania',
  'other',
] as const;
export type MenuRegion = (typeof MENU_REGIONS)[number];

/**
 * The desktop panel's columns (the approved canvas, R2·1): the big five and
 * the European cups; More of Europe across two tracks; the domestic cups and
 * the national teams; then the rest of the world, with any competition the
 * data cannot place last.
 */
export const MENU_COLUMNS: readonly (readonly MenuRegion[])[] = [
  ['big-five', 'european-cups'],
  ['europe'],
  ['cups', 'national'],
  ['asia', 'americas', 'africa', 'oceania', 'other'],
];

/** The big five's countries by FIFA trigram: England, Spain, Italy, Germany, France. */
export const BIG_FIVE: readonly string[] = ['ENG', 'ESP', 'ITA', 'GER', 'FRA'];

const REGION_OF: Record<Confederation, MenuRegion> = {
  uefa: 'europe',
  afc: 'asia',
  caf: 'africa',
  concacaf: 'americas',
  conmebol: 'americas',
  ofc: 'oceania',
};

/**
 * A competition's confederation: the API's (D-301), else -- an older answer
 * without the field -- a domestic one's by its country. A continental one
 * without the API's word has none: its name is never read for it (rule 1).
 */
export function confederationOf(entry: CompetitionDirectoryEntry): Confederation | null {
  if (entry.confederation !== undefined) return entry.confederation;
  return entry.scope === 'domestic' ? countryConfederation(entry.country?.code) : null;
}

/**
 * The group a competition is filed under. National teams (scope
 * international) together, whatever the continent; a domestic cup or super
 * cup with the domestic cups; a big-five country's first league (`firstLeague`)
 * with the big five; a continental competition of UEFA with the European
 * cups; everything else by its confederation's region -- and `other` when
 * the data does not say, never a guess (rule 3).
 */
export function menuRegion(entry: CompetitionDirectoryEntry, firstLeague: boolean): MenuRegion {
  if (entry.scope === 'international') return 'national';
  if (entry.scope === 'domestic' && (entry.kind === 'cup' || entry.kind === 'super_cup')) {
    return 'cups';
  }
  if (
    firstLeague &&
    entry.scope === 'domestic' &&
    entry.kind === 'league' &&
    BIG_FIVE.includes(entry.country?.code ?? '')
  ) {
    return 'big-five';
  }
  const body = confederationOf(entry);
  if (body === null) return 'other';
  if (entry.scope === 'continental' && body === 'uefa') return 'european-cups';
  return REGION_OF[body];
}

/** The product's order (D-207): a stated place first, lowest first; then by name in the reader's language. */
function productOrder(locale: string) {
  const collator = new Intl.Collator(locale);
  return (a: CompetitionDirectoryEntry, b: CompetitionDirectoryEntry): number =>
    (a.order === b.order ? 0 : a.order === null ? 1 : b.order === null ? -1 : a.order - b.order) ||
    collator.compare(a.name, b.name);
}

export interface MenuGroupOf<T> {
  region: MenuRegion;
  competitions: T[];
}

/**
 * Every competition in its group, the groups in `MENU_REGIONS` order and
 * none empty; inside a group the product's order, then the name. The big
 * five are the top flights: the first league of each of the five countries
 * in that order (the catalogue keeps no tier for them), so the Championship
 * is with More of Europe, not beside the Premier League.
 */
export function menuGroups<T extends CompetitionDirectoryEntry>(
  list: readonly T[],
  locale: string,
): MenuGroupOf<T>[] {
  const sorted = [...list].sort(productOrder(locale));
  const seen = new Set<string>();
  const byRegion = new Map<MenuRegion, T[]>();
  for (const entry of sorted) {
    const code = entry.country?.code ?? '';
    const league = entry.scope === 'domestic' && entry.kind === 'league';
    const first = league && BIG_FIVE.includes(code) && !seen.has(code);
    if (first) seen.add(code);
    const region = menuRegion(entry, first);
    byRegion.set(region, [...(byRegion.get(region) ?? []), entry]);
  }
  return MENU_REGIONS.flatMap((region) => {
    const competitions = byRegion.get(region);
    return competitions === undefined ? [] : [{ region, competitions }];
  });
}

/** A match that will not change today any more. */
const OVER = new Set(['finished', 'awarded', 'postponed', 'cancelled', 'abandoned']);

/**
 * A competition's one status in the menu: the rail's (`railStatus`: live
 * with a count, the next kick-off later today, the next match day, or
 * none), and `finished` for one whose matches today are all over with at
 * least one played -- "FT", then its next match day when one is known.
 */
export type MenuStatus =
  RailStatus | { kind: 'finished'; next: Extract<RailStatus, { kind: 'day' }> | null };

export function menuStatus(
  today: ScoresGroup | null,
  nextKickoff: string | null | undefined,
  now: number,
  timeZone: string,
): MenuStatus {
  const status = railStatus(today, nextKickoff, now, timeZone);
  if (status.kind === 'live' || status.kind === 'later') return status;
  const fixtures = today?.fixtures ?? [];
  const over =
    fixtures.length > 0 &&
    fixtures.every((card) => OVER.has(card.status)) &&
    fixtures.some((card) => card.status === 'finished' || card.status === 'awarded');
  if (!over) return status;
  return { kind: 'finished', next: status.kind === 'day' ? status : null };
}

/**
 * A status in the reader's words, or `null` for none: the rail's ("2 live",
 * "20:00", "Sat", "7 Nov"), and for `finished` the full-time word with the
 * next match day after it when known.
 */
export function menuStatusText(
  status: MenuStatus,
  locale: string,
  timeZone: string,
  now: number,
  words: { live: (count: number) => string; finished: string },
): { text: string; next: string | null } | null {
  if (status.kind === 'finished') {
    return {
      text: words.finished,
      next:
        status.next === null
          ? null
          : railStatusText(status.next, locale, timeZone, now, words.live),
    };
  }
  const text = railStatusText(status, locale, timeZone, now, words.live);
  return text === null ? null : { text, next: null };
}

/** Today's group of each competition that plays today, by competition id. */
export function todayGroups(scores: ScoresResponse | null): Map<string, ScoresGroup> {
  const groups = new Map<string, ScoresGroup>();
  for (const group of scores?.groups ?? []) {
    if (group.fixtures.length > 0 && !groups.has(group.competition.id)) {
      groups.set(group.competition.id, group);
    }
  }
  return groups;
}

/** How many competitions are live now, play today, and are listed in all: the panel's line and its toggles. */
export function menuCounts(rows: readonly { live: boolean; today: boolean }[]): {
  live: number;
  today: number;
  all: number;
} {
  return {
    live: rows.filter((row) => row.live).length,
    today: rows.filter((row) => row.today).length,
    all: rows.length,
  };
}
