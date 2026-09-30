import type { CoverageState, PlayerPage, PlayerSeasonRecord } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { type MessageKey, plural } from '@/i18n/messages';
import { coverageText, pageLocale, say } from './competition';
import { apiQuery } from './search';

/**
 * Two players compared (blueprint 5.3, T-631): the pure half of the compare
 * page. It lines up both players' records for one season and competition (or
 * everything on record) and decides, figure by figure, whether each side has
 * the number or only a coverage state.
 *
 * The rule the page exists to keep: a figure one of them lacks is a coverage
 * state with a reason, never a zero and never a blank. A player with no record
 * in a competition has not "scored 0" there; we simply hold nothing, and the
 * other side's number is not a comparison against zero.
 */

type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(params: SearchParams, key: string): string | undefined {
  const raw = params[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** The name a page shows: the reader's language, else the known-as name, else the full one. */
export function displayName(person: PlayerPage['person']): string {
  return person.localised_name ?? person.known_as ?? person.full_name;
}

export type CompareWith =
  { state: 'absent' } | { state: 'malformed' } | { state: 'id'; id: string };

/** `?with=<uuid>`: the second player. Absent opens the picker; anything but a UUID is not a player. */
export function readCompareWith(params: SearchParams): CompareWith {
  const raw = first(params, 'with')?.trim();
  if (raw === undefined || raw === '') return { state: 'absent' };
  return UUID.test(raw) ? { state: 'id', id: raw.toLowerCase() } : { state: 'malformed' };
}

/** One season of one competition, the unit both records are kept in. */
export interface CompareScope {
  key: string;
  season: PlayerSeasonRecord['season'];
  competition: PlayerSeasonRecord['competition'];
  /** Whether both players have a record here; a scope only one of them has is still offered. */
  shared: boolean;
}

function scopeKey(seasonId: string, competitionId: string): string {
  return `${seasonId.toLowerCase()}:${competitionId.toLowerCase()}`;
}

/** `?season=&competition=`, both UUIDs, as a scope key; anything else means everything on record. */
export function readScope(params: SearchParams): string | null {
  const season = first(params, 'season');
  const competition = first(params, 'competition');
  if (season === undefined || competition === undefined) return null;
  if (!UUID.test(season) || !UUID.test(competition)) return null;
  return scopeKey(season, competition);
}

function rowsOf(record: PlayerPage['record']): readonly PlayerSeasonRecord[] {
  return record.data ?? [];
}

/**
 * Every season-and-competition either player has a record in, each once,
 * newest season first (by label, numerically), then by competition name.
 */
export function scopesOf(a: PlayerPage['record'], b: PlayerPage['record']): CompareScope[] {
  const keysA = new Set(rowsOf(a).map((r) => scopeKey(r.season.id, r.competition.id)));
  const keysB = new Set(rowsOf(b).map((r) => scopeKey(r.season.id, r.competition.id)));
  const scopes = new Map<string, CompareScope>();
  for (const row of [...rowsOf(a), ...rowsOf(b)]) {
    const key = scopeKey(row.season.id, row.competition.id);
    if (scopes.has(key)) continue;
    scopes.set(key, {
      key,
      season: row.season,
      competition: row.competition,
      shared: keysA.has(key) && keysB.has(key),
    });
  }
  return [...scopes.values()].sort(
    (x, y) =>
      y.season.label.localeCompare(x.season.label, 'en', { numeric: true }) ||
      x.competition.name.localeCompare(y.competition.name, 'en'),
  );
}

/**
 * The scope the page shows: the one asked for when either player has it,
 * else the newest one both share (the blueprint compares within a
 * competition), else everything on record (`null`).
 */
export function resolveScope(
  requested: string | null,
  scopes: readonly CompareScope[],
): CompareScope | null {
  if (requested !== null) {
    const asked = scopes.find((s) => s.key === requested);
    if (asked !== undefined) return asked;
  }
  return scopes.find((s) => s.shared) ?? null;
}

/** The query string that selects a scope on the compare page. */
export function scopeQuery(scope: Pick<CompareScope, 'season' | 'competition'>): string {
  return `season=${encodeURIComponent(scope.season.id)}&competition=${encodeURIComponent(scope.competition.id)}`;
}

export function compareHref(
  locale: string,
  a: string,
  b: string,
  scope?: Pick<CompareScope, 'season' | 'competition'> | null,
): string {
  const base = `/${locale}/player/${encodeURIComponent(a)}/compare?with=${encodeURIComponent(b)}`;
  return scope === undefined || scope === null ? base : `${base}&${scopeQuery(scope)}`;
}

/** "2025/26 · Premier League". */
export function scopeLabel(scope: Pick<CompareScope, 'season' | 'competition'>): string {
  return `${scope.season.label} · ${scope.competition.short_name ?? scope.competition.name}`;
}

/**
 * One side of one figure: a number with the coverage it came under, or a
 * coverage state and why. `partial` (minutes only, T-823): the number is the
 * sum over the matches that carry minutes, `counted` of `of` played, so it
 * reads "at least", never as the whole.
 */
export type CompareCell =
  | {
      coverage: Exclude<CoverageState, 'not_supplied'>;
      value: number;
      partial?: { counted: number; of: number };
    }
  | { coverage: 'not_supplied'; value: null; reason: MessageKey };

/** Why a side has no figure, as catalogue keys (T-1304); the page words them. */
export const REASON = {
  noLineups: 'compare.reason.noLineups',
  notInScope: 'compare.reason.notInScope',
  minutes: 'compare.reason.minutes',
} as const satisfies Record<string, MessageKey>;

type Totals = Pick<
  PlayerSeasonRecord,
  'starts' | 'sub_appearances' | 'goals' | 'assists' | 'yellow_cards' | 'red_cards'
>;

/** Minutes over the scope (T-823): matches played, how many carry minutes, and their sum. */
export interface MinutesTotals {
  matches: number;
  withMinutes: number;
  supplied: number;
}

type Side =
  | {
      held: true;
      coverage: Exclude<CoverageState, 'not_supplied'>;
      totals: Totals;
      minutes: MinutesTotals;
    }
  | { held: false; reason: MessageKey };

/**
 * One player's totals in the scope, summed over teams (a player who moved
 * mid-season has a row per team). A record the API calls `not_supplied`, or
 * no row in the scope, is not a set of zeros.
 */
export function sideTotals(record: PlayerPage['record'], scope: CompareScope | null): Side {
  if (record.data === null || record.coverage === 'not_supplied') {
    return { held: false, reason: REASON.noLineups };
  }
  const rows =
    scope === null
      ? record.data
      : record.data.filter((r) => scopeKey(r.season.id, r.competition.id) === scope.key);
  if (rows.length === 0) {
    return { held: false, reason: scope === null ? REASON.noLineups : REASON.notInScope };
  }
  const totals: Totals = {
    starts: 0,
    sub_appearances: 0,
    goals: 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
  };
  const minutes: MinutesTotals = { matches: 0, withMinutes: 0, supplied: 0 };
  for (const r of rows) {
    minutes.matches += r.minutes.matches;
    minutes.withMinutes += r.minutes.matches_with_minutes;
    minutes.supplied += r.minutes.supplied_minutes;
    totals.starts += r.starts;
    totals.sub_appearances += r.sub_appearances;
    totals.goals += r.goals;
    totals.assists += r.assists;
    totals.yellow_cards += r.yellow_cards;
    totals.red_cards += r.red_cards;
  }
  return { held: true, coverage: record.coverage, totals, minutes };
}

export interface CompareRow {
  key: string;
  label: MessageKey;
  a: CompareCell;
  b: CompareCell;
  /** Which side lacks the figure; `null` when both have it. */
  lacking: 'a' | 'b' | 'both' | null;
}

const FIGURES: readonly {
  key: string;
  label: MessageKey;
  read: ((t: Totals) => number) | null;
}[] = [
  {
    key: 'appearances',
    label: 'compare.figure.appearances',
    read: (t) => t.starts + t.sub_appearances,
  },
  { key: 'starts', label: 'compare.figure.starts', read: (t) => t.starts },
  { key: 'sub_appearances', label: 'compare.figure.offTheBench', read: (t) => t.sub_appearances },
  // Minutes come from the feed, not from starts (T-823): `minutesCell`.
  { key: 'minutes', label: 'compare.figure.minutes', read: null },
  { key: 'goals', label: 'compare.figure.goals', read: (t) => t.goals },
  { key: 'assists', label: 'compare.figure.assists', read: (t) => t.assists },
  { key: 'yellow_cards', label: 'compare.figure.yellowCards', read: (t) => t.yellow_cards },
  { key: 'red_cards', label: 'compare.figure.redCards', read: (t) => t.red_cards },
];

function cell(side: Side, read: ((t: Totals) => number) | null): CompareCell {
  if (!side.held) return { coverage: 'not_supplied', value: null, reason: side.reason };
  if (read === null) return minutesCell(side.coverage, side.minutes);
  return { coverage: side.coverage, value: read(side.totals) };
}

/**
 * Minutes for one side (T-823): the sum when every match played carries
 * them; the sum marked partial -- "at least", `limited` -- when only some
 * do; not supplied when none do. A player who never came on has 0, whole.
 */
export function minutesCell(
  coverage: Exclude<CoverageState, 'not_supplied'>,
  m: MinutesTotals,
): CompareCell {
  if (m.withMinutes >= m.matches) return { coverage, value: m.supplied };
  if (m.withMinutes === 0) return { coverage: 'not_supplied', value: null, reason: REASON.minutes };
  return {
    coverage: 'limited',
    value: m.supplied,
    partial: { counted: m.withMinutes, of: m.matches },
  };
}

/** The figures side by side, each cell a number or a coverage state, never a stand-in zero. */
export function compareRows(
  a: PlayerPage['record'],
  b: PlayerPage['record'],
  scope: CompareScope | null,
): CompareRow[] {
  const sideA = sideTotals(a, scope);
  const sideB = sideTotals(b, scope);
  return FIGURES.map(({ key, label, read }) => {
    const ca = cell(sideA, read);
    const cb = cell(sideB, read);
    const missA = ca.value === null;
    const missB = cb.value === null;
    return {
      key,
      label,
      a: ca,
      b: cb,
      lacking: missA && missB ? 'both' : missA ? 'a' : missB ? 'b' : null,
    };
  });
}

/** What a cell reads as: the number ("at least" when partial), or the coverage state's name. */
export function cellText(locale: string, c: CompareCell): string {
  if (c.value === null) return coverageText(locale, c.coverage);
  const value = formatNumber(locale, c.value);
  return c.partial === undefined
    ? value
    : say(locale, 'playerPage.minutesAtLeast', { minutes: value });
}

/**
 * The sentence under a row one side lacks: whose figure is missing and why.
 * Null when both sides have it.
 */
export function rowNote(
  locale: string,
  row: CompareRow,
  nameA: string,
  nameB: string,
): string | null {
  if (row.lacking === null) {
    const partial = [partialNote(locale, row.a, nameA), partialNote(locale, row.b, nameB)].filter(
      (n): n is string => n !== null,
    );
    return partial.length === 0 ? null : partial.join(' ');
  }
  if (row.lacking === 'both') {
    const reasons = new Set([row.a, row.b].map((c) => (c.value === null ? c.reason : '')));
    const [only] = [...reasons];
    return reasons.size === 1 && only !== undefined && only !== ''
      ? say(locale, 'compare.note.both', { reason: say(locale, only) })
      : [
          say(locale, 'compare.note.side', { name: nameA, reason: reasonOf(locale, row.a) }),
          say(locale, 'compare.note.side', { name: nameB, reason: reasonOf(locale, row.b) }),
        ].join(' ');
  }
  return row.lacking === 'a'
    ? say(locale, 'compare.note.lacking', { name: nameA, reason: reasonOf(locale, row.a) })
    : say(locale, 'compare.note.lacking', { name: nameB, reason: reasonOf(locale, row.b) });
}

/** "Ann: minutes for 7 of 9 matches played; the rest were not supplied." (T-823) */
function partialNote(locale: string, c: CompareCell, name: string): string | null {
  if (c.value === null || c.partial === undefined) return null;
  return plural(pageLocale(locale), 'compare.note.partial', c.partial.of, {
    name,
    counted: formatNumber(locale, c.partial.counted),
  }).text;
}

/** The reason mid-sentence: its first letter lowered (a no-op in scripts without case). */
function reasonOf(locale: string, c: CompareCell): string {
  if (c.value !== null) return '';
  const reason = say(locale, c.reason);
  return reason.charAt(0).toLowerCase() + reason.slice(1);
}

/** The `GET /search` query for the second player: people only. */
export function pickerQuery(term: string, limit = 10): string | null {
  const query = apiQuery(term, limit);
  return query === null ? null : `${query}&types=person`;
}
