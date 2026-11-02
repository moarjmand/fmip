-- Up Migration
-- T-1716 (D-346): GNews and the publishers it brings are no longer kind
-- `licensed`.
--
-- `licensed` was the only kind without a feed, so T-1367 (D-185) gave it to
-- the GNews row and to every publisher row GNews creates. But GNews runs on
-- its free plan, which its terms allow for non-commercial use only, and the
-- word reads as a commercial licence. Two kinds now say what these rows are:
--
-- - `aggregator`: a search API over many publishers, queried on that API's
--   own plan and terms (the GNews row). It carries no article of its own; its
--   `news_fetch` rows are its requests.
-- - `aggregated`: a publisher whose reports arrive only through an
--   aggregator, never read directly (each row with `via_source_id`).
--
-- `licensed` stays in the check for a wire under a real licence; no row holds
-- it after this migration. Nothing a reader sees changes: no read path looks
-- at `kind` except the feed job (`rss`/`atom` only), the GNews job (which now
-- finds its row by `aggregator`) and the console (which edits feeds only).
--
-- `via_source_id` and the kind now agree both ways: a row with a
-- `via_source_id` is `aggregated`, and an `aggregated` row has one.

ALTER TABLE news_source
  DROP CONSTRAINT news_source_via_is_licensed,
  DROP CONSTRAINT news_source_kind_check,
  DROP CONSTRAINT news_source_feed_for_feed_kinds;

ALTER TABLE news_source
  ADD CONSTRAINT news_source_kind_check
    CHECK (kind IN ('rss', 'atom', 'licensed', 'aggregator', 'aggregated')),
  ADD CONSTRAINT news_source_feed_for_feed_kinds
    CHECK (kind IN ('licensed', 'aggregator', 'aggregated') OR feed_url IS NOT NULL);

UPDATE news_source SET kind = 'aggregated' WHERE via_source_id IS NOT NULL;
UPDATE news_source SET kind = 'aggregator'
 WHERE id = '00000000-0000-4000-8000-000000001367' AND via_source_id IS NULL;

ALTER TABLE news_source
  ADD CONSTRAINT news_source_via_is_aggregated
    CHECK ((via_source_id IS NOT NULL) = (kind = 'aggregated'));

COMMENT ON COLUMN news_source.kind IS
  'How items arrive (D-346): rss or atom (a publisher feed we read), aggregator (a search API over many publishers, on that API''s own plan, e.g. GNews free), aggregated (a publisher reached only through an aggregator; via_source_id names it), licensed (a wire under a licence; none today).';

-- Down Migration

ALTER TABLE news_source DROP CONSTRAINT news_source_via_is_aggregated;

UPDATE news_source SET kind = 'licensed' WHERE kind IN ('aggregator', 'aggregated');

ALTER TABLE news_source
  DROP CONSTRAINT news_source_kind_check,
  DROP CONSTRAINT news_source_feed_for_feed_kinds;

ALTER TABLE news_source
  ADD CONSTRAINT news_source_kind_check CHECK (kind IN ('rss', 'atom', 'licensed')),
  ADD CONSTRAINT news_source_feed_for_feed_kinds CHECK (kind = 'licensed' OR feed_url IS NOT NULL),
  ADD CONSTRAINT news_source_via_is_licensed CHECK (via_source_id IS NULL OR kind = 'licensed');

COMMENT ON COLUMN news_source.kind IS NULL;
