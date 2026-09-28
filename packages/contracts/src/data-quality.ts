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

/** Open findings per competition and check, for the page's summary. */
export interface DataQualityCount {
  competition: { id: string; name: string } | null;
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
}

/** `POST /admin/data-quality/:id/review`: marks an open finding reviewed. */
export interface ReviewDataQualityFindingRequest {
  reason: string;
}
