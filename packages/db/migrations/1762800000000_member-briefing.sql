-- Up Migration
-- T-431 (Phase 5, D-070): a member's briefing as an immutable version --
-- what a language model wrote over the Following feed's window, with the
-- document it was given (the items, by id), the prompt version, the model
-- and when. `published` rows are what the member sees; `rejected` rows are
-- attempts the gate or a refusal turned down, kept and never served. A
-- member's own, read only by them; nothing is updated or deleted (rule 5).
CREATE TABLE member_briefing (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  since          timestamptz NOT NULL,
  until          timestamptz NOT NULL,
  language       text NOT NULL DEFAULT 'en',
  state          text NOT NULL,
  text           text,
  rejection      text,
  document       jsonb NOT NULL,
  prompt_version text NOT NULL,
  model          text NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_briefing_state_check CHECK (state IN ('published', 'rejected')),
  CONSTRAINT member_briefing_published_has_text
    CHECK (state <> 'published' OR (text IS NOT NULL AND btrim(text) <> '')),
  CONSTRAINT member_briefing_rejected_has_reason
    CHECK (state <> 'rejected' OR (rejection IS NOT NULL AND btrim(rejection) <> '')),
  CONSTRAINT member_briefing_window_ordered CHECK (until > since),
  CONSTRAINT member_briefing_one_per_version UNIQUE (user_id, version_number)
);

CREATE INDEX member_briefing_latest_idx ON member_briefing (user_id, version_number DESC);

COMMENT ON TABLE member_briefing IS
  'What a language model wrote over a member''s Following feed window, as immutable versions with the document it was given (Phase 5, T-431, D-070).';

CREATE TRIGGER member_briefing_immutable
  BEFORE UPDATE OR DELETE ON member_briefing FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TRIGGER IF EXISTS member_briefing_immutable ON member_briefing;
DROP TABLE member_briefing;
