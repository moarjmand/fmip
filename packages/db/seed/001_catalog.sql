-- Development seed: a small, real slice of the catalog.
--
-- This is fixture data for local development and tests. It is NOT product
-- data: the seed runner refuses to run with NODE_ENV=production, and nothing
-- here is a substitute for ingestion. Every value is a matter of public record
-- (FIFA codes, founding years, dates of birth); anything not known for certain
-- is left NULL rather than guessed (CLAUDE.md rule 3).
--
-- Idempotent: fixed UUIDs and ON CONFLICT (id) DO UPDATE, so re-running the
-- seed converges on this file instead of duplicating rows. The UUIDs are
-- version-4-shaped constants, grouped by table in the third-from-last block:
--   01 country · 02 competition · 03 season · 04 stage
--   05 venue   · 06 team        · 07 person · 08 player_spell

-- ---------------------------------------------------------------------------
-- country
-- ---------------------------------------------------------------------------
INSERT INTO country (id, code, iso2, name) VALUES
  ('00000000-0000-4000-8000-000000000101', 'ENG', NULL, 'England'),
  ('00000000-0000-4000-8000-000000000102', 'ESP', 'ES', 'Spain'),
  ('00000000-0000-4000-8000-000000000103', 'GER', 'DE', 'Germany'),
  ('00000000-0000-4000-8000-000000000104', 'ITA', 'IT', 'Italy'),
  ('00000000-0000-4000-8000-000000000105', 'FRA', 'FR', 'France'),
  ('00000000-0000-4000-8000-000000000106', 'POR', 'PT', 'Portugal'),
  ('00000000-0000-4000-8000-000000000107', 'NED', 'NL', 'Netherlands'),
  ('00000000-0000-4000-8000-000000000108', 'EGY', 'EG', 'Egypt'),
  ('00000000-0000-4000-8000-000000000109', 'IRN', 'IR', 'Iran')
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  iso2 = EXCLUDED.iso2,
  name = EXCLUDED.name;

-- ---------------------------------------------------------------------------
-- competition
-- ---------------------------------------------------------------------------
INSERT INTO competition (id, country_id, name, short_name, kind, scope, gender, age_group, tier) VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101',
    'Premier League', 'PL', 'league', 'domestic', 'men', 'senior', 1),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102',
    'La Liga', NULL, 'league', 'domestic', 'men', 'senior', 1),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000109',
    'Persian Gulf Pro League', 'PGPL', 'league', 'domestic', 'men', 'senior', 1),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000101',
    'FA Cup', NULL, 'cup', 'domestic', 'men', 'senior', NULL),
  ('00000000-0000-4000-8000-000000000205', NULL,
    'UEFA Champions League', 'UCL', 'cup', 'continental', 'men', 'senior', NULL),
  ('00000000-0000-4000-8000-000000000206', NULL,
    'FIFA World Cup', NULL, 'cup', 'international', 'men', 'senior', NULL)
ON CONFLICT (id) DO UPDATE SET
  country_id = EXCLUDED.country_id,
  name       = EXCLUDED.name,
  short_name = EXCLUDED.short_name,
  kind       = EXCLUDED.kind,
  scope      = EXCLUDED.scope,
  gender     = EXCLUDED.gender,
  age_group  = EXCLUDED.age_group,
  tier       = EXCLUDED.tier;

-- ---------------------------------------------------------------------------
-- season
-- ---------------------------------------------------------------------------
-- Two Premier League editions, one closed and one flagged current, so that
-- "previous season" queries have something to find in development.
INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201',
    '2024/25', DATE '2024-08-16', DATE '2025-05-25', false),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000201',
    '2025/26', DATE '2025-08-15', DATE '2026-05-24', true),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000205',
    '2025/26', DATE '2025-07-08', DATE '2026-05-30', true)
ON CONFLICT (id) DO UPDATE SET
  competition_id = EXCLUDED.competition_id,
  label          = EXCLUDED.label,
  start_date     = EXCLUDED.start_date,
  end_date       = EXCLUDED.end_date,
  is_current     = EXCLUDED.is_current;

-- ---------------------------------------------------------------------------
-- stage
-- ---------------------------------------------------------------------------
-- One flat league; one competition with the full league-phase-to-final ladder.
INSERT INTO stage (id, season_id, name, kind, sort_order, legs) VALUES
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000302',
    'Regular season', 'league', 1, 1),
  ('00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000303',
    'League phase', 'league', 1, 1),
  ('00000000-0000-4000-8000-000000000412', '00000000-0000-4000-8000-000000000303',
    'Knockout phase play-offs', 'playoff', 2, 2),
  ('00000000-0000-4000-8000-000000000413', '00000000-0000-4000-8000-000000000303',
    'Round of 16', 'knockout', 3, 2),
  ('00000000-0000-4000-8000-000000000414', '00000000-0000-4000-8000-000000000303',
    'Quarter-finals', 'knockout', 4, 2),
  ('00000000-0000-4000-8000-000000000415', '00000000-0000-4000-8000-000000000303',
    'Semi-finals', 'knockout', 5, 2),
  ('00000000-0000-4000-8000-000000000416', '00000000-0000-4000-8000-000000000303',
    'Final', 'knockout', 6, 1)
ON CONFLICT (id) DO UPDATE SET
  season_id  = EXCLUDED.season_id,
  name       = EXCLUDED.name,
  kind       = EXCLUDED.kind,
  sort_order = EXCLUDED.sort_order,
  legs       = EXCLUDED.legs;

-- ---------------------------------------------------------------------------
-- venue
-- ---------------------------------------------------------------------------
-- Capacity and coordinates are deliberately NULL: they change with
-- redevelopment and belong to ingestion, not to a hand-written seed.
INSERT INTO venue (id, name, city, country_id) VALUES
  ('00000000-0000-4000-8000-000000000501', 'Old Trafford', 'Manchester', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000502', 'Anfield', 'Liverpool', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000503', 'Santiago Bernabéu', 'Madrid', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000504', 'Azadi Stadium', 'Tehran', '00000000-0000-4000-8000-000000000109')
ON CONFLICT (id) DO UPDATE SET
  name       = EXCLUDED.name,
  city       = EXCLUDED.city,
  country_id = EXCLUDED.country_id;

-- ---------------------------------------------------------------------------
-- team
-- ---------------------------------------------------------------------------
INSERT INTO team (id, name, short_name, code, kind, country_id, gender, age_group, home_venue_id, founded_year) VALUES
  ('00000000-0000-4000-8000-000000000601', 'Manchester United', 'Man United', 'MUN', 'club',
    '00000000-0000-4000-8000-000000000101', 'men', 'senior', '00000000-0000-4000-8000-000000000501', 1878),
  ('00000000-0000-4000-8000-000000000602', 'Liverpool', NULL, 'LIV', 'club',
    '00000000-0000-4000-8000-000000000101', 'men', 'senior', '00000000-0000-4000-8000-000000000502', 1892),
  ('00000000-0000-4000-8000-000000000603', 'Real Madrid', NULL, 'RMA', 'club',
    '00000000-0000-4000-8000-000000000102', 'men', 'senior', '00000000-0000-4000-8000-000000000503', 1902),
  ('00000000-0000-4000-8000-000000000604', 'Persepolis', NULL, 'PER', 'club',
    '00000000-0000-4000-8000-000000000109', 'men', 'senior', '00000000-0000-4000-8000-000000000504', 1963),
  ('00000000-0000-4000-8000-000000000605', 'Esteghlal', NULL, 'EST', 'club',
    '00000000-0000-4000-8000-000000000109', 'men', 'senior', '00000000-0000-4000-8000-000000000504', 1945),
  ('00000000-0000-4000-8000-000000000606', 'England', NULL, 'ENG', 'national',
    '00000000-0000-4000-8000-000000000101', 'men', 'senior', NULL, NULL),
  ('00000000-0000-4000-8000-000000000607', 'Iran', NULL, 'IRN', 'national',
    '00000000-0000-4000-8000-000000000109', 'men', 'senior', '00000000-0000-4000-8000-000000000504', NULL)
ON CONFLICT (id) DO UPDATE SET
  name          = EXCLUDED.name,
  short_name    = EXCLUDED.short_name,
  code          = EXCLUDED.code,
  kind          = EXCLUDED.kind,
  country_id    = EXCLUDED.country_id,
  gender        = EXCLUDED.gender,
  age_group     = EXCLUDED.age_group,
  home_venue_id = EXCLUDED.home_venue_id,
  founded_year  = EXCLUDED.founded_year;

-- ---------------------------------------------------------------------------
-- person
-- ---------------------------------------------------------------------------
INSERT INTO person (id, full_name, known_as, date_of_birth, nationality_id, height_cm, preferred_foot) VALUES
  ('00000000-0000-4000-8000-000000000701', 'Mohamed Salah Hamed Mahrous Ghaly', 'Mohamed Salah',
    DATE '1992-06-15', '00000000-0000-4000-8000-000000000108', 175, 'left'),
  ('00000000-0000-4000-8000-000000000702', 'Bruno Miguel Borges Fernandes', 'Bruno Fernandes',
    DATE '1994-09-08', '00000000-0000-4000-8000-000000000106', 179, 'right'),
  ('00000000-0000-4000-8000-000000000703', 'Virgil van Dijk', NULL,
    DATE '1991-07-08', '00000000-0000-4000-8000-000000000107', 193, 'right')
ON CONFLICT (id) DO UPDATE SET
  full_name      = EXCLUDED.full_name,
  known_as       = EXCLUDED.known_as,
  date_of_birth  = EXCLUDED.date_of_birth,
  nationality_id = EXCLUDED.nationality_id,
  height_cm      = EXCLUDED.height_cm,
  preferred_foot = EXCLUDED.preferred_foot;

-- ---------------------------------------------------------------------------
-- player_spell
-- ---------------------------------------------------------------------------
-- All three are open spells (end_date NULL). Re-running this file exercises
-- the one-open-spell-per-(person, team) index: the ON CONFLICT on id means the
-- second run updates rather than attempting a second open spell.
INSERT INTO player_spell (id, person_id, team_id, start_date, end_date, shirt_number, position, on_loan) VALUES
  ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000602', DATE '2017-07-01', NULL, 11, 'forward', false),
  ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000601', DATE '2020-01-30', NULL, 8, 'midfielder', false),
  ('00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000703',
    '00000000-0000-4000-8000-000000000602', DATE '2018-01-01', NULL, 4, 'defender', false)
ON CONFLICT (id) DO UPDATE SET
  person_id    = EXCLUDED.person_id,
  team_id      = EXCLUDED.team_id,
  start_date   = EXCLUDED.start_date,
  end_date     = EXCLUDED.end_date,
  shirt_number = EXCLUDED.shirt_number,
  position     = EXCLUDED.position,
  on_loan      = EXCLUDED.on_loan;
