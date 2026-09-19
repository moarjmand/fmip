-- Up Migration
-- T-412 (Phase 5, D-070): a finished match whose record holds only the
-- score gets no summary, and that decision is a version too.
--
-- Seen on the first real run (2026-09-19): asked to write from a record with
-- no timeline, no statistics and no line-ups, the model narrated who scored
-- first and how the goals came -- none of it in the record, none of it a
-- name or a number the gate could catch. Nothing is written from a score
-- alone (rule 3). The decision is a `skipped` row with the facts it was
-- taken on and the reason, so the catch-up does not ask again every ten
-- minutes and the page can say why there is none; when the record grows
-- (a timeline arrives), an editor's request writes a real version after it.
ALTER TABLE match_summary DROP CONSTRAINT match_summary_state_check;
ALTER TABLE match_summary ADD CONSTRAINT match_summary_state_check
  CHECK (state IN ('published', 'rejected', 'skipped'));
ALTER TABLE match_summary ADD CONSTRAINT match_summary_skipped_has_reason
  CHECK (state <> 'skipped' OR (rejection IS NOT NULL AND btrim(rejection) <> ''));

COMMENT ON COLUMN match_summary.state IS
  'published: shown; rejected: an attempt the gate, a refusal or a truncation turned down, kept and never served; skipped: nothing was asked because the record held only the score (T-412).';

-- Down Migration

-- Skipped rows are immutable like every version; they go with the triggers off, inside this transaction only.
SET LOCAL session_replication_role = 'replica';
DELETE FROM match_summary WHERE state = 'skipped';
SET LOCAL session_replication_role = 'origin';
ALTER TABLE match_summary DROP CONSTRAINT match_summary_skipped_has_reason;
ALTER TABLE match_summary DROP CONSTRAINT match_summary_state_check;
ALTER TABLE match_summary ADD CONSTRAINT match_summary_state_check
  CHECK (state IN ('published', 'rejected'));
