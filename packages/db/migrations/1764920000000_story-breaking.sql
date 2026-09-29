-- Up Migration

-- ---------------------------------------------------------------------------
-- "Breaking": an editor's mark with a window (blueprint 2.3 and 12.2, T-1004,
-- D-125).
--
-- A mark is a row with an actor, a note readers see, and the moment it ends,
-- not a flag on `story`: "who put this on the homepage, why, and until when"
-- is the question asked when a mark goes wrong, as for the debate section
-- (T-143). A mark ends by itself at `ends_at` -- the homepage reads
-- `ends_at > now()` at render, so an expired mark is gone on the next render
-- and no job has to take it down -- or earlier, cleared by an editor with a
-- reason, which keeps the row with its own actor and reason.
--
-- At most one mark in force per story is kept by the writer under the story's
-- row lock rather than by an index, because "in force" depends on `now()`
-- and a partial index cannot say so: an expired, uncleared mark must not stop
-- a story being marked again.
-- ---------------------------------------------------------------------------
CREATE TABLE story_breaking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id        uuid NOT NULL REFERENCES story (id) ON DELETE CASCADE,
  marked_by       uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  -- What the reader is shown on the strip: what is breaking.
  note            text NOT NULL,
  marked_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz NOT NULL,
  cleared_by      uuid REFERENCES user_account (id) ON DELETE SET NULL,
  cleared_reason  text,
  cleared_at      timestamptz,
  CONSTRAINT story_breaking_note_not_blank CHECK (btrim(note) <> ''),
  CONSTRAINT story_breaking_window_valid CHECK (ends_at > marked_at),
  CONSTRAINT story_breaking_cleared_is_whole
    CHECK ((cleared_at IS NULL) = (cleared_reason IS NULL)),
  CONSTRAINT story_breaking_cleared_reason_not_blank
    CHECK (cleared_reason IS NULL OR btrim(cleared_reason) <> '')
);

CREATE INDEX story_breaking_story_idx ON story_breaking (story_id, marked_at DESC);

CREATE INDEX story_breaking_live_idx
  ON story_breaking (ends_at DESC) WHERE cleared_at IS NULL;

COMMENT ON TABLE story_breaking IS
  'An editor''s "breaking" mark on a story: note, window and who, and who cleared it early and why (T-1004, D-125).';

-- Down Migration

DROP TABLE story_breaking;
