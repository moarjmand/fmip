import type { ScoreCard, ScoresGroup, ScoresResponse } from '@fmip/contracts';

/**
 * The scores page's country, competition and stage filters (T-633, blueprint
 * 4.1). They narrow the day the API already returned, in the web layer, so
 * the page can offer only the values that day actually holds and the live
 * stream stays one shared question per day (T-073). Pure: the page, the live
 * list and the tests all run the same code.
 */

/** Stage kinds as the catalogue stores them (`stage_kind_check`), in the order offered. */
export const STAGE_KINDS = ['league', 'group', 'knockout', 'playoff', 'qualifying'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_LABEL: Record<StageKind, string> = {
  league: 'League stage',
  group: 'Group stage',
  knockout: 'Knockout',
  playoff: 'Play-off',
  qualifying: 'Qualifying',
};

/** The country value for continental and international competitions (no country). */
export const INTERNATIONAL = 'intl';

export interface ScoresFilterSelection {
  /** A country id, `INTERNATIONAL`, or `null` for every country. */
  country: string | null;
  competition: string | null;
  stage: StageKind | null;
}

export const NO_FILTERS: ScoresFilterSelection = { country: null, competition: null, stage: null };

type Params = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

const isStageKind = (v: string): v is StageKind => (STAGE_KINDS as readonly string[]).includes(v);

/**
 * Reads `?country=`, `?competition=` and `?stage=`. A value that cannot be
 * one (not an id, not a stored stage kind) is ignored rather than turned into
 * an error page, as a bad date is; an empty value (a GET form's "All") is no filter.
 */
export function readFilterSelection(params: Params): ScoresFilterSelection {
  const country = first(params.country)?.toLowerCase();
  const competition = first(params.competition)?.toLowerCase();
  const stage = first(params.stage);
  return {
    country:
      country !== undefined && (country === INTERNATIONAL || UUID.test(country)) ? country : null,
    competition: competition !== undefined && UUID.test(competition) ? competition : null,
    stage: stage !== undefined && isStageKind(stage) ? stage : null,
  };
}

export function isFiltered(s: ScoresFilterSelection): boolean {
  return s.country !== null || s.competition !== null || s.stage !== null;
}

/** The selection as query pairs, only the ones set. */
export function filterParams(s: ScoresFilterSelection): [string, string][] {
  const out: [string, string][] = [];
  if (s.country !== null) out.push(['country', s.country]);
  if (s.competition !== null) out.push(['competition', s.competition]);
  if (s.stage !== null) out.push(['stage', s.stage]);
  return out;
}

export function matchesFilters(card: ScoreCard, s: ScoresFilterSelection): boolean {
  if (s.country !== null) {
    const country = card.competition.country_id ?? INTERNATIONAL;
    if (country.toLowerCase() !== s.country) return false;
  }
  if (s.competition !== null && card.competition.id.toLowerCase() !== s.competition) return false;
  if (s.stage !== null && card.stage?.kind !== s.stage) return false;
  return true;
}

/**
 * The response with only the cards the selection keeps: pinned cards
 * filtered, groups filtered and dropped when empty, `total` recounted.
 */
export function applyFilters(res: ScoresResponse, s: ScoresFilterSelection): ScoresResponse {
  if (!isFiltered(s)) return res;
  const pinned = res.pinned.filter((c) => matchesFilters(c, s));
  const groups: ScoresGroup[] = [];
  for (const group of res.groups) {
    const fixtures = group.fixtures.filter((c) => matchesFilters(c, s));
    if (fixtures.length > 0) groups.push({ ...group, fixtures });
  }
  const total = pinned.length + groups.reduce((n, g) => n + g.fixtures.length, 0);
  return { ...res, pinned, groups, total };
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterOptions {
  countries: FilterOption[];
  competitions: FilterOption[];
  stages: FilterOption[];
}

/**
 * The values the day holds, and nothing else. Countries come from the groups
 * (the only place a country's name is carried), by name, with the
 * international competitions last; competitions in the list's own order
 * (favourites, then the stated order of T-504); stage kinds in catalogue order.
 */
export function filterOptions(res: ScoresResponse): FilterOptions {
  const countries = new Map<string, string>();
  let international = false;
  const competitions = new Map<string, string>();
  const stages = new Set<StageKind>();

  const seeCard = (card: ScoreCard): void => {
    if (!competitions.has(card.competition.id)) {
      competitions.set(card.competition.id, card.competition.name);
    }
    const kind = card.stage?.kind;
    if (kind !== undefined && isStageKind(kind)) stages.add(kind);
  };

  res.pinned.forEach(seeCard);
  for (const group of res.groups) {
    if (group.fixtures.length === 0) continue;
    if (group.country === null) international = true;
    else countries.set(group.country.id, group.country.name);
    group.fixtures.forEach(seeCard);
  }

  const countryOptions = [...countries]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
  if (international) countryOptions.push({ value: INTERNATIONAL, label: 'International' });

  return {
    countries: countryOptions,
    competitions: [...competitions].map(([value, label]) => ({ value, label })),
    stages: STAGE_KINDS.filter((k) => stages.has(k)).map((k) => ({
      value: k,
      label: STAGE_LABEL[k],
    })),
  };
}

/**
 * The options with the current selection kept visible: a value carried over
 * from another day that this day does not hold is listed as such, so the
 * select never reads "All" while a filter is in force.
 */
export function withSelected(options: FilterOption[], selected: string | null): FilterOption[] {
  if (selected === null || options.some((o) => o.value === selected)) return options;
  return [...options, { value: selected, label: 'Not on this day' }];
}
