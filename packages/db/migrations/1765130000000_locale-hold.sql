-- Up Migration

-- ---------------------------------------------------------------------------
-- Holding back a language that is ready (blueprint 13 and 16, T-1163, D-155).
--
-- A locale is offered exactly when its catalogue passes `isShippable` (T-306).
-- An administrator may hold one back -- a translation that reads wrong in
-- review, a legal page not yet checked in that language -- with a reason, and
-- release it later with another. The catalogue files are the translators'
-- and are never touched (D-066); a hold only stops the product offering the
-- language.
--
-- A hold is a row with its actor and reason, and its release keeps the row
-- with its own actor and reason, so "who took French away, why, and when did
-- it come back" is answered by the table. At most one hold in force per
-- locale: unlike a window, "in force" does not depend on `now()`, so a
-- partial unique index can say it. English, the source language (D-003), is
-- never held: it is what a held language falls back to.
-- ---------------------------------------------------------------------------
CREATE TABLE locale_hold (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale          text NOT NULL,
  held_by         uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  reason          text NOT NULL,
  held_at         timestamptz NOT NULL DEFAULT now(),
  released_by     uuid REFERENCES user_account (id) ON DELETE SET NULL,
  release_reason  text,
  released_at     timestamptz,
  CONSTRAINT locale_hold_locale_format CHECK (locale ~ '^[a-z]{2,3}$'),
  CONSTRAINT locale_hold_not_source CHECK (locale <> 'en'),
  CONSTRAINT locale_hold_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT locale_hold_released_is_whole
    CHECK ((released_at IS NULL) = (release_reason IS NULL)),
  CONSTRAINT locale_hold_release_reason_not_blank
    CHECK (release_reason IS NULL OR btrim(release_reason) <> ''),
  CONSTRAINT locale_hold_release_after_hold
    CHECK (released_at IS NULL OR released_at >= held_at)
);

CREATE UNIQUE INDEX locale_hold_one_in_force ON locale_hold (locale) WHERE released_at IS NULL;

CREATE INDEX locale_hold_history_idx ON locale_hold (locale, held_at DESC);

COMMENT ON TABLE locale_hold IS
  'A ready locale held back by an administrator, who and why, and its release (T-1163, D-155).';

-- Down Migration

DROP TABLE locale_hold;
