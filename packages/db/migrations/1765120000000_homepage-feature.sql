-- Up Migration

-- ---------------------------------------------------------------------------
-- Featured matches on the homepage (blueprint 2.3 and 16, T-1161, D-153).
--
-- An editor features a match for a window, with a note readers see beside
-- it; the homepage lists featured matches first after a member's own
-- favourites. A feature is a row with an actor, a note and the moment it
-- ends, not a flag on `fixture`: "who put this match on the front page, why,
-- and until when" is the question asked when one goes wrong, as for the
-- breaking mark (T-1004, D-125), whose shape this follows.
--
-- A feature ends by itself at `ends_at` -- the homepage reads
-- `ends_at > now()` at render, so an expired feature is gone on the next
-- render and no job takes it down -- or earlier, cleared by an editor with a
-- reason, which keeps the row with its own actor and reason. At most one
-- feature in force per match is kept by the writer under the match's row
-- lock rather than by an index, because "in force" depends on `now()`.
-- ---------------------------------------------------------------------------
CREATE TABLE homepage_feature (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id      uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  featured_by     uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  -- What the reader is shown beside the match: why it is featured.
  note            text NOT NULL,
  featured_at     timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz NOT NULL,
  cleared_by      uuid REFERENCES user_account (id) ON DELETE SET NULL,
  cleared_reason  text,
  cleared_at      timestamptz,
  CONSTRAINT homepage_feature_note_not_blank CHECK (btrim(note) <> ''),
  CONSTRAINT homepage_feature_window_valid CHECK (ends_at > featured_at),
  CONSTRAINT homepage_feature_cleared_is_whole
    CHECK ((cleared_at IS NULL) = (cleared_reason IS NULL)),
  CONSTRAINT homepage_feature_cleared_reason_not_blank
    CHECK (cleared_reason IS NULL OR btrim(cleared_reason) <> '')
);

CREATE INDEX homepage_feature_fixture_idx ON homepage_feature (fixture_id, featured_at DESC);

CREATE INDEX homepage_feature_live_idx
  ON homepage_feature (ends_at DESC) WHERE cleared_at IS NULL;

COMMENT ON TABLE homepage_feature IS
  'A match an editor features on the homepage: note, window and who, and who cleared it early and why (T-1161, D-153).';

-- Down Migration

DROP TABLE homepage_feature;
