import type { ScoreConflict, ScoreLine } from '@fmip/contracts';
import { scoreConflictOf } from '@fmip/contracts';

/**
 * Whether a finished match's stored scores contradict one another (T-1819,
 * D-414, the maintainer's rule N3 of 2026-11-13). Derived at read time from
 * the lines the match centre and the scores list already load, never stored
 * (as D-343's freshness and D-347's dispute): no column, no backfill, and a
 * score the source repairs clears it on the next read.
 *
 * The two invariants are the data auditor's (`.claude/skills/data-audit/
 * invariants.sql`, D-317), judged on the same rows:
 * - R7 `ninety_exceeds_final`: a side has more goals after ninety minutes
 *   (`full_time`) than after play (`current`). Goals are never taken away.
 * - R1 `extra_time_sum`: with an extra-time line on record, the ninety
 *   minutes plus extra time is not the score after play.
 *
 * Pafos v Hajduk and Los Garres v Manises (`current` 2-0, `full_time` 4-0,
 * an extra-time line) break both; the page read "2–0 · 90′ 4–0".
 *
 * Such a match's score is `limited` and NO line in conflict is shown: the
 * read model withholds `current`, `full_time` and `extra_time` (`withheld`),
 * so no surface can print either number or pick one of them (rule 3). The
 * half-time, shoot-out and aggregate lines are other stored facts and stay.
 *
 * Predictions, settlement and the model's evaluation read their own rows and
 * do not read this.
 */

interface ConflictScores {
  current: ScoreLine | null;
  full_time: ScoreLine | null;
  extra_time: ScoreLine | null;
}

/** The derivation itself is the contracts' (shared with the forecast evaluation answer). */
export { scoreConflictOf };

/** The scores with the lines in conflict withheld; unchanged when there is no conflict. */
export function withheld<S extends ConflictScores>(scores: S, conflict: ScoreConflict | null): S {
  return conflict === null
    ? scores
    : { ...scores, current: null, full_time: null, extra_time: null };
}
