/**
 * The founder's match analysis (blueprint 6.5, T-130).
 *
 * One of the **three** prediction products, and it stays one of three. The
 * statistical model, this, and the community consensus are never blended or
 * relabelled (rule 6), which is why this file shares no type with
 * `forecast.ts`: an analysis has an author and prose, a forecast has a model
 * version and probabilities, and nothing should make it easy to pass one where
 * the other is expected.
 *
 * Versions, not edits. The blueprint asks for "publication time and any clearly
 * recorded update before kick-off", so an update is a new version with its own
 * publication time and the previous one stays readable.
 */

export type FounderOutcome = 'home' | 'draw' | 'away';

/** 1 (lowest) to 5 (highest), the same scale a member's prediction uses. */
export type FounderConfidence = 1 | 2 | 3 | 4 | 5;

export interface FounderAnalysisVersion {
  id: string;
  version_number: number;
  predicted_outcome: FounderOutcome;
  /** Both or neither, and never contradicting the outcome. */
  predicted_score: { home: number; away: number } | null;
  confidence: FounderConfidence;
  /** Required: an analysis with no reasoning is a prediction, not an analysis. */
  reasoning: string;
  /** The blueprint's optional sections. Absent is `null`, never an empty string. */
  lineup_impact: string | null;
  key_players: string | null;
  form_and_context: string | null;
  /** ISO 8601. */
  published_at: string;
}

export interface FounderAnalysis {
  id: string;
  fixture_id: string;
  /** Who signed it. The blueprint asks that each entry be signed personally. */
  author: { id: string; display_name: string };
  /** Newest first. The first entry is what the page shows. */
  versions: FounderAnalysisVersion[];
}

/**
 * One analysis as a feed shows it: enough to decide whether to read it, and
 * never enough to be mistaken for the model's forecast or the crowd's view.
 */
export interface FounderAnalysisSummary {
  fixture: {
    id: string;
    kickoff_at: string;
    status: string;
    home: { id: string; name: string };
    away: { id: string; name: string };
    competition: { id: string; name: string };
  };
  author: { id: string; display_name: string };
  predicted_outcome: FounderOutcome;
  predicted_score: { home: number; away: number } | null;
  confidence: FounderConfidence;
  /** The opening of the reasoning, for a feed. The full text is on the match page. */
  excerpt: string;
  published_at: string;
  version_number: number;
}

/**
 * `GET /founder-analyses?limit=&team=&competition=`.
 *
 * The feed behind the homepage and the team and competition pages. Upcoming
 * matches only: an analysis of a match that has finished belongs in the record,
 * not in a feed of what to read next.
 */
export interface FounderAnalysesResponse {
  analyses: FounderAnalysisSummary[];
}

/**
 * `GET /fixtures/:id/founder-analysis`.
 *
 * `analysis` is null when the founder has not written one — which is the normal
 * case, because the blueprint scopes this to "important and popular fixtures".
 * A match without one is not a match missing something.
 */
export interface FounderAnalysisResponse {
  fixture_id: string;
  analysis: FounderAnalysis | null;
}
