-- Up Migration
-- T-1371 (D-189): when a season's fixture list was last asked for, so the
-- match page can say when a match was last checked, not only when its row
-- last changed.
--
-- The fixtures job asks every hour for a window of days around now, and once
-- a day for the whole season. A scheduled match whose row has not changed
-- for days was still confirmed an hour ago; nothing recorded that. A
-- timestamp per fixture would be one more row write per match per poll, on a
-- database whose WAL volume already sets the backup window (D-157), so the
-- poll is recorded once per season and provider per run instead: the window
-- last asked for and when, and when the whole season was last asked for. A
-- match was checked at `window_polled_at` when its kick-off date is inside
-- the window, and at `season_polled_at` in any case. Only an answered ask is
-- written; a refused one leaves the last answer standing.

CREATE TABLE season_fixture_poll (
  season_id        uuid NOT NULL REFERENCES season (id) ON DELETE CASCADE,
  provider         text NOT NULL,
  window_from      date,
  window_to        date,
  window_polled_at timestamptz,
  season_polled_at timestamptz,
  PRIMARY KEY (season_id, provider),
  CONSTRAINT season_fixture_poll_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT season_fixture_poll_window_whole
    CHECK ((window_from IS NULL) = (window_to IS NULL)
       AND (window_from IS NULL) = (window_polled_at IS NULL)),
  CONSTRAINT season_fixture_poll_window_ordered
    CHECK (window_from IS NULL OR window_from <= window_to),
  CONSTRAINT season_fixture_poll_something
    CHECK (window_polled_at IS NOT NULL OR season_polled_at IS NOT NULL)
);

COMMENT ON TABLE season_fixture_poll IS
  'When a season''s fixture list was last answered, per provider: the last window and the last whole-season ask (T-1371, D-189). The match page''s "last checked".';

-- Down Migration

DROP TABLE season_fixture_poll;
