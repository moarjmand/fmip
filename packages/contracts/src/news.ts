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
/** How far back trending looks for discussion and saves (hours). */
export const TRENDING_WINDOW_HOURS = 48;

/**
 * A story's type (blueprint 3.2, T-1001, D-123): the blueprint's eleven and
 * nothing else. The database's `story_label_type_known` check is the same
 * list; `story-label.schema.spec.ts` fails when the two differ.
 */
export const STORY_TYPES = [
  'breaking_news',
  'transfer',
  'injury',
  'suspension',
  'tactical_analysis',
  'match_preview',
  'match_report',
  'interview',
  'opinion',
  'data_analysis',
  'explainer',
] as const;
export type StoryType = (typeof STORY_TYPES)[number];

export function isStoryType(value: string): value is StoryType {
  return (STORY_TYPES as readonly string[]).includes(value);
}

/**
 * Who gave a story its type (D-123): the publisher's own category through
 * the committed mapping (T-1002), or an editor. Never a machine (N-1): a new
 * origin is a decision entry and a migration, and the schema spec and every
 * total record over this union fail until both exist.
 */
export const STORY_LABEL_ORIGINS = ['publisher', 'editor'] as const;
export type StoryLabelOrigin = (typeof STORY_LABEL_ORIGINS)[number];

/** What a story's current type is, and whose word it is. */
export interface StoryTypeLabel {
  type: StoryType;
  origin: StoryLabelOrigin;
}

/** `POST /admin/stories/:id/type` (T-1001): an editor's label, superseding the current one. */
export interface StoryTypeRequest {
  type: StoryType;
  /** Recorded on the label and in the audit log; required. */
  reason: string;
}

/**
 * How trending weighs its two signals (T-1008, D-128): each distinct member
 * on the public panel of the story's matches, and each distinct member who
 * saved the story, inside the window. A story's score is
 * `participants * discussion + savers * saves`. Views and shares are not
 * counted (N-3).
 */
export const TRENDING_WEIGHTS = { discussion: 1, saves: 1 } as const;

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
   * The story's type and whose word it is (T-1001, D-123): `available` with
   * `last_updated_at` the label's time, or `not_supplied` when neither the
   * publisher's category nor an editor gave one -- never a default type.
   */
  type: Covered<StoryTypeLabel>;
  /**
   * Trending only: how many distinct members took part in the public
   * discussion of the story's matches, and how many distinct members saved
   * the story (T-1008), inside the window. `null` elsewhere.
   */
  discussion: { participants: number; savers: number; window_hours: number } | null;
  /** Debate only: when an editor selected it and what they said. `null` elsewhere. */
  debate: { selected_at: string; note: string } | null;
  /**
   * An editor's breaking mark in force (T-1004, D-125): what they said, when,
   * and when it ends by itself. `null` when there is none in force -- an
   * expired mark is `null` at the next read, not at the next job.
   */
  breaking: BreakingMark | null;
  /**
   * The story's photo (T-1322, D-177), from our own server, with the credit
   * and licence a reader must be shown beside it. `null` (or absent, from a
   * server before T-1322) for every source whose licence does not cover its
   * photos, and for a photo not shown to be the agency's own.
   */
  image?: NewsImage | null;
}

/** The image licences a source may grant (D-177). */
export const NEWS_IMAGE_LICENCES = {
  'cc-by-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
} as const;
export type NewsImageLicence = keyof typeof NEWS_IMAGE_LICENCES;

/**
 * A news photo as a reader may see it (T-1322, D-177). `url` is ours
 * (`/media/news/<file>`), never the agency's; the page shows `credit` and the
 * licence's name linked to `licence_url` wherever it shows the photo.
 */
export interface NewsImage {
  url: string;
  /** Who to credit, e.g. "Mehr News Agency", or "<photographer> / Mehr News Agency". */
  credit: string;
  licence: NewsImageLicence;
  licence_url: string;
  /** From the file's header; `null` when unknown. For reserving the space before it loads. */
  width: number | null;
  height: number | null;
}

/** An editor's decision on one article's photo (T-1322): `POST /admin/articles/:id/image`. */
export interface ArticleImageOverrideRequest {
  action: 'show' | 'hide';
  reason: string;
}

export interface BreakingMark {
  note: string;
  marked_at: string;
  ends_at: string;
}

export interface NewsFilters {
  /** Stories about a team or competition of this country. */
  country: string | null;
  competition: string | null;
  team: string | null;
  /** Stories with a version in this language. */
  language: string | null;
  /** Stories whose current type is this (T-1003, D-124); untyped stories are counted, not shown. */
  type: StoryType | null;
  /** Stories any of whose reports links this person, by id (rule 1). */
  player: string | null;
  /**
   * The story's first publication on or after this date (`YYYY-MM-DD`), and
   * on or before `to`, as calendar days in `time_zone` (T-1003, D-124).
   */
  from: string | null;
  to: string | null;
  /** The IANA zone `from` and `to` are read in; `UTC` when none was given. */
  time_zone: string;
}

/**
 * Why a section holds what it holds -- or nothing. Rendered as a sentence,
 * never hidden behind an empty list (rule 3).
 */
export type NewsSectionReason =
  /**
   * Trending counts public discussion and saves (T-1008, D-128); views and
   * shares are not measured (blueprint 3.1, N-3).
   */
  | 'discussion_and_saves'
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
  | 'nothing_yet'
  /**
   * A player filter, while no story links any person yet (T-1003, D-124):
   * the list would be empty because nobody is linked, not because there is
   * no news about the player.
   */
  | 'persons_unlinked';

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
  /**
   * With a type filter only (T-1003, D-124): how many stories that match
   * every other filter have no type, and so are not shown. `null` without a
   * type filter.
   */
  untyped: number | null;
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
  /** This report's photo under D-177, as on a card. */
  image?: NewsImage | null;
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

/** The most stories a team or competition page lists (T-944). */
export const ENTITY_NEWS_LIMIT = 5;

/**
 * `GET /teams/:id/news`, `GET /competitions/:id/news` (T-944, D-119) and
 * `GET /players/:id/news` (T-1007, D-127): the
 * news page's latest cards for stories the news boundary linked to the team
 * or competition, newest first. `not_supplied` with `feeds_unread` until the
 * feeds have been read at all, as on the match page; then `available`,
 * possibly empty with `nothing_linked`.
 */
export interface EntityNewsResponse {
  entity: { type: 'team' | 'competition' | 'person'; id: string };
  stories: Covered<NewsStoryCard[]>;
  reason: EntityNewsReason | null;
  /**
   * A competition's news only (T-1010, D-129): which carried sources linked
   * a story to it in the window, and how many stories. Below the floor the
   * stories are `limited` with `no_carried_source` or `below_floor`.
   */
  coverage?: CompetitionNewsCoverage;
}

/** The window a competition's news coverage is counted over (T-1010, D-129). */
export const NEWS_COVERAGE_WINDOW_DAYS = 30;
/**
 * D-129's floor: a competition with fewer stories than this from carried
 * sources inside the window has `limited` news. A proposal the maintainer
 * may change, like the choice of publishers it points at (N-8).
 */
export const NEWS_COVERAGE_FLOOR = 5;

/** One carried source's stories about a competition inside the window. */
export interface NewsCoverageSource {
  id: string;
  name: string;
  stories: number;
}

/**
 * A competition's news coverage (T-1010, D-129): the carried sources (not
 * dropped) with at least one report linked to it whose first publication
 * falls inside the window, most stories first, and the distinct stories
 * they make together (a story two sources reported counts once).
 */
export interface CompetitionNewsCoverage {
  window_days: number;
  floor: number;
  stories: number;
  sources: NewsCoverageSource[];
}

/** Where a competition stands against the floor. */
export type NewsCoverageState = 'covered' | 'below_floor' | 'no_carried_source';

export function newsCoverageState(stories: number, floor: number): NewsCoverageState {
  if (stories === 0) return 'no_carried_source';
  return stories < floor ? 'below_floor' : 'covered';
}

/**
 * `GET /admin/news/coverage` (T-1010): every active competition's coverage,
 * the gaps first. It names the gaps and adds nothing: which publishers to
 * carry is the maintainer's (N-8).
 */
export interface NewsCoverageReport {
  generated_at: string;
  window_days: number;
  floor: number;
  /** Sources carried now (not dropped); zero means every competition is a gap. */
  carried_sources: number;
  /** When a feed was last read, or `null` if never: a report over unread feeds says nothing. */
  feeds_read_at: string | null;
  competitions: {
    competition: { id: string; name: string };
    state: NewsCoverageState;
    coverage: CompetitionNewsCoverage;
  }[];
}

/**
 * Why an entity's news list says nothing. Beside the match page's reasons,
 * `persons_unlinked` (T-1007, D-127): a player's list is `not_supplied` while
 * no story links any person at all (D-126 keeps the linker off until its
 * precision is measured), because an empty list would read as "nobody wrote
 * about this player".
 */
export type EntityNewsReason =
  | FixtureNewsReason
  | 'persons_unlinked'
  /** T-1010 (D-129): no carried source linked a story to the competition inside the window. */
  | 'no_carried_source'
  /** T-1010 (D-129): fewer stories than the floor inside the window. */
  | 'below_floor';

// ---------------------------------------------------------------------------
// Saved articles (blueprint 3.3 and 2.1, T-842): a member's own list, under
// Following. Private: only `/me/saved-articles` reads or writes it.
// ---------------------------------------------------------------------------

/** The most stories one member's list holds; saving another is refused until one is removed. */
export const SAVED_ARTICLES_LIMIT = 500;

/**
 * What became of a saved story's report.
 *
 * - `available`: the publisher's headline and the link to their original,
 *   read now under the source's rights (D-061) -- nothing is copied at save.
 * - `source_dropped`: the publisher was dropped and took their items with
 *   them (D-061); the list names them and says so, rather than keeping a
 *   dead link or a copy of their words.
 * - `unavailable`: the report is no longer held for another reason.
 */
export type SavedArticleState = 'available' | 'source_dropped' | 'unavailable';

export interface SavedArticle {
  story_id: string;
  saved_at: string;
  state: SavedArticleState;
  /** Headline and link only (D-061); all four null unless `available`. */
  headline: string | null;
  url: string | null;
  language: string | null;
  published_at: string | null;
  source: {
    id: string;
    name: string;
    /** Null once dropped: the list does not send a reader to a publisher who asked to leave. */
    homepage_url: string | null;
    dropped_at: string | null;
  };
}

/** `GET /me/saved-articles`, and the answer to saving or removing one: newest saved first. */
export interface SavedArticlesResponse {
  saved: SavedArticle[];
  limit: number;
}

// ---------------------------------------------------------------------------
// "Breaking" (blueprint 2.3 and 12.2, T-1004, D-125): an editor's mark with a
// window, and the homepage strip of the stories marked while it lasts.
// ---------------------------------------------------------------------------

/** How long a mark lasts unless an editor clears it earlier (D-125's proposal). */
export const BREAKING_WINDOW_HOURS = 6;
/** The most stories the homepage strip shows. */
export const BREAKING_STRIP_LIMIT = 5;

/** `POST /admin/stories/:id/breaking`: readers see the note on the strip; it is audited. */
export interface BreakingMarkRequest {
  note: string;
}

/** `POST /admin/stories/:id/breaking/clear`: ends a mark early; the reason is audited. */
export interface BreakingClearRequest {
  reason: string;
}

/** One mark as the editor's list shows it: in force, expired or cleared. */
export interface BreakingRecord {
  story_id: string;
  headline: string | null;
  marked_by: string;
  note: string;
  marked_at: string;
  ends_at: string;
  cleared_by: string | null;
  cleared_reason: string | null;
  cleared_at: string | null;
  /** `live` while in force; `expired` when its window ran out; `cleared` when an editor ended it. */
  state: 'live' | 'expired' | 'cleared';
}

/** `GET /admin/breaking`: newest mark first. */
export interface BreakingListResponse {
  generated_at: string;
  marks: BreakingRecord[];
}

/**
 * `GET /news/breaking`: the stories marked breaking now, newest mark first.
 * `available` with a list that may be empty; a page draws no strip when it
 * is, never an empty one.
 */
export interface BreakingNewsResponse {
  stories: Covered<NewsStoryCard[]>;
}

// ---------------------------------------------------------------------------
// News sources in the console (T-1015): an administrator adds, edits and
// drops a publisher's feed, audited with the reason and the previous value.
// Which publishers to carry, and their terms, are the maintainer's (N-8).
// ---------------------------------------------------------------------------

/** The feed kinds the console adds: a free publisher feed (D-061). A licensed wire is not added here. */
export const NEWS_SOURCE_KINDS = ['rss', 'atom'] as const;
export type NewsSourceKind = (typeof NEWS_SOURCE_KINDS)[number];

/** What a free feed may grant (D-061): the headline, or the headline and the publisher's summary. */
export const NEWS_SOURCE_RIGHTS = ['headline', 'summary'] as const;
export type NewsSourceRights = (typeof NEWS_SOURCE_RIGHTS)[number];

/** How many of a feed's items the preview shows. */
export const NEWS_FEED_PREVIEW_ITEMS = 10;

export interface NewsSourceFetch {
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  started_at: string;
  finished_at: string | null;
  items_seen: number;
  items_written: number;
  error: string | null;
}

export interface NewsSourceRecord {
  id: string;
  name: string;
  homepage_url: string;
  feed_url: string | null;
  /** `licensed` only for a row the console did not add. */
  kind: NewsSourceKind | 'licensed';
  rights: NewsRights;
  /** BCP 47 of the language the publisher writes in. */
  language: string;
  created_at: string;
  updated_at: string;
  /** A dropped source stays, dated with the reason (D-061); it is read and shown no more. */
  dropped_at: string | null;
  dropped_reason: string | null;
  /** The newest attempt to read the feed, or `null` when it was never read. */
  last_fetch: NewsSourceFetch | null;
}

/** `GET /admin/news-sources`: every source, carried first, then dropped. */
export interface NewsSourcesResponse {
  sources: NewsSourceRecord[];
}

/**
 * What the publisher's robots.txt says about the feed's path for our agent:
 * `allowed` or `disallowed` by its rules; `absent` when it answered anything
 * but 200, which allows everything (the standard, and the ingestion job);
 * `unreachable` when it could not be asked at all, which the console treats
 * as not checked and refuses to save over.
 */
export type RobotsVerdict = 'allowed' | 'disallowed' | 'absent' | 'unreachable';

/** One item as the feed carries it, for the administrator's eyes only; nothing is stored. */
export interface NewsFeedPreviewItem {
  headline: string;
  url: string;
  published_at: string | null;
  /** The publisher's summary, cut to a few hundred characters; `null` when the item has none. */
  summary: string | null;
  language: string | null;
}

/** What one read of a feed yielded, or why it yielded nothing. */
export type NewsFeedYield =
  | {
      ok: true;
      kind: NewsSourceKind;
      title: string | null;
      language: string | null;
      items: number;
      skipped: number;
      sample: NewsFeedPreviewItem[];
    }
  | { ok: false; error: string };

/** `POST /admin/news-sources/preview`: the feed fetched once, after its robots.txt. */
export interface NewsFeedPreview {
  feed_url: string;
  checked_at: string;
  robots: { url: string; verdict: RobotsVerdict; status: number | null };
  /** `null` when robots.txt disallows the feed or could not be asked: the feed is not fetched. */
  feed: NewsFeedYield | null;
}

export interface NewsFeedPreviewRequest {
  feed_url: string;
}

/** `POST /admin/news-sources`: added only after the feed is fetched and robots.txt allows it. */
export interface NewsSourceRequest {
  name: string;
  homepage_url: string;
  feed_url: string;
  kind: NewsSourceKind;
  rights: NewsSourceRights;
  language: string;
  /** Recorded in the audit log; required (rule 10). */
  reason: string;
}

/** `PATCH /admin/news-sources/:id`: the fields to change and why. A new feed URL is checked as on adding. */
export type NewsSourceEditRequest = Partial<Omit<NewsSourceRequest, 'reason'>> & {
  reason: string;
};

/** `POST /admin/news-sources/:id/drop`: a publisher who asks to be dropped is dropped; the reason is kept. */
export interface NewsSourceDropRequest {
  reason: string;
}

/** The answer to an add, an edit or a drop. */
export interface NewsSourceWriteResponse {
  source: NewsSourceRecord;
  /** The check the write made of a new feed URL; `null` when the URL did not change. */
  preview: NewsFeedPreview | null;
  audit_id: string;
}
