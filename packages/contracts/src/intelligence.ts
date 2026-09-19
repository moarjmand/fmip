/**
 * The intelligence layer (Phase 5, D-070): a language model behind one port,
 * chosen at deployment, with an honest absence -- and the shape every piece
 * of machine-written text on the product takes.
 */

/** What `/health/intelligence` says: a model this deployment can drive, or none. Never a default that looks like one. */
export type LanguageModelState =
  { state: 'absent' } | { state: 'configured'; provider: string; model: string };

/** `GET /health/intelligence`. */
export interface IntelligenceHealth {
  checked_at: string;
  language_model: LanguageModelState;
  /**
   * True when no model is configured: every surface of Phase 5 says so in a
   * sentence, and nothing on the critical path changes either way.
   */
  absent: boolean;
}

/**
 * Text a machine wrote (T-403). Wherever it appears it is labelled as such,
 * with the model that wrote it, the prompt version that asked, and when --
 * so a reader knows what they are reading and a maintainer can reproduce it.
 * Grounding and versioning are the writer's job and are checked before a
 * `MachineText` exists at all; this is only ever the published shape.
 */
export interface MachineText {
  text: string;
  /** BCP 47 tag of the prose. */
  language: string;
  model: string;
  prompt_version: string;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Match summaries (E41, T-411): what a model wrote about a finished match,
// from the record beside it, or the sentence that says why there is none.
// ---------------------------------------------------------------------------
import type { CoverageState, Covered } from './coverage';

/** Which parts of the record the summary was written from, by their coverage at the time. */
export interface SummaryGrounding {
  timeline: CoverageState;
  statistics: CoverageState;
  lineups: CoverageState;
  forecast: CoverageState;
  consensus: CoverageState;
}

export interface MatchSummary extends MachineText {
  version_number: number;
  grounded_on: SummaryGrounding;
}

export type MatchSummaryReason =
  /** The match is not over; a summary is written from the full record. */
  | 'not_finished'
  /** No language model is configured on this deployment (T-400). */
  | 'no_model'
  /** A model exists and nobody has asked yet; full time or an editor will. */
  | 'not_generated'
  /** Every attempt so far was turned down -- by the grounding gate, a refusal or a truncation -- and none is shown. */
  | 'rejected';

/** `GET /fixtures/:id/summary`. */
export interface MatchSummaryResponse {
  fixture_id: string;
  summary: Covered<MatchSummary>;
  reason: MatchSummaryReason | null;
  /** Attempts on record, published or rejected: the history a regeneration adds to. */
  versions: number;
}

/** `POST /admin/fixtures/:id/summary`: an editor asks for a new version, with the reason the audit log keeps. */
export interface MatchSummaryRequest {
  reason: string;
}

export type MatchSummaryOutcome =
  | { outcome: 'published' | 'rejected'; version_number: number; rejection: string | null }
  | { outcome: 'absent' | 'not_finished' | 'failed' };

// ---------------------------------------------------------------------------
// Natural-language search (E42, T-420): the model reads the question; the
// search that exists answers it. The model's output is a structured intent
// and nothing else, which is what makes it checkable and what keeps an
// invented club out of the results -- a name the search cannot find is a
// name the answer does not contain (rule 1).
// ---------------------------------------------------------------------------
import type { SearchEntityType, SearchResult } from './search';

export interface SearchIntent {
  /** The names the question asks about, as written in it. */
  names: string[];
  /** What kinds of thing it asks for; empty means any kind. */
  types: SearchEntityType[];
}

export type AskReason =
  /** No language model is configured: the question was searched as keywords. */
  | 'no_model'
  /** The model's answer was not an intent the schema accepts: searched as keywords. */
  | 'unreadable'
  /** The model read the question and found no name in it: searched as keywords. */
  | 'nothing_named'
  /** The model could not be reached: searched as keywords. */
  | 'failed';

/** `GET /ask?q=`. */
export interface AskResponse {
  question: string;
  interpretation: Covered<SearchIntent>;
  reason: AskReason | null;
  /** The search's own rows, by id, in score order; never a name the search did not find. */
  results: SearchResult[];
}
