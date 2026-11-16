-- Up Migration
-- T-1845: a trigram index on every stored headline, folded as search folds
-- it, so the search for stories narrows to the headlines that can match
-- (`<%` and the prefix LIKE) in place of resolving every story's shown
-- article first (2.6 s per search on production, 2026-11-16, 40,422 rows).
-- The same kind of index the names already have (1759300000000_search.sql).
CREATE INDEX article_version_headline_trgm_idx
  ON article_version USING gin (search_key(headline) gin_trgm_ops);

-- Down Migration
DROP INDEX IF EXISTS article_version_headline_trgm_idx;
