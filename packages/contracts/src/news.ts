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
  /** Whose words these are (T-304): the publisher's, or a person's translation with its review state. */
  origin: VersionOrigin;
  review_state: ReviewState | null;
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
  | 'no_match'
  /** Nothing has been read from any publisher yet. */
  | 'nothing_yet';

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

// ---------------------------------------------------------------------------
// The story page (blueprint 3.3, T-144), built against D-061: a front page
// that sends readers away. Everything the blueprint lists is here or is named
// as not supplied; nothing is invented to fill a slot.
// ---------------------------------------------------------------------------

/** Another publisher's report of the same event, in the cluster. */
export interface NewsReport {
  article_id: string;
  headline: string;
  summary: string | null;
  byline: string | null;
  language: string;
  published_at: string | null;
  url: string;
  source: { id: string; name: string; homepage_url: string; rights: NewsRights };
}

/** Whose words a version carries (T-304, blueprint 13). Never a machine's presented as a person's (T-151). */
export type VersionOrigin = 'publisher' | 'translation';
/** A translation's review state, the catalogue's own (T-302, D-066): written by a fluent speaker, or approved by a second. */
export type ReviewState = 'translated' | 'reviewed';

/** One language the original has been written in, and when its newest version was. */
export interface StoryVersion {
  language: string;
  version_number: number;
  updated_at: string;
  origin: VersionOrigin;
  /** `null` for the publisher's own words. */
  review_state: ReviewState | null;
}

/** `POST /admin/articles/:id/translations` (T-304): a person's version in another language. */
export interface TranslationRequest {
  /** BCP 47; not a language the publisher already writes this article in. */
  language: string;
  headline: string;
  /** Only what the source grants (D-061): refused for a headline-only source. */
  summary?: string | null;
  byline?: string | null;
}

export interface StoryPage {
  /** The promoted original, shown in `?language=` when a version exists, else the source's language. */
  story: NewsStoryCard;
  /** When the words shown were written; a correction is a new version, so this moves. */
  updated_at: string;
  versions: StoryVersion[];
  /**
   * The full text, only when the source grants it (`rights = 'full_text'`,
   * D-061). For every free feed this is `not_supplied` and the page sends
   * the reader to the publisher, which is the product (rule 3).
   */
  body: Covered<string>;
  /** Newest first. */
  corrections: { note: string; noted_at: string }[];
  /** The other publishers' reports grouped under this story, newest first. */
  reports: NewsReport[];
  /** When the feeds were last read (rule 4). */
  last_updated_at: string | null;
}

// ---------------------------------------------------------------------------
// The editor's half of the debate section (blueprint 3.1, rule 10). Editors
// and administrators; every shape carries the words a reader or an auditor
// will see, and neither is optional.
// ---------------------------------------------------------------------------

export interface DebateSelectionRequest {
  /** Why this is a debate: shown beside the story and recorded in the audit log. */
  note: string;
}

export interface DebateClearRequest {
  /** Recorded on the row and in the audit log; required. */
  reason: string;
}

export interface DebateRecord {
  story_id: string;
  /** The promoted original's newest headline, or `null` when the story has none. */
  headline: string | null;
  selected_by: string;
  note: string;
  selected_at: string;
  cleared_by: string | null;
  cleared_reason: string | null;
  cleared_at: string | null;
}

export interface DebateListResponse {
  generated_at: string;
  /** Newest selection first. */
  selections: DebateRecord[];
}

// ---------------------------------------------------------------------------
// Related news on the match centre (blueprint 4.2, T-145): current stories
// linked to the match itself or to either side, from the same cards the news
// page shows and under the same rights (D-061).
// ---------------------------------------------------------------------------
export const FIXTURE_NEWS_LIMIT = 8;

/** Why the list holds what it holds -- or nothing. */
export type FixtureNewsReason =
  /** The feeds have been read and no report links this match or its sides inside the window. */
  | 'nothing_linked'
  /** The feeds have never been read, so an empty list would say nothing (rule 3). */
  | 'feeds_unread';

/** `GET /fixtures/:id/news`. */
export interface FixtureNewsResponse {
  fixture_id: string;
  /** The span around the kick-off the list covers. */
  period: { since: string; until: string };
  /**
   * `available` with the stories (possibly none) once the feeds have been
   * read; `not_supplied` when they never were. Reports about the match itself
   * come before reports about one of its sides; each group newest first.
   */
  stories: Covered<NewsStoryCard[]>;
  reason: FixtureNewsReason | null;
}
