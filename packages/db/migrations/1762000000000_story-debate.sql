-- Up Migration

-- ---------------------------------------------------------------------------
-- The debate section is what editors selected (blueprint 3.1, T-143).
--
-- A selection is a row with an actor and a reason, not a flag on `story`: a
-- flag has no history and no author, and "who put this on the debate page and
-- why" is the question asked when a selection goes wrong. Clearing keeps the
-- row, with its own actor and reason, so the page's history is a table and not
-- a memory. One open selection per story by a partial unique index.
--
-- "Or supported by genuine discussion signals" (blueprint 3.1) is not built
-- here: the signals the platform measures today are the ones trending already
-- ranks by, and a second section computed from the same numbers would be the
-- same list under another name. When editors have selected nothing, the
-- section says so rather than showing trending again.
-- ---------------------------------------------------------------------------
CREATE TABLE story_debate (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id       uuid NOT NULL REFERENCES story (id) ON DELETE CASCADE,
  selected_by    uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  -- What the reader is shown beside the story: why this is a debate.
  note           text NOT NULL,
  selected_at    timestamptz NOT NULL DEFAULT now(),
  cleared_by     uuid REFERENCES user_account (id) ON DELETE SET NULL,
  cleared_reason text,
  cleared_at     timestamptz,
  CONSTRAINT story_debate_note_not_blank CHECK (btrim(note) <> ''),
  CONSTRAINT story_debate_cleared_is_whole
    CHECK ((cleared_at IS NULL) = (cleared_reason IS NULL))
);

CREATE UNIQUE INDEX story_debate_one_open_per_story
  ON story_debate (story_id) WHERE cleared_at IS NULL;

CREATE INDEX story_debate_open_idx
  ON story_debate (selected_at DESC) WHERE cleared_at IS NULL;

COMMENT ON TABLE story_debate IS
  'An editor''s selection of a story for the debate section, with who and why, and who cleared it and why (blueprint 3.1, T-143).';

-- Down Migration

DROP TABLE story_debate;
