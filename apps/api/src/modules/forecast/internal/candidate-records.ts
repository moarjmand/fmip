import type { CandidateRecord, CandidateRecordsResponse } from '@fmip/contracts';
import { PROMOTION_MINIMUM } from '@fmip/contracts';
import type { CandidateCounts, CandidatePairRow } from './evaluation-store';

/**
 * Every candidate's shadow record (T-1103): each model version with stored
 * shadow forecasts, and each the model service offers now even before its
 * first forecast (a count of zero, never absent). `offered` is null when the
 * service did not answer, so `in_shadow` is unknown rather than false.
 *
 * Numbers only: no verdict is computed here at any count. Promotion is a
 * decision entry with these numbers (D-082), and below the minimum the page
 * says how many there are.
 */
export function candidateRecords(
  counts: readonly CandidateCounts[],
  pairs: readonly CandidatePairRow[],
  offered: readonly string[] | null,
  now: Date,
): CandidateRecordsResponse {
  const versions = new Set<string>([
    ...counts.map((c) => c.modelVersion),
    ...pairs.map((p) => p.modelVersion),
    ...(offered ?? []),
  ]);
  const candidates: CandidateRecord[] = [...versions].sort().map((version) => {
    const count = counts.find((c) => c.modelVersion === version);
    return {
      model_version: version,
      in_shadow: offered === null ? null : offered.includes(version),
      pre_kickoff_evaluated: count?.evaluated ?? 0,
      pre_kickoff_awaiting: count?.awaiting ?? 0,
      after_kickoff: count?.afterKickoff ?? 0,
      unavailable: count?.unavailable ?? 0,
      competitions: pairs
        .filter((p) => p.modelVersion === version)
        .map((p) => ({
          competition: p.competition,
          pairs: p.pairs,
          published_versions: p.publishedVersions,
          candidate: p.candidate,
          published: p.published,
        })),
    };
  });
  return {
    minimum: PROMOTION_MINIMUM,
    service: offered === null ? 'unreachable' : 'answered',
    candidates,
    generated_at: now.toISOString(),
  };
}
