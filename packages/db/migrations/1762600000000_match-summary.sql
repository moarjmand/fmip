-- Up Migration
-- T-411 (Phase 5, D-070): a match summary as an immutable version.
--
-- A summary is what a language model wrote from the match record, and the
-- row keeps everything needed to know what it was given and what it did
-- with it: the facts document (the whole prompt input), the prompt version,
-- the model, the tokens, who asked, and when. `published` rows are what a
-- reader sees; `rejected` rows are attempts the grounding gate, a refusal
-- or a truncation turned down -- kept, never served, so "why is there no
-- summary" has an answer. Nothing is updated or deleted (rule 5): a
-- regeneration is the next version.
CREATE TABLE match_summary (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id     uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  language       text NOT NULL DEFAULT 'en',
  state          text NOT NULL,
  text           text,
  rejection      text,
  facts          jsonb NOT NULL,
  facts_version  text NOT NULL,
  prompt_version text NOT NULL,
  model          text NOT NULL,
  input_tokens   integer,
  output_tokens  integer,
  requested_by   uuid REFERENCES user_account (id) ON DELETE SET NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_summary_state_check CHECK (state IN ('published', 'rejected')),
  CONSTRAINT match_summary_published_has_text
    CHECK (state <> 'published' OR (text IS NOT NULL AND btrim(text) <> '')),
  CONSTRAINT match_summary_rejected_has_reason
    CHECK (state <> 'rejected' OR (rejection IS NOT NULL AND btrim(rejection) <> '')),
  CONSTRAINT match_summary_version_positive CHECK (version_number >= 1),
  CONSTRAINT match_summary_one_per_version UNIQUE (fixture_id, version_number)
);

CREATE INDEX match_summary_latest_idx ON match_summary (fixture_id, version_number DESC);

COMMENT ON TABLE match_summary IS
  'What a language model wrote about a match, as immutable versions with the facts it was given (Phase 5, T-411, D-070); rejected attempts are kept and never served.';

CREATE TRIGGER match_summary_immutable
  BEFORE UPDATE OR DELETE ON match_summary FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TRIGGER IF EXISTS match_summary_immutable ON match_summary;
DROP TABLE match_summary;
