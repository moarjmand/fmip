-- Up Migration

-- T-223: searching inside one conversation (blueprint 8.3).
--
-- **`search_key` rather than a text-search configuration**, and that is the
-- decision in this migration. Postgres's full-text search stems words, and
-- stemming needs a language: `to_tsvector('english', ...)` would turn a
-- product that speaks eight languages into one that searches well in one of
-- them and badly in seven, silently, with no page saying so. It is the same
-- shape as the abuse classifier D-054 declines to build.
--
-- So this reuses what the product already normalises with: `search_key` (T-038)
-- folds accents and case, and (T-152) folds Arabic-script letter variants and
-- digits and drops the harakat. A trigram index over it gives substring
-- matching that behaves identically in every script it has been taught, and
-- claims nothing about meaning.
--
-- Only messages that still stand are indexed. A removed message has no body to
-- find, and a partial index is smaller for exactly the reason a tombstone is
-- useful: most of what is removed stays removed.
CREATE INDEX message_body_search_idx
  ON message USING gin (search_key(body) gin_trgm_ops)
  WHERE removed_at IS NULL;

COMMENT ON INDEX message_body_search_idx IS
  'Substring search inside a conversation (T-223), over search_key so it behaves the same in every script.';

-- Down Migration

DROP INDEX IF EXISTS message_body_search_idx;
