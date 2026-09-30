import type { CoverageState, DataQualityCoverageProposal } from '@fmip/contracts';

/**
 * What the findings mean for a past season's coverage (T-914, D-109). Pure:
 * the store reads one row per past season and check, this decides whether the
 * season's `lineups` or `incidents` coverage is proposed as `limited`.
 */

/** The share of a season's finished matches, still short after a re-ask, at which coverage is `limited`. */
export const LIMITED_SHARE_PERCENT = 10;

/** One past season and one of the two checks, as the store reads it. */
export interface CoverageCandidateRow {
  season_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  check_kind: 'lineup_not_eleven' | 'goals_disagree';
  /** Finished matches of the season, and how many have had their details fetched (T-102). */
  finished: number;
  fetched: number;
  /** Matches with an open finding of the check, and those still open after a re-ask fetched since the finding was first seen. */
  open: number;
  open_after_reask: number;
  /** The provider that fetched most of the season's details; `null` when none was fetched. */
  fetch_provider: string | null;
  /** People from the season's provider(s) waiting in `unresolved_entity` (D-079's adoption lag). */
  pending_people: number;
  coverage_state: CoverageState | null;
  coverage_provider: string | null;
  coverage_note: string | null;
}

const MODULE = { lineup_not_eleven: 'lineups', goals_disagree: 'incidents' } as const;

const WHAT = {
  lineup_not_eleven: 'a line-up that is not eleven',
  goals_disagree: 'goals in the timeline that disagree with the score',
} as const;

/**
 * The proposal for one row, or `null` while any condition of D-109 does not
 * hold: every finished match fetched, nobody from the provider waiting to be
 * adopted, at least 10% still short after one re-ask, and the season not
 * already declared `limited` or `not_supplied`.
 */
export function coverageProposal(row: CoverageCandidateRow): DataQualityCoverageProposal | null {
  if (row.finished === 0 || row.fetched < row.finished) return null;
  if (row.pending_people > 0) return null;
  if (row.open_after_reask * 100 < row.finished * LIMITED_SHARE_PERCENT) return null;
  if (row.coverage_state === 'limited' || row.coverage_state === 'not_supplied') return null;
  const provider = row.coverage_provider ?? row.fetch_provider;
  if (provider === null) return null;
  const module = MODULE[row.check_kind];
  return {
    competition: { id: row.competition_id, name: row.competition_name },
    season: { id: row.season_id, label: row.season_label },
    module,
    check: row.check_kind,
    current: {
      state: row.coverage_state,
      provider: row.coverage_provider,
      note: row.coverage_note,
    },
    proposed: {
      state: 'limited',
      provider,
      note:
        `${row.open_after_reask} of ${row.finished} finished matches still show ` +
        `${WHAT[row.check_kind]} after the feed was asked again.`,
    },
    counts: {
      finished: row.finished,
      fetched: row.fetched,
      open: row.open,
      open_after_reask: row.open_after_reask,
    },
  };
}
