/**
 * Community-written match analysis (blueprint 10.3, T-260).
 *
 * **A fourth signed opinion, and nothing here is shared with the other three.**
 * Rule 6 names the statistical model, the founder's analysis and the community
 * consensus. This is none of them — and it contains a predicted result, a
 * confidence and reasoning, which makes it look exactly like the founder's
 * analysis in a diagram.
 *
 * That resemblance is the danger. One shared type, one `source` field, one
 * component that renders "an analysis", and a year later a reader cannot tell
 * whose opinion they are looking at — which makes the founder's own signature
 * mean nothing. So this file imports nothing from `founder-analysis.ts`,
 * `forecast.ts`, `consensus.ts` or `predictions.ts`, and defines its own
 * vocabulary even where the words coincide.
 *
 * The fields are deliberately *named* the same as the founder's. Renaming them
 * to avoid the resemblance would make the two harder to read side by side
 * without making them any harder to confuse in a query — and it is the query
 * that matters.
 */

/** What an analyst is calling. Its own union, not the founder's. */
export type CommunityOutcome = 'home' | 'draw' | 'away';

/** 1 to 5, the same scale a member's prediction uses, so the two read side by side. */
export type CommunityConfidence = 1 | 2 | 3 | 4 | 5;

/**
 * Where an analysis has got to, derived from its rows and never stored (T-260).
 *
 * A stored `state` would be one fact kept in one place and changed from four,
 * and the first time it disagreed with the rows nobody would know which to
 * believe.
 */
export type CommunityAnalysisState =
  'draft' | 'submitted' | 'approved' | 'changes_requested' | 'rejected' | 'published';

/** The content of an analysis, whatever stage it is at. */
export interface CommunityAnalysisContent {
  predicted_outcome: CommunityOutcome;
  /** Both or neither, and consistent with the outcome. */
  predicted_home: number | null;
  predicted_away: number | null;
  confidence: CommunityConfidence;
  /** Required: an analysis with no reasoning is a prediction, and those exist already. */
  reasoning: string;
  /** Absent means absent, never an empty string pretending to be prose (rule 3). */
  lineup_impact: string | null;
  key_players: string | null;
  form_and_context: string | null;
}

/**
 * The author, as a reader sees them (blueprint 10.3).
 *
 * The name and the rating travel with every published analysis, because on a
 * public page they are what separates one analyst's call from another's — the
 * same argument the panel makes about posts, and the reason the reputation
 * system is visible where it matters.
 */
export interface CommunityAnalyst {
  username: string;
  display_name: string;
  /** Null when they have settled nothing. Not zero: they were not rated badly. */
  rating: number | null;
  /** Whether they hold a live contributor grant now. */
  approved: boolean;
}

/** One published version. Immutable; the newest is current. */
export interface CommunityAnalysisVersion extends CommunityAnalysisContent {
  id: string;
  version_number: number;
  /** ISO 8601. */
  published_at: string;
}

/** What the public reads: one analyst's analysis of one match. */
export interface CommunityAnalysis {
  id: string;
  fixture_id: string;
  author: CommunityAnalyst;
  /** Newest first. Never empty on a published analysis. */
  versions: CommunityAnalysisVersion[];
}

/** `GET /fixtures/:id/community-analyses`. */
export interface CommunityAnalysesResponse {
  /** Newest published first. */
  analyses: CommunityAnalysis[];
  /** ISO 8601, when this page was assembled. */
  generated_at: string;
}

/** One reviewer's decision about one submission. */
export interface CommunityReview {
  decision: 'approved' | 'changes_requested' | 'rejected';
  reviewer: string;
  /** Required on every decision, including an approval. */
  reason: string;
  /** ISO 8601. */
  created_at: string;
}

/** One attempt at getting an analysis published. */
export interface CommunitySubmission extends CommunityAnalysisContent {
  id: string;
  attempt: number;
  /** ISO 8601. */
  submitted_at: string;
  /** Null while it is still waiting to be read. */
  review: CommunityReview | null;
}

/**
 * `GET /me/analyses/:id` — the analyst's own view of their work.
 *
 * The draft, every attempt and every decision. An analyst who was asked for
 * changes needs to see what they submitted and what was said about it, or the
 * request is an instruction with no context.
 */
export interface CommunityAnalysisWorkspace {
  id: string;
  fixture_id: string;
  state: CommunityAnalysisState;
  draft: CommunityAnalysisContent | null;
  /** Oldest first: it is a story. */
  submissions: CommunitySubmission[];
  versions: CommunityAnalysisVersion[];
}

/** `PUT /me/analyses/:fixtureId` — create or replace the draft. */
export type SaveAnalysisDraftRequest = CommunityAnalysisContent;

/** `POST /admin/analysis-reviews/:submissionId`. */
export interface ReviewAnalysisRequest {
  decision: 'approved' | 'changes_requested' | 'rejected';
  reason: string;
}
