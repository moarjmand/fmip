-- Up Migration
-- T-1324 (D-176): player photos for players already in our records.
--
-- T-1320 notes a player's photo only when an ingest touches the player, so a
-- player of a match ingested before it has none until he plays again. The new
-- `squads` job asks the provider for each club's squad, at most once a month
-- per club and within a daily cap of its own, and notes the photos of the
-- players we already hold. It is an ingestion job like the other five, so its
-- runs and the requests they spend are recorded in `ingest_run` (T-501).
--
-- `team_squad_fetch` records each ask: `asked_at` when the last request was
-- sent, `answered_at` when one was last answered. A club is due when it has no
-- answer from the last month and was not asked in the last day, so a failed
-- ask is tried again the next day, not at once.

ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check
  CHECK (job IN ('fixtures', 'live', 'lineups', 'standings', 'post_match', 'squads'));

CREATE TABLE team_squad_fetch (
  team_id     uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  provider    text NOT NULL,
  asked_at    timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  PRIMARY KEY (provider, team_id),
  CONSTRAINT team_squad_fetch_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly'))
);

CREATE INDEX team_squad_fetch_asked_idx ON team_squad_fetch (provider, asked_at);

COMMENT ON TABLE team_squad_fetch IS
  'When the provider was last asked for, and last answered with, a club''s squad (T-1324): the squads job asks each club at most once a month.';

-- Down Migration

DROP TABLE team_squad_fetch;
DELETE FROM ingest_run WHERE job = 'squads';
ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check
  CHECK (job IN ('fixtures', 'live', 'lineups', 'standings', 'post_match'));
