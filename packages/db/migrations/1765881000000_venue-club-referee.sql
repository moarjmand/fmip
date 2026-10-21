-- Up Migration
-- T-1438 (D-229): grounds, clubs and the referee, from the plan we pay for.
--
-- 1. Venues. `venue.capacity` has existed since T-010 and was never filled.
--    The provider's `/venues` and `/teams` answers carry the capacity, the
--    street address, the surface and a picture. The columns that were
--    missing are added: `address`, and `surface` as one of our three words
--    (the adapter maps the provider's). `latitude` and `longitude` stay as
--    they are: the provider sends no coordinates, so they stay empty. The
--    picture is an `entity_media` row like a crest (D-176), so the image
--    constraint gains `venue`.
--
-- 2. Clubs. `team.founded_year` and `team.home_venue_id` exist and are
--    empty; no column is added. The `squads` job fills them from `/teams`.
--
-- 3. The referee as plain name text (the maintainer's choice of
--    2026-10-21): `fixture.referee_name`. No referee entity, no page, never a
--    key (rule 1); `fixture.referee_id` stays as it is and unused. The
--    provider already sends the name in every fixture answer we get.
--
-- 4. What was asked. `season_team_fetch`: each competition season whose
--    teams the provider was asked for (one request a season), when, and what
--    the answer held. `venue_detail_fetch`: each ground asked about or
--    described by a team answer. Both are re-asked after 30 days at the
--    soonest (`club-facts.ts`).
--
-- Triggers on the tables this touches, listed before writing it: `venue` and
-- `fixture` have `*_set_updated_at`; `fixture` also has
-- `fixture_notify_change` (T-032), which a referee name that changes wakes
-- like any other change; the writers only write a value that differs.
-- `entity_media` has `entity_media_set_updated_at` (a constraint is replaced,
-- no row written). The new tables have none.

ALTER TABLE venue
  ADD COLUMN address text,
  ADD COLUMN surface text,
  ADD CONSTRAINT venue_address_not_blank CHECK (address IS NULL OR btrim(address) <> ''),
  ADD CONSTRAINT venue_surface_check
    CHECK (surface IS NULL OR surface IN ('grass', 'artificial', 'hybrid'));

COMMENT ON COLUMN venue.address IS 'The street address as the provider gives it (T-1438).';
COMMENT ON COLUMN venue.surface IS 'grass, artificial or hybrid; NULL when unsaid (T-1438).';

ALTER TABLE fixture
  ADD COLUMN referee_name text,
  ADD CONSTRAINT fixture_referee_name_length
    CHECK (referee_name IS NULL OR char_length(btrim(referee_name)) BETWEEN 1 AND 120);

COMMENT ON COLUMN fixture.referee_name IS
  'The referee as the provider names him, plain text (T-1438, D-229). Never a key; referee_id stays unused.';

ALTER TABLE entity_media DROP CONSTRAINT entity_media_kind_check;
ALTER TABLE entity_media ADD CONSTRAINT entity_media_kind_check CHECK (
  (entity_type = 'team' AND kind = 'crest')
  OR (entity_type = 'competition' AND kind = 'logo')
  OR (entity_type = 'person' AND kind = 'photo')
  OR (entity_type = 'venue' AND kind = 'venue')
);

CREATE TABLE season_team_fetch (
  season_id   uuid NOT NULL REFERENCES season (id) ON DELETE CASCADE,
  provider    text NOT NULL,
  asked_at    timestamptz NOT NULL DEFAULT now(),
  -- Unanswered asks since the last answer; the job stops asking after five.
  failures    integer NOT NULL DEFAULT 0,
  answered_at timestamptz,
  -- What the last answer held: teams listed, of them held by us, and grounds
  -- named that no provider_mapping knows (counted, never created).
  teams       integer,
  held        integer,
  unmapped_venues integer,
  PRIMARY KEY (provider, season_id),
  CONSTRAINT season_team_fetch_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT season_team_fetch_failures_check CHECK (failures >= 0),
  CONSTRAINT season_team_fetch_answer_whole CHECK (
    (answered_at IS NULL) = (teams IS NULL)
    AND (teams IS NULL) = (held IS NULL)
    AND (teams IS NULL) = (unmapped_venues IS NULL)),
  CONSTRAINT season_team_fetch_counts_check
    CHECK (teams IS NULL OR (held BETWEEN 0 AND teams AND unmapped_venues >= 0))
);

COMMENT ON TABLE season_team_fetch IS
  'T-1438 (D-229): each competition season whose teams (founding year, home ground) the squads job asked the provider for.';

CREATE TABLE venue_detail_fetch (
  venue_id    uuid NOT NULL REFERENCES venue (id) ON DELETE CASCADE,
  provider    text NOT NULL,
  asked_at    timestamptz NOT NULL DEFAULT now(),
  failures    integer NOT NULL DEFAULT 0,
  answered_at timestamptz,
  -- `venue`: asked by id; `team`: described by a club's entry in a season's
  -- teams; `none`: asked, and the provider has no entry for it.
  answered_by text,
  PRIMARY KEY (provider, venue_id),
  CONSTRAINT venue_detail_fetch_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT venue_detail_fetch_failures_check CHECK (failures >= 0),
  CONSTRAINT venue_detail_fetch_answered_by_check CHECK (
    answered_by IS NULL OR answered_by IN ('venue', 'team', 'none')),
  CONSTRAINT venue_detail_fetch_answer_whole CHECK ((answered_at IS NULL) = (answered_by IS NULL))
);

COMMENT ON TABLE venue_detail_fetch IS
  'T-1438 (D-229): each ground whose capacity, address, surface and picture the squads job asked for or read from a team answer.';

-- Down Migration

DROP TABLE venue_detail_fetch;
DROP TABLE season_team_fetch;
DELETE FROM entity_media WHERE entity_type = 'venue';
ALTER TABLE entity_media DROP CONSTRAINT entity_media_kind_check;
ALTER TABLE entity_media ADD CONSTRAINT entity_media_kind_check CHECK (
  (entity_type = 'team' AND kind = 'crest')
  OR (entity_type = 'competition' AND kind = 'logo')
  OR (entity_type = 'person' AND kind = 'photo')
);
ALTER TABLE fixture DROP COLUMN referee_name;
ALTER TABLE venue DROP COLUMN surface, DROP COLUMN address;
