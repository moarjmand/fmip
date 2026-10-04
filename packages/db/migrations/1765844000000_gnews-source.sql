-- Up Migration
-- T-1367 (D-185): English stories from GNews' free plan.
--
-- GNews is a search over many publishers, not a publisher. Its answer names
-- each article's own publisher, and D-061 says a card shows the publisher's
-- name as a link to their page and that a publisher who asks to be dropped is
-- dropped without argument. Both are properties of a `news_source` row, so
-- each publisher GNews brings is a row of its own: kind `licensed` (no feed
-- of ours to read), created by the job the first time GNews names it,
-- carrying `via_source_id`, the GNews row it arrived through. Every read path
-- (cards, story page, saved, search, alerts) then names the original
-- publisher without a change, and the console drops one publisher, or GNews
-- as a whole, the way it drops any source.
--
-- The GNews row itself is seeded here, because the console adds feeds only
-- (`rss`/`atom`) and a licensed source has no add path. It carries no
-- article; its `news_fetch` rows are the record of every request, which is
-- also what the daily ceiling counts. It does nothing until GNEWS_API_KEY is
-- set: no key, no request, no row written.
--
-- Rights `summary`: title, the publisher's description and the link (D-061);
-- the article's content is never read. No image right (D-177): GNews' photos
-- sit on each publisher's own host, and only a source whose licence covers
-- its photos shows one. Shown to English readers only (D-178), which is the
-- maintainer's English-only focus for this source; the console can change it.

ALTER TABLE news_source
  ADD COLUMN via_source_id uuid REFERENCES news_source (id) ON DELETE CASCADE,
  ADD CONSTRAINT news_source_via_is_licensed CHECK (via_source_id IS NULL OR kind = 'licensed'),
  ADD CONSTRAINT news_source_via_not_self CHECK (via_source_id IS DISTINCT FROM id);

COMMENT ON COLUMN news_source.via_source_id IS
  'For a publisher whose reports arrive through an aggregator (T-1367, D-185): the aggregator''s own row. NULL for a source read directly.';

-- One row per publisher per aggregator, by the publisher's site (an origin).
CREATE UNIQUE INDEX news_source_one_publisher_per_aggregator
  ON news_source (via_source_id, homepage_url)
  WHERE via_source_id IS NOT NULL;

INSERT INTO news_source
  (id, name, homepage_url, feed_url, kind, rights, language, same_language_only)
VALUES
  ('00000000-0000-4000-8000-000000001367', 'GNews', 'https://gnews.io', NULL, 'licensed',
   'summary', 'en', true)
ON CONFLICT (id) DO NOTHING;

-- Down Migration

DELETE FROM news_source WHERE via_source_id = '00000000-0000-4000-8000-000000001367';
DELETE FROM news_source WHERE id = '00000000-0000-4000-8000-000000001367';
DELETE FROM story s WHERE NOT EXISTS (SELECT 1 FROM article a WHERE a.story_id = s.id);
DROP INDEX news_source_one_publisher_per_aggregator;
ALTER TABLE news_source
  DROP CONSTRAINT news_source_via_not_self,
  DROP CONSTRAINT news_source_via_is_licensed,
  DROP COLUMN via_source_id;
