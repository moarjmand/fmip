-- Up Migration
-- The half-time interval of a live match (T-1551). The feed says when a
-- match is at half time (`HT`), and until now only the match alerts heard
-- it: the match centre showed "LIVE · 45′" through the interval, as if the
-- second half had stalled. The ingestion writes what the feed last said
-- while the match is live and false otherwise; a reader takes it only for a
-- live match, so a status written by another path never shows a stale
-- interval. Every existing row is false, which is right for every one of
-- them (no backfill: the column means something only during a live match).
ALTER TABLE fixture ADD COLUMN at_half_time boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fixture.at_half_time IS
  'True while the live match is at the half-time interval, as the feed last said (T-1551).';

-- Down Migration
ALTER TABLE fixture DROP COLUMN at_half_time;
