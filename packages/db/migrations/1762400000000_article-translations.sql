-- Up Migration
-- T-304 (blueprint 3.3 and 13): one canonical article with a controlled
-- version per language.
--
-- A language version is a version -- the same immutable row T-141 defined,
-- with its own `created_at` as its last-updated time -- and it now says
-- where it came from: the publisher's own words (`origin = 'publisher'`), or
-- a translation a person wrote (`origin = 'translation'`), which carries a
-- review state exactly as the catalogue's strings do (T-302, D-066):
-- `translated` by a fluent speaker, `reviewed` by a second. A review is a
-- new version, not an edit, because nothing here is edited (rule 5); the
-- reviewed row names both people. Nothing is ever machine-translated and
-- presented as a translation (T-151): a translation has a `written_by`, and
-- the constraint insists on it.
ALTER TABLE article_version
  ADD COLUMN origin       text NOT NULL DEFAULT 'publisher',
  ADD COLUMN review_state text,
  ADD COLUMN written_by   uuid REFERENCES user_account (id) ON DELETE RESTRICT,
  ADD COLUMN reviewed_by  uuid REFERENCES user_account (id) ON DELETE RESTRICT,
  ADD CONSTRAINT article_version_origin_check CHECK (origin IN ('publisher', 'translation')),
  ADD CONSTRAINT article_version_review_state_check
    CHECK (review_state IS NULL OR review_state IN ('translated', 'reviewed')),
  -- The publisher's words have no review state and no author here; a
  -- translation has both a state and the person who wrote it.
  ADD CONSTRAINT article_version_translation_is_whole CHECK (
    (origin = 'publisher' AND review_state IS NULL AND written_by IS NULL AND reviewed_by IS NULL)
    OR (origin = 'translation' AND review_state IS NOT NULL AND written_by IS NOT NULL)
  ),
  -- A reviewed translation names its reviewer; an unreviewed one has none.
  ADD CONSTRAINT article_version_review_is_whole
    CHECK (review_state IS DISTINCT FROM 'reviewed' OR reviewed_by IS NOT NULL),
  ADD CONSTRAINT article_version_reviewed_by_another
    CHECK (reviewed_by IS NULL OR reviewed_by <> written_by);

COMMENT ON COLUMN article_version.origin IS
  'publisher: the words as the feed carried them; translation: a person''s rendering of them (T-304).';
COMMENT ON COLUMN article_version.review_state IS
  'For a translation: translated by a fluent speaker, or reviewed by a second one (T-304, D-066).';

-- Down Migration

ALTER TABLE article_version
  DROP CONSTRAINT article_version_reviewed_by_another,
  DROP CONSTRAINT article_version_review_is_whole,
  DROP CONSTRAINT article_version_translation_is_whole,
  DROP CONSTRAINT article_version_review_state_check,
  DROP CONSTRAINT article_version_origin_check,
  DROP COLUMN reviewed_by,
  DROP COLUMN written_by,
  DROP COLUMN review_state,
  DROP COLUMN origin;
