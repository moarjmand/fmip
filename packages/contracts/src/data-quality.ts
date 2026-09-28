/**
 * Data-quality checks over the stored feed (T-820, E82, D-097).
 *
 * Each check reads what ingestion has already stored -- never a new provider
 * request -- and names what contradicts itself. A finding is a question for a
 * person: nothing is corrected automatically.
 *
 * - `finished_without_score`: a finished match with no full-time score.
 * - `goals_disagree`: the goals in the timeline do not add up to the score.
 * - `live_overrun`: a match still live far past its expected length.
 * - `lineup_not_eleven`: one side's line-up does not have eleven starters.
 * - `fixture_mapped_twice`: one fixture carries two ids from one provider.
 * - `duplicate_fixture`: two fixtures of one season with the same home and
 *   away teams within three days -- one match stored twice.
 * - `table_disagrees`: the provider's table and the table computed from our
 *   results (D-038) disagree on how many matches a team has played.
 */
export type DataQualityCheck =
  | 'finished_without_score'
  | 'goals_disagree'
  | 'live_overrun'
  | 'lineup_not_eleven'
  | 'fixture_mapped_twice'
  | 'duplicate_fixture'
  | 'table_disagrees';

export const DATA_QUALITY_CHECKS: readonly DataQualityCheck[] = [
  'finished_without_score',
  'goals_disagree',
  'live_overrun',
  'lineup_not_eleven',
  'fixture_mapped_twice',
  'duplicate_fixture',
  'table_disagrees',
];

/** A fixture a finding is about, named as the scores page names it. */
export interface DataQualityFixtureRef {
  id: string;
  home: string;
  away: string;
  kickoff_at: string;
  status: string;
}

/**
 * One open finding (T-821): what the check found, where, since when, and
 * whether an administrator has reviewed it. Resolved findings are history
 * and are counted, not listed.
 */
export interface DataQualityFinding {
  id: number;
  check: DataQualityCheck;
  detail: string;
  competition: { id: string; name: string } | null;
  season: { id: string; label: string } | null;
  fixture: DataQualityFixtureRef | null;
  /** The other fixture of a `duplicate_fixture` pair. */
  related_fixture: DataQualityFixtureRef | null;
  team: { id: string; name: string } | null;
  first_seen_at: string;
  last_seen_at: string;
  /** `null` until an administrator marks it reviewed, with a reason (audited). */
  reviewed: { at: string; by: string | null; reason: string } | null;
  /**
   * The newest time an administrator asked the feed again for the finding's
   * fixture (T-913), or `null` if nobody has. `fetched_at` is `null` while it
   * waits for the post-match job. `changed` says whether the answer changed
   * anything stored. A finding still open after a fetch that changed nothing
   * is "asked again on <date>, unchanged".
   */
  asked_again: { requested_at: string; fetched_at: string | null; changed: boolean | null } | null;
}

/**
 * When a check last ran, and whether that is recent enough to trust "no
 * findings" (rule 4): `never_run`, `stale` past three of its intervals, else
 * `current`.
 */
export interface DataQualityCheckState {
  check: DataQualityCheck;
  checked_at: string | null;
  freshness: 'current' | 'stale' | 'never_run';
  open: number;
}

/**
 * Open findings per competition, season and check, for the page's summary.
 * One row is also what a batch review marks (T-912).
 */
export interface DataQualityCount {
  competition: { id: string; name: string } | null;
  /** `null` for a finding about no season (none of the checks writes one today). */
  season: { id: string; label: string } | null;
  check: DataQualityCheck;
  open: number;
  reviewed: number;
}

/** `GET /admin/data-quality` (admin role only). */
export interface DataQualityReport {
  generated_at: string;
  checks: DataQualityCheckState[];
  counts: DataQualityCount[];
  /** Open findings, newest first seen first, at most a page of them. */
  findings: DataQualityFinding[];
  /** How many open findings there are in all; `findings` may be fewer. */
  open_total: number;
  resolved_last_day: number;
  /** Re-asks of the feed waiting for the post-match job, and those it carried since 00:00 UTC (T-913). */
  refetch: { pending: number; fetched_today: number };
}

/** `POST /admin/data-quality/:id/review`: marks an open finding reviewed. */
export interface ReviewDataQualityFindingRequest {
  reason: string;
}

/**
 * `POST /admin/data-quality/review-batch` (T-912): marks every open, not yet
 * reviewed finding of one check in one season reviewed with one reason. One
 * audit row names the check, the season, the count and the reason, and holds
 * the finding ids as the previous value (rule 10).
 */
export interface ReviewDataQualityBatchRequest {
  check: DataQualityCheck;
  season_id: string;
  reason: string;
}

export interface ReviewDataQualityBatchResponse {
  /** How many findings this batch marked reviewed. */
  reviewed: number;
}

/**
 * `POST /admin/data-quality/refetch` (T-913, D-110): asks the feed again for
 * one fixture's details, or for every fixture behind one check's open
 * findings in one season. The post-match job carries the queue within its
 * share of the day's request budget. The request and its reason are audited.
 */
export type RefetchDataQualityRequest =
  | { fixture_id: string; reason: string }
  | { check: DataQualityCheck; season_id: string; reason: string };

export interface RefetchDataQualityResponse {
  /** Fixtures newly queued by this request. */
  queued: number;
  /** Fixtures that were already waiting, and are not queued twice. */
  already_queued: number;
}
