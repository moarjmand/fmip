-- Up Migration
-- T-1667 (D-319): which conference each club of a season is in.
--
-- Major League Soccer ranks its clubs in two conference tables, Eastern and
-- Western, each over all its clubs' league matches, the ones against the
-- other conference included. A conference is a split of the league table by
-- club, not a set of matches, so it is not `fixture.group_name` (a group
-- stage's group, read by the match centre, the fixture lists and the model).
--
-- The standings job writes the rows from the provider's tables for the
-- season (`/standings`, the call it already makes; one table per conference),
-- through `provider_mapping` (rule 1: by our ids, never a name). Each run
-- that reads conferences replaces the season's rows. A season the provider
-- splits into no conferences has none, and its page is the one league table.
-- Nothing is backfilled: the rows appear on the next standings run of a
-- polled season.
--
-- `name` is the conference as the adapter reads it, e.g. "Eastern Conference".
-- The rows are derived and re-read every run, so they go with the season or
-- club they hang on (ON DELETE CASCADE).
--
-- Triggers on the tables this touches, listed before writing it: the new
-- table has none; no other table is touched.

CREATE TABLE season_conference (
  season_id  uuid NOT NULL REFERENCES season (id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  name       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, team_id),
  CONSTRAINT season_conference_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX season_conference_team_idx ON season_conference (team_id);

-- Down Migration

DROP TABLE season_conference;
