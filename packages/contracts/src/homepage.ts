// ---------------------------------------------------------------------------
// Featured matches on the homepage (blueprint 2.3 and 16, T-1161, D-153): an
// editor features a match for a window, with a note readers see beside it,
// and may clear it early with a reason. Editorial placement only: it says
// nothing about who will win, and it never touches the model's forecast, the
// founder's analysis or the community's consensus (rule 6).
// ---------------------------------------------------------------------------

/** The shortest window a feature may be given, in hours. */
export const HOMEPAGE_FEATURE_MIN_HOURS = 1;
/** The longest: the homepage looks two weeks ahead, and a feature cannot outlast that. */
export const HOMEPAGE_FEATURE_MAX_HOURS = 14 * 24;
/** The most features in force the public answer carries. */
export const HOMEPAGE_FEATURE_LIMIT = 20;

/** `POST /admin/fixtures/:id/feature`: the note readers see, and how long it lasts. Audited. */
export interface HomepageFeatureRequest {
  note: string;
  /** Whole hours from now, `HOMEPAGE_FEATURE_MIN_HOURS` to `HOMEPAGE_FEATURE_MAX_HOURS`. */
  hours: number;
}

/** `POST /admin/fixtures/:id/feature/clear`: ends a feature early; the reason is audited. */
export interface HomepageFeatureClearRequest {
  reason: string;
}

/** One feature as the editor's list shows it: in force, expired or cleared. */
export interface HomepageFeatureRecord {
  fixture_id: string;
  home: string;
  away: string;
  kickoff_at: string;
  featured_by: string;
  note: string;
  featured_at: string;
  ends_at: string;
  cleared_by: string | null;
  cleared_reason: string | null;
  cleared_at: string | null;
  /** `live` while in force; `expired` when its window ran out; `cleared` when an editor ended it. */
  state: 'live' | 'expired' | 'cleared';
}

/** `GET /admin/homepage-features`: newest feature first. */
export interface HomepageFeatureListResponse {
  generated_at: string;
  features: HomepageFeatureRecord[];
}

/** One match featured now, as the homepage reads it. */
export interface FeaturedMatch {
  fixture_id: string;
  note: string;
  featured_at: string;
  ends_at: string;
}

/**
 * `GET /featured-matches`: the matches featured now, newest feature first.
 * Public (a guest sees them). An empty list is a real answer: nothing is
 * featured, and the homepage is as it was.
 */
export interface FeaturedMatchesResponse {
  generated_at: string;
  features: FeaturedMatch[];
}
