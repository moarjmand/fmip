import type { GlossaryStatus } from './glossary';
import type { NewsRights, ReviewState } from './news';
import type { TranslationCheckResult, TranslationField } from './translation-checks';

/**
 * The translator's desk on the web console (T-1013): a queue of articles per
 * language and, for one article, everything a translator or a reviewer needs
 * beside the form -- the publisher's words, the newest translation, the
 * automatic checks (T-1012) and the glossary terms the source uses (T-1011).
 * Read-only: writing and reviewing are T-304's two routes.
 */

/** A person named on a translation, by id and username. */
export interface TranslationPerson {
  id: string;
  username: string;
}

/** The newest translation of an article into one language. */
export interface TranslationVersionSummary {
  version_number: number;
  review_state: ReviewState;
  written_by: TranslationPerson;
  reviewed_by: TranslationPerson | null;
  /** When this version was written. */
  updated_at: string;
}

export interface TranslationQueueItem {
  article_id: string;
  story_id: string;
  source_name: string;
  source_language: string;
  rights: NewsRights;
  /** The publisher's newest headline. */
  headline: string;
  published_at: string;
  translation: TranslationVersionSummary | null;
}

/** How many of each bucket the queue shows at most. */
export const TRANSLATION_QUEUE_LIMIT = 50;
/** How far back "to translate" looks, in days: the news a reader still sees. */
export const TRANSLATION_QUEUE_DAYS = 7;

/** `GET /admin/translations?language=` (T-1013). */
export interface TranslationQueue {
  language: string;
  /** Promoted originals of the last `TRANSLATION_QUEUE_DAYS` days with no translation into it, newest first. */
  to_translate: TranslationQueueItem[];
  /** Newest translation not yet reviewed, oldest first: the longest wait at the top. */
  awaiting_review: TranslationQueueItem[];
  /** Newest translation reviewed, most recent first. */
  reviewed: TranslationQueueItem[];
  generated_at: string;
}

/** A glossary term the source uses, with the target term a person wrote, if any. */
export interface TranslationGlossaryHit {
  key: string;
  source: string;
  locked: boolean;
  /** Empty while `untranslated`: nobody has written it yet. */
  text: string;
  status: GlossaryStatus;
}

export interface TranslationDeskVersion extends TranslationVersionSummary {
  headline: string;
  summary: string | null;
  byline: string | null;
}

/**
 * Translation memory (T-1014, D-130): a reviewed translation of exactly the
 * same source string, in the same language, on another article -- a named
 * person's earlier words, offered to copy and never filled in.
 */
export interface TranslationMemoryEntry {
  field: TranslationField;
  /** The source string, exactly as this article's source carries it. */
  source: string;
  /** The reviewed translation of it. */
  text: string;
  article_id: string;
  version_number: number;
  written_by: TranslationPerson;
  reviewed_by: TranslationPerson;
  /** When the reviewed version was written. */
  reviewed_at: string;
  /**
   * A later version of that translation whose words differ: the memory entry
   * was corrected, and the correction is shown beside it. Null when the
   * reviewed words are still the newest.
   */
  correction: {
    version_number: number;
    text: string | null;
    review_state: ReviewState;
    written_by: TranslationPerson;
    updated_at: string;
  } | null;
}

/** How many memory entries per field the desk shows at most, newest first. */
export const TRANSLATION_MEMORY_LIMIT = 5;

/** `GET /admin/articles/:id/translations/:language` (T-1013). */
export interface TranslationDesk {
  article_id: string;
  story_id: string;
  language: string;
  source: {
    name: string;
    language: string;
    rights: NewsRights;
    url: string;
    version_number: number;
    headline: string;
    summary: string | null;
    byline: string | null;
    updated_at: string;
  };
  /**
   * The fields a translation may carry: the headline alone when the source
   * grants only the headline (D-061, PL016), and a summary or byline only
   * where the source has one to translate.
   */
  fields: TranslationField[];
  /** The newest translation into `language`, or null when there is none yet. */
  translation: TranslationDeskVersion | null;
  /** The checks on `translation` against `source`; empty when there is no translation. */
  checks: TranslationCheckResult[];
  glossary: TranslationGlossaryHit[];
  /** The viewer wrote the newest translation, and so cannot review it (D-066). */
  viewer_is_author: boolean;
  /** Exact matches from translation memory, per field of the source (T-1014). */
  memory: TranslationMemoryEntry[];
}
