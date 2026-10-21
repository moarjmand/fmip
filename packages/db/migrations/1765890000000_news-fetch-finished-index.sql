-- Up Migration
-- When the feeds were last read (T-1459): `lastFetchedAt` asks
-- `max(finished_at)` over the finished reads on every news request -- the
-- section, a match's, a team's, a player's -- and `news_fetch` gains a row per
-- source per read, so the scan grew with every day (19 full scans of 6,262
-- rows in ninety seconds on 2026-10-21). The partial index answers it from its
-- first entry.
CREATE INDEX news_fetch_finished_idx ON news_fetch (finished_at DESC)
  WHERE status IN ('succeeded', 'partial');

-- Down Migration
DROP INDEX news_fetch_finished_idx;
