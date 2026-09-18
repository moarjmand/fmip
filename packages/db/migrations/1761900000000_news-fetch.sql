-- Up Migration
-- T-142: the record of every attempt to read a publisher's feed, and one
-- correction to the article schema that reading real feeds made necessary.
--
-- `news_fetch` is to a source what `ingest_run` is to a provider (T-026): one
-- row per attempt, 'running' exactly while `finished_at` is NULL, and at most
-- one open run per source -- the partial unique index is the lock that makes
-- a duplicate scheduler tick harmless. A feed that stops answering is then a
-- fact in a table rather than a silence, which is what rule 4 asks of every
-- live surface, and what T-143's sections will read before they claim to be
-- current.
CREATE TABLE news_fetch (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id      uuid NOT NULL REFERENCES news_source (id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'running',
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  items_seen     integer NOT NULL DEFAULT 0,
  items_written  integer NOT NULL DEFAULT 0,
  error          text,
  CONSTRAINT news_fetch_status_check
    CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  CONSTRAINT news_fetch_running_is_open CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT news_fetch_times_ordered CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT news_fetch_counts_non_negative CHECK (items_seen >= 0 AND items_written >= 0),
  CONSTRAINT news_fetch_failed_has_error CHECK (status <> 'failed' OR error IS NOT NULL)
);

CREATE INDEX news_fetch_recent_idx ON news_fetch (source_id, started_at DESC);

CREATE UNIQUE INDEX news_fetch_one_running_per_source
  ON news_fetch (source_id)
  WHERE status = 'running';

COMMENT ON TABLE news_fetch IS
  'One attempt to read a publisher''s feed (T-142): running while open, then succeeded, partial or failed, with the counts and the reason. One open run per source.';

-- A publisher who gives no time gives no time. `article_version.published_at`
-- was NOT NULL in T-141, which would have forced the fetch time into a column
-- that means something else -- the fetch time already lives on the article,
-- and writing it here would present "when we noticed" as "when they published"
-- (rule 3). NULL is the honest value, and the page says the time was not given.
ALTER TABLE article_version ALTER COLUMN published_at DROP NOT NULL;

COMMENT ON COLUMN article_version.published_at IS
  'The publisher''s time for this version, or NULL when the feed gave none. Never the fetch time; that is article.fetched_at.';

-- Down Migration
-- A version with no time cannot exist under the older rule, so it goes first.
DELETE FROM article_version WHERE published_at IS NULL;
ALTER TABLE article_version ALTER COLUMN published_at SET NOT NULL;
DROP TABLE news_fetch;
