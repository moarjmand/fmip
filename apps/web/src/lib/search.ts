import type {
  AskResponse,
  CompetitionDirectoryEntry,
  GroupSearchResult,
  ScoresResponse,
  SearchResponse,
  SearchEntityType,
  SearchResult,
  SearchType,
} from '@fmip/contracts';
import { SEARCH_COMMUNITY_TYPES, SEARCH_ENTITY_TYPES } from '@fmip/contracts';
import type { EntityImageKind } from '@/components/entity-image';
import { type MessageKey, interpolate, message } from '@/i18n/messages';
import { pageLocale, say } from '@/lib/competition';
import { menuGroups, todayGroups } from '@/lib/competitions-menu';

/** Which image a result of each kind carries (T-1617): a team's crest, a competition's logo, a person's photo. */
export const RESULT_IMAGE_KIND: Record<SearchEntityType, EntityImageKind> = {
  team: 'crest',
  competition: 'logo',
  person: 'photo',
};

/**
 * The search page's pure helpers (T-038, T-642): the query the URL carries,
 * the API queries, where a result leads, how its kind reads, and the sections
 * the page is made of.
 */

type SearchParams = Record<string, string | string[] | undefined>;

export const MIN_QUERY_LENGTH = 2;

/** `?q=`, whitespace collapsed; empty when absent. */
export function readSearchTerm(params: SearchParams): string {
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  return (raw ?? '').trim().replace(/\s+/g, ' ');
}

/** The `GET /search` query string, or null when the term is too short to ask. */
export function apiQuery(term: string, limit = 20): string | null {
  if (term.length < MIN_QUERY_LENGTH) return null;
  return `q=${encodeURIComponent(term)}&limit=${limit}`;
}

export function resultHref(locale: string, result: Pick<SearchResult, 'type' | 'id'>): string {
  const path: Record<SearchEntityType, string> = {
    team: 'team',
    competition: 'competition',
    person: 'player',
  };
  return `/${locale}/${path[result.type]}/${encodeURIComponent(result.id)}`;
}

/** "also known as The Zebras" when an alias matched, else null. */
export function matchNote(
  locale: string,
  result: Pick<SearchResult, 'matched_on' | 'alias'>,
): string | null {
  return result.matched_on === 'alias' && result.alias !== null
    ? say(locale, 'searchPage.alias', { alias: result.alias })
    : null;
}

// ---------------------------------------------------------------------------
// T-642: stories, groups and members, each in its own section.
// ---------------------------------------------------------------------------

/** How many of each community kind the page lists. */
export const COMMUNITY_LIMIT = 10;

/**
 * The `GET /search` query for the kinds members and publishers make, or null
 * when the term is too short. The catalog's kinds come from `/ask` (T-421),
 * so they are not asked for twice.
 */
export function communityQuery(term: string, limit = COMMUNITY_LIMIT): string | null {
  if (term.length < MIN_QUERY_LENGTH) return null;
  return `q=${encodeURIComponent(term)}&types=${SEARCH_COMMUNITY_TYPES.join(',')}&limit=${limit}`;
}

// ---------------------------------------------------------------------------
// T-838: past the ceiling on the model's questions, keywords instead.
// ---------------------------------------------------------------------------

/**
 * The `GET /search` query for the catalog's kinds, or null when the term is
 * too short: what the page asks when `/ask` refused the question (429), since
 * the keyword search calls no model and has no ceiling.
 */
export function entityQuery(term: string, limit = 20): string | null {
  if (term.length < MIN_QUERY_LENGTH) return null;
  return `q=${encodeURIComponent(term)}&types=${SEARCH_ENTITY_TYPES.join(',')}&limit=${limit}`;
}

/**
 * The keyword search's rows in the shape `/ask` answers with, read by no
 * model: `interpretation` is `not_supplied` and there is no reason, because
 * the page says why beside it (the refusal's own sentence).
 */
export function keywordsAsAsked(term: string, found: Pick<SearchResponse, 'results'>): AskResponse {
  return {
    question: term,
    interpretation: { coverage: 'not_supplied', last_updated_at: null, data: null },
    reason: null,
    results: [...found.results],
  };
}

/**
 * The catalog sections the page shows: the kinds the question was read as
 * asking for, or all three when it named none (or was not read at all).
 */
export function entitySections(asked: readonly SearchEntityType[] | null): SearchEntityType[] {
  return asked === null || asked.length === 0
    ? [...SEARCH_ENTITY_TYPES]
    : SEARCH_ENTITY_TYPES.filter((type) => asked.includes(type));
}

/** The catalog rows of one kind, keeping the search's score order. */
export function ofType(results: readonly SearchResult[], type: SearchEntityType): SearchResult[] {
  return results.filter((result) => result.type === type);
}

export const SECTION_TITLE_KEY: Record<SearchType, MessageKey> = {
  team: 'search.section.team',
  competition: 'search.section.competition',
  person: 'search.section.person',
  story: 'search.section.story',
  group: 'search.section.group',
  member: 'search.section.member',
};

/**
 * Each kind as a word in the one line that names every kind with no hit
 * (T-1803, D-401): "No competitions, players, groups or members match."
 */
export const SECTION_NONE_KEY: Record<SearchType, MessageKey> = {
  team: 'search.none.team',
  competition: 'search.none.competition',
  person: 'search.none.person',
  story: 'search.none.story',
  group: 'search.none.group',
  member: 'search.none.member',
};

/**
 * The page's sections split by whether anything was found (T-1803, D-401):
 * the kinds with hits keep their section, in the page's order; the kinds
 * with none are named together in one line instead of a heading each.
 */
export function splitSections(counts: readonly { type: SearchType; count: number }[]): {
  shown: SearchType[];
  none: SearchType[];
} {
  return {
    shown: counts.filter((c) => c.count > 0).map((c) => c.type),
    none: counts.filter((c) => c.count === 0).map((c) => c.type),
  };
}

/**
 * "No competitions, players, groups or members match.": the kinds' words in
 * the line's own language, joined as that language joins a list of
 * alternatives. Null when every kind found something.
 */
export function noneLine(locale: string, none: readonly SearchType[]): string | null {
  if (none.length === 0) return null;
  const lang = pageLocale(locale);
  const template = message(lang, 'search.none');
  const kinds = none.map((type) => message(lang, SECTION_NONE_KEY[type]));
  // The list is joined in the words' language, so an untranslated line reads
  // as English throughout rather than English words joined in Persian.
  const listLang = [template, ...kinds].every((m) => m.status === 'translated') ? lang : 'en';
  const list = new Intl.ListFormat(listLang, { type: 'disjunction' }).format(
    kinds.map((k) => k.text),
  );
  return interpolate(template.text, { kinds: list });
}

/**
 * The second line under a team result (T-1803, D-401), as parts joined with
 * " · ": its country when the API names one, then its domestic league, else
 * its ground's town (the ground's name when no town is recorded), else
 * "No league or ground on record" -- said only because the API says it holds
 * neither. A competition or a person keeps the API's `secondary` as it is,
 * and so does a team from an answer older than T-1803.
 */
export function resultLine(
  locale: string,
  hit: Pick<SearchResult, 'type' | 'secondary' | 'team_context'>,
): string[] {
  const country = hit.secondary === null ? [] : [hit.secondary];
  if (hit.type !== 'team' || hit.team_context === undefined) return country;
  const { league, ground } = hit.team_context;
  const place =
    league?.name ?? ground?.city ?? ground?.name ?? say(locale, 'searchPage.noLeagueOrGround');
  return [...country, place];
}

/** How many chips "Playing today" shows before it hands over to the competitions page. */
export const TODAY_CHIPS = 12;

/**
 * The empty page's two chip lists (T-1803, D-401), from the site's own
 * lists only: the competitions menu's big five, and the competitions with a
 * match today in the reader's zone, in the menu's order. A list we cannot
 * read is absent, never drawn empty (rule 3); `more` says "Playing today" was
 * cut short.
 */
export function searchChips<T extends CompetitionDirectoryEntry>(
  directory: readonly T[] | null,
  scores: ScoresResponse | null,
  locale: string,
): { bigFive: T[]; today: T[] | null; more: boolean } {
  if (directory === null) return { bigFive: [], today: null, more: false };
  const groups = menuGroups(directory, locale);
  const bigFive = groups.find((g) => g.region === 'big-five')?.competitions ?? [];
  if (scores === null) return { bigFive, today: null, more: false };
  const playing = todayGroups(scores);
  const today = groups.flatMap((g) => g.competitions).filter((c) => playing.has(c.id));
  return { bigFive, today: today.slice(0, TODAY_CHIPS), more: today.length > TODAY_CHIPS };
}

export const GROUP_VISIBILITY_KEY: Record<GroupSearchResult['visibility'], MessageKey> = {
  public: 'search.group.public',
  discoverable: 'search.group.discoverable',
};

export function groupHref(locale: string, slug: string): string {
  return `/${locale}/groups/${encodeURIComponent(slug)}`;
}

export function memberHref(locale: string, username: string): string {
  return `/${locale}/u/${encodeURIComponent(username)}`;
}
