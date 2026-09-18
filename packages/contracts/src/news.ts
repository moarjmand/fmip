import type { Covered } from './coverage';

/**
 * The news sections (blueprint 3.1, T-143). Four ways into the same stories,
 * each with its own rule for what belongs and in what order, and each honest
 * about what it is computed from.
 */
export const NEWS_SECTIONS = ['latest', 'trending', 'debate', 'following'] as const;
export type NewsSection = (typeof NEWS_SECTIONS)[number];

export function isNewsSection(value: string): value is NewsSection {
  return (NEWS_SECTIONS as readonly string[]).includes(value);
}

/** How many stories one page of a section carries. */
export const NEWS_PAGE_SIZE = 40;
/** How far back trending looks for discussion (hours). */
export const TRENDING_WINDOW_HOURS = 48;

/** What a source grants (D-061); the card carries only what these allow. */
export type NewsRights = 'headline' | 'summary' | 'full_text';

export interface NewsEntity {
  entity_type: 'team' | 'competition' | 'person' | 'fixture';
  entity_id: string;
  /** The canonical name; `null` for a fixture, which the page links rather than names. */
  name: string | null;
  /** The name in the reader's language (`?locale=`), or `null` when nobody has written one (T-303). */
  localised_name: string | null;
}

/**
 * One story, told by its promoted original (blueprint 3.3): the earliest
 * report, from a publisher that still grants it. Everything a reader sees is
 * the publisher's own words and a link back to them; a card never carries a
 * body, and `summary` is `null` when the source grants the headline only.
 */
export interface NewsStoryCard {
  story_id: string;
  article_id: string;
  headline: string;
  summary: string | null;
  byline: string | null;
  /** BCP 47 tag of the version shown. */
  language: string;
  /** The publisher's time, or `null` when they gave none -- never the fetch time in its place. */
  published_at: string | null;
  fetched_at: string;
  /** The original, which is where a reader is sent. */
  url: string;
  source: { id: string; name: string; homepage_url: string; rights: NewsRights };
  /** Which teams, competition and match the story is about, by id (rule 1). */
  entities: NewsEntity[];
  /** Other publishers' reports grouped under this story. */
  other_reports: number;
  /**
   * Trending only: how many distinct members took part in the public
   * discussion of the story's matches inside the window. `null` elsewhere.
   */
  discussion: { participants: number; window_hours: number } | null;
  /** Debate only: when an editor selected it and what they said. `null` elsewhere. */
  debate: { selected_at: string; note: string } | null;
}

export interface NewsFilters {
  /** Stories about a team or competition of this country. */
  country: string | null;
  competition: string | null;
  team: string | null;
  /** Stories with a version in this language. */
  language: string | null;
}

/**
 * Why a section holds what it holds -- or nothing. Rendered as a sentence,
 * never hidden behind an empty list (rule 3).
 */
export type NewsSectionReason =
  /** Trending counts public discussion only; views, saves and shares are not measured (blueprint 3.1). */
  | 'discussion_only'
  /** Nothing was discussed inside the window. */
  | 'nothing_trending'
  /** Debate is what editors selected; nobody has selected anything. */
  | 'nothing_selected'
  /** Following needs a signed-in member. */
  | 'needs_session'
  /** The member follows nothing yet. */
  | 'nothing_followed'
  /** No story matched the filters. */
  | 'no_match';

export interface NewsSectionResponse {
  section: NewsSection;
  filters: NewsFilters;
  /**
   * `available` when the section is what the blueprint describes; `limited`
   * when it is computed from fewer signals than the blueprint names (trending);
   * `not_supplied` when it cannot be computed for this reader (following, for
   * a guest). Data is a list, possibly empty, with `reason` saying why.
   */
  stories: Covered<NewsStoryCard[]>;
  reason: NewsSectionReason | null;
  /** `?before=` for the next page of latest and following; `null` when this is the last. */
  next_before: string | null;
}
