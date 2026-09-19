-- Up Migration
-- T-440 (Phase 5, D-070): what a language model suggested about a report,
-- as an immutable row beside it. A suggestion is a category and a reason
-- a moderator can ignore; it is never a decision, and nothing in the
-- moderation tables references it. Rejected attempts -- an answer that was
-- not a suggestion, a refusal -- are kept for the record and never shown.
CREATE TABLE moderation_suggestion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      uuid NOT NULL REFERENCES report (id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  state          text NOT NULL,
  category       text,
  reasoning      text,
  rejection      text,
  prompt_version text NOT NULL,
  model          text NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_suggestion_state_check CHECK (state IN ('published', 'rejected')),
  CONSTRAINT moderation_suggestion_category_check
    CHECK (category IS NULL OR category IN ('spam', 'abuse', 'impersonation', 'other', 'no_action')),
  CONSTRAINT moderation_suggestion_published_is_whole
    CHECK (state <> 'published' OR (category IS NOT NULL AND reasoning IS NOT NULL AND btrim(reasoning) <> '')),
  CONSTRAINT moderation_suggestion_rejected_has_reason
    CHECK (state <> 'rejected' OR (rejection IS NOT NULL AND btrim(rejection) <> '')),
  CONSTRAINT moderation_suggestion_one_per_version UNIQUE (report_id, version_number)
);

CREATE INDEX moderation_suggestion_latest_idx ON moderation_suggestion (report_id, version_number DESC);

COMMENT ON TABLE moderation_suggestion IS
  'What a language model suggested about a report -- a category and a reason a moderator can ignore, never a decision (Phase 5, T-440, D-070).';

CREATE TRIGGER moderation_suggestion_immutable
  BEFORE UPDATE OR DELETE ON moderation_suggestion FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TRIGGER IF EXISTS moderation_suggestion_immutable ON moderation_suggestion;
DROP TABLE moderation_suggestion;
