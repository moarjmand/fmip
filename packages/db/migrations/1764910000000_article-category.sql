-- Up Migration

-- ---------------------------------------------------------------------------
-- The publisher's own category strings on a feed item, as carried (T-1002,
-- D-123).
--
-- A story's `publisher` type comes from these through an exact, committed
-- mapping keyed by the source's feed host and the string itself
-- (`apps/api/src/modules/news/internal/story-type-mapping.ts`). They are kept
-- as the feed carried them -- not lower-cased, not trimmed beyond the feed
-- reader's whitespace, not translated -- because the mapping is exact and a
-- normalised copy would make "exact" mean something the publisher never wrote.
--
-- The set is the latest fetch's: a category the publisher removed from an
-- item is removed here, and the story's publisher type follows it. A row per
-- string, keyed by the article, so an item's categories are a set.
-- ---------------------------------------------------------------------------
CREATE TABLE article_category (
  article_id     uuid NOT NULL REFERENCES article (id) ON DELETE CASCADE,
  category       text NOT NULL,
  -- The position in the item, so the set reads back in the feed's order.
  position       smallint NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, category),
  CONSTRAINT article_category_not_blank CHECK (btrim(category) <> ''),
  CONSTRAINT article_category_position_valid CHECK (position >= 0)
);

COMMENT ON TABLE article_category IS
  'The category strings a publisher''s feed carried on an item, as carried, from the latest fetch (T-1002, D-123).';

-- Down Migration

DROP TABLE article_category;
