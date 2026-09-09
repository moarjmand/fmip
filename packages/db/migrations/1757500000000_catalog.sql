-- Up Migration

-- T-010: the catalog. The reference entities that every fixture, prediction
-- and article will point at: where football is played, by whom, in what.
--
-- Rule 1 (CLAUDE.md): every row is identified by a UUID we generate. Names,
-- codes and labels are attributes. The only UNIQUE constraints below are on
-- codes that are themselves standardised (FIFA trigrams, ISO alpha-2) or on
-- structural pairs such as (season, sort_order); no table is keyed by a name.
--
-- Enumerations are TEXT columns with named CHECK constraints rather than
-- Postgres enum types (D-024). Extending one is ALTER TABLE ... DROP/ADD
-- CONSTRAINT inside an ordinary transaction, and the down section is a plain
-- DROP TABLE.
--
-- Every table carries created_at / updated_at, with updated_at maintained by
-- the set_updated_at() trigger function from the bootstrap migration.

-- ---------------------------------------------------------------------------
-- country
-- ---------------------------------------------------------------------------
-- Football's map is not ISO's: England, Scotland, Wales and Northern Ireland
-- compete separately and have no ISO 3166-1 code. The FIFA trigram is the code
-- football actually uses, so it is the required one; iso2 is present where it
-- exists, for flags, locales and timezone lookups.
CREATE TABLE country (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL,
  iso2       text,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT country_code_format CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT country_iso2_format CHECK (iso2 IS NULL OR iso2 ~ '^[A-Z]{2}$'),
  CONSTRAINT country_code_unique UNIQUE (code),
  CONSTRAINT country_iso2_unique UNIQUE (iso2)
);

COMMENT ON TABLE country IS
  'Football country or territory. code is the FIFA trigram; iso2 is ISO 3166-1 alpha-2 where one exists.';

-- ---------------------------------------------------------------------------
-- competition
-- ---------------------------------------------------------------------------
-- A competition is the durable thing ("Premier League"); a season is one
-- edition of it. country_id is NULL for continental and international
-- competitions, and the CHECK below makes the reverse mandatory: a domestic
-- competition must say whose it is.
CREATE TABLE competition (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid REFERENCES country (id) ON DELETE RESTRICT,
  name       text NOT NULL,
  short_name text,
  kind       text NOT NULL,
  scope      text NOT NULL,
  gender     text NOT NULL,
  age_group  text NOT NULL DEFAULT 'senior',
  -- 1 = top flight. NULL where tiers do not apply: cups, international.
  tier       smallint,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competition_kind_check
    CHECK (kind IN ('league', 'cup', 'super_cup', 'qualifying', 'friendly')),
  CONSTRAINT competition_scope_check
    CHECK (scope IN ('domestic', 'continental', 'international')),
  CONSTRAINT competition_gender_check
    CHECK (gender IN ('men', 'women')),
  CONSTRAINT competition_age_group_check
    CHECK (age_group IN ('senior', 'u23', 'u21', 'u20', 'u19', 'u18', 'u17')),
  CONSTRAINT competition_tier_positive
    CHECK (tier IS NULL OR tier >= 1),
  CONSTRAINT competition_domestic_has_country
    CHECK (scope <> 'domestic' OR country_id IS NOT NULL)
);

CREATE INDEX competition_country_id_idx ON competition (country_id);

COMMENT ON TABLE competition IS
  'A competition across all its editions. Editions live in season.';

-- ---------------------------------------------------------------------------
-- season
-- ---------------------------------------------------------------------------
-- label is the human edition name: '2025/26' for a cross-year season, '2026'
-- for a calendar-year one. It is unique per competition because two editions
-- of the same competition cannot share a name, not because it identifies the
-- row. is_current is a flag with a partial unique index, so a competition has
-- at most one current season at any moment.
CREATE TABLE season (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competition (id) ON DELETE RESTRICT,
  label          text NOT NULL,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  is_current     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_label_unique UNIQUE (competition_id, label),
  CONSTRAINT season_dates_ordered CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX season_one_current_per_competition
  ON season (competition_id)
  WHERE is_current;

COMMENT ON TABLE season IS
  'One edition of a competition. At most one row per competition has is_current = true.';

-- ---------------------------------------------------------------------------
-- stage
-- ---------------------------------------------------------------------------
-- The phases of a season, in order: qualifying, then a league or group phase,
-- then knockout rounds. sort_order is unique within the season so the order is
-- a fact in the data, not an assumption in a query. legs says whether a
-- knockout tie is decided over one match or two; it is 1 for league phases.
CREATE TABLE stage (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES season (id) ON DELETE RESTRICT,
  name       text NOT NULL,
  kind       text NOT NULL,
  sort_order smallint NOT NULL,
  legs       smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stage_kind_check
    CHECK (kind IN ('league', 'group', 'knockout', 'playoff', 'qualifying')),
  CONSTRAINT stage_legs_check CHECK (legs IN (1, 2)),
  CONSTRAINT stage_sort_order_positive CHECK (sort_order >= 1),
  CONSTRAINT stage_sort_order_unique UNIQUE (season_id, sort_order)
);

COMMENT ON TABLE stage IS
  'A phase of a season (league phase, group stage, round of 16, ...). Ordered by sort_order within the season.';

-- ---------------------------------------------------------------------------
-- venue
-- ---------------------------------------------------------------------------
-- Coordinates are optional but come as a pair: a latitude without a longitude
-- is a data error, not a partial fact.
CREATE TABLE venue (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  city       text,
  country_id uuid REFERENCES country (id) ON DELETE RESTRICT,
  capacity   integer,
  latitude   numeric(8, 5),
  longitude  numeric(8, 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT venue_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT venue_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT venue_coordinates_paired CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX venue_country_id_idx ON venue (country_id);

COMMENT ON TABLE venue IS
  'A stadium or ground. Referenced by team.home_venue_id now and by fixture in T-011.';

-- ---------------------------------------------------------------------------
-- team
-- ---------------------------------------------------------------------------
-- Clubs and national teams share a table because a fixture, a lineup and a
-- prediction treat them identically. code is the short display abbreviation
-- (MUN, RMA); two clubs may legitimately share one, so it is not unique.
-- Rule 1 again: nothing here is keyed by name.
CREATE TABLE team (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  short_name    text,
  code          text,
  kind          text NOT NULL,
  country_id    uuid REFERENCES country (id) ON DELETE RESTRICT,
  gender        text NOT NULL,
  age_group     text NOT NULL DEFAULT 'senior',
  home_venue_id uuid REFERENCES venue (id) ON DELETE SET NULL,
  founded_year  smallint,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_kind_check CHECK (kind IN ('club', 'national')),
  CONSTRAINT team_gender_check CHECK (gender IN ('men', 'women')),
  CONSTRAINT team_age_group_check
    CHECK (age_group IN ('senior', 'u23', 'u21', 'u20', 'u19', 'u18', 'u17')),
  CONSTRAINT team_code_format CHECK (code IS NULL OR code ~ '^[A-Z0-9]{2,4}$'),
  CONSTRAINT team_national_has_country CHECK (kind <> 'national' OR country_id IS NOT NULL),
  CONSTRAINT team_founded_year_range
    CHECK (founded_year IS NULL OR founded_year BETWEEN 1800 AND 2100)
);

CREATE INDEX team_country_id_idx ON team (country_id);
CREATE INDEX team_home_venue_id_idx ON team (home_venue_id);

COMMENT ON TABLE team IS
  'A club or a national team. A national team must name its country; a club may be stateless while unresolved.';

-- ---------------------------------------------------------------------------
-- person
-- ---------------------------------------------------------------------------
-- A human being: player, coach, referee. What they do for whom, and when, is a
-- spell (player_spell below; staff spells arrive with later tasks), so this
-- table carries only the facts that do not change with employer.
CREATE TABLE person (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      text NOT NULL,
  -- The name they are known by, when it differs from full_name.
  known_as       text,
  date_of_birth  date,
  nationality_id uuid REFERENCES country (id) ON DELETE RESTRICT,
  height_cm      smallint,
  preferred_foot text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_preferred_foot_check
    CHECK (preferred_foot IS NULL OR preferred_foot IN ('left', 'right', 'both')),
  CONSTRAINT person_height_range CHECK (height_cm IS NULL OR height_cm BETWEEN 100 AND 250)
);

CREATE INDEX person_nationality_id_idx ON person (nationality_id);

COMMENT ON TABLE person IS
  'A player, coach or official, independent of any team. Employment is recorded in spells.';

-- ---------------------------------------------------------------------------
-- player_spell
-- ---------------------------------------------------------------------------
-- A period during which a person plays for a team. end_date is NULL while the
-- spell is ongoing. A person may hold several open spells at once (club and
-- national team), but never two open spells at the same team: the partial
-- unique index enforces that, and it is what "current team" queries rely on.
CREATE TABLE player_spell (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    uuid NOT NULL REFERENCES person (id) ON DELETE RESTRICT,
  team_id      uuid NOT NULL REFERENCES team (id) ON DELETE RESTRICT,
  start_date   date NOT NULL,
  end_date     date,
  shirt_number smallint,
  position     text,
  on_loan      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_spell_dates_ordered CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT player_spell_shirt_range CHECK (shirt_number IS NULL OR shirt_number BETWEEN 1 AND 99),
  CONSTRAINT player_spell_position_check
    CHECK (position IS NULL OR position IN ('goalkeeper', 'defender', 'midfielder', 'forward'))
);

CREATE UNIQUE INDEX player_spell_one_open_per_team
  ON player_spell (person_id, team_id)
  WHERE end_date IS NULL;

CREATE INDEX player_spell_person_id_idx ON player_spell (person_id);
CREATE INDEX player_spell_team_id_idx ON player_spell (team_id);

COMMENT ON TABLE player_spell IS
  'A person playing for a team over a date range. end_date NULL = ongoing; at most one ongoing spell per (person, team).';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER country_set_updated_at
  BEFORE UPDATE ON country FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER competition_set_updated_at
  BEFORE UPDATE ON competition FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER season_set_updated_at
  BEFORE UPDATE ON season FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER stage_set_updated_at
  BEFORE UPDATE ON stage FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER venue_set_updated_at
  BEFORE UPDATE ON venue FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER team_set_updated_at
  BEFORE UPDATE ON team FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER person_set_updated_at
  BEFORE UPDATE ON person FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER player_spell_set_updated_at
  BEFORE UPDATE ON player_spell FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

-- Reverse dependency order. Triggers and indexes go with their tables.
DROP TABLE IF EXISTS player_spell;
DROP TABLE IF EXISTS person;
DROP TABLE IF EXISTS team;
DROP TABLE IF EXISTS venue;
DROP TABLE IF EXISTS stage;
DROP TABLE IF EXISTS season;
DROP TABLE IF EXISTS competition;
DROP TABLE IF EXISTS country;
