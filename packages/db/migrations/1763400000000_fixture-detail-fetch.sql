-- Up Migration
-- T-102: which finished fixtures have had their post-match detail fetched.
--
-- The post-match job asked only about matches in a window around now, so a
-- match that finished before the platform knew about it -- every fixture a
-- season backfill writes (T-030) -- never got its incidents, statistics,
-- line-ups or expected goals. The first production deploy backfilled 358
-- finished matches and showed every one of them as "not supplied".
--
-- A row here says the provider has been asked for this fixture's detail. It
-- lives beside `fixture` rather than on it: stamping `fixture` would move its
-- `updated_at` -- which the product shows as "last data update" -- and wake
-- every open stream on each re-fetch, when nothing about the match changed.
CREATE TABLE fixture_detail_fetch (
  fixture_id uuid PRIMARY KEY REFERENCES fixture (id) ON DELETE CASCADE,
  provider   text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixture_detail_fetch_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly'))
);

COMMENT ON TABLE fixture_detail_fetch IS
  'The post-match detail has been asked for this fixture; a finished fixture without a row is still owed it (T-102).';

-- Down Migration

DROP TABLE fixture_detail_fetch;
