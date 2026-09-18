-- Up Migration
-- T-313 (D-069): viewing data is editorial, link-only, until a licence says
-- otherwise.
--
-- T-311 built the rights model before the source existed, so that a second
-- source with more rights would slot in rather than be retrofitted. This is
-- the first source: the editorial desk. An editor enters a listing from a
-- public schedule -- this match, in this territory, on this service, at this
-- official page -- and a highlight is the official page and nothing else,
-- because a desk holds no rights to anybody's video. `rights = 'link'` makes
-- `PL017` refuse a thumbnail or an embed from it, in the schema, however the
-- writer is rewritten.
--
-- A manual source has no external homepage: it is this product's own desk.
-- The column was NOT NULL for feeds, where a source without an address is a
-- source nobody can check; for a manual one the check is the audit log.
ALTER TABLE viewing_source ALTER COLUMN homepage_url DROP NOT NULL;
ALTER TABLE viewing_source
  ADD CONSTRAINT viewing_source_external_has_homepage
  CHECK (kind = 'manual' OR homepage_url IS NOT NULL);

-- A fixed id, so the API names the desk by id and never by name (rule 1).
INSERT INTO viewing_source (id, name, homepage_url, kind, rights)
VALUES ('00000000-0000-4000-8000-000000000901', 'Editorial desk', NULL, 'manual', 'link');

COMMENT ON COLUMN viewing_source.homepage_url IS
  'Where the source lives; required for anything but the editorial desk, which lives here (T-313).';

-- Down Migration

DELETE FROM viewing_source WHERE id = '00000000-0000-4000-8000-000000000901';
ALTER TABLE viewing_source DROP CONSTRAINT viewing_source_external_has_homepage;
ALTER TABLE viewing_source ALTER COLUMN homepage_url SET NOT NULL;
