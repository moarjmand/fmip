-- Development seed for the ingestion tables.
--
-- provider_mapping: API-Football's public identifiers for three seeded
-- entities (league 39 = Premier League, team 33 = Manchester United, team 40 =
-- Liverpool). These are the ids the free tier documents and are stable, so
-- the entity resolver (T-013) has something real to resolve against in
-- development. No other provider is mapped: their ids were not checked.
--
-- coverage_profile: an honest statement about the seeded 2024/25 Premier
-- League season. Exactly one fixture with scores exists, so 'scores' is
-- 'limited', and every other module is 'not_supplied'. No row claims data
-- that is not in the database (CLAUDE.md rule 3).
--
-- ingest_run is not seeded: a run that never happened must not be recorded.
--
-- UUID block 0C = provider_mapping, 0D = coverage_profile.

INSERT INTO provider_mapping (id, provider, entity_type, external_id, internal_id) VALUES
  ('00000000-0000-4000-8000-000000000c01', 'api_football', 'competition', '39',
    '00000000-0000-4000-8000-000000000201'),
  ('00000000-0000-4000-8000-000000000c02', 'api_football', 'team', '33',
    '00000000-0000-4000-8000-000000000601'),
  ('00000000-0000-4000-8000-000000000c03', 'api_football', 'team', '40',
    '00000000-0000-4000-8000-000000000602')
ON CONFLICT (id) DO UPDATE SET
  provider    = EXCLUDED.provider,
  entity_type = EXCLUDED.entity_type,
  external_id = EXCLUDED.external_id,
  internal_id = EXCLUDED.internal_id;

INSERT INTO coverage_profile (id, season_id, module, state, provider, note) VALUES
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-000000000301',
    'scores', 'limited', 'api_football', 'Development seed: one fixture with half-time and full-time scores.'),
  ('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-000000000301',
    'incidents', 'not_supplied', NULL, 'Development seed: not loaded.'),
  ('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-000000000301',
    'lineups', 'not_supplied', NULL, 'Development seed: not loaded.'),
  ('00000000-0000-4000-8000-000000000d04', '00000000-0000-4000-8000-000000000301',
    'statistics', 'not_supplied', NULL, 'Development seed: not loaded.'),
  ('00000000-0000-4000-8000-000000000d05', '00000000-0000-4000-8000-000000000301',
    'standings', 'not_supplied', NULL, 'Development seed: not loaded.'),
  ('00000000-0000-4000-8000-000000000d06', '00000000-0000-4000-8000-000000000301',
    'availability', 'not_supplied', NULL, 'Development seed: not loaded.'),
  ('00000000-0000-4000-8000-000000000d07', '00000000-0000-4000-8000-000000000301',
    'advanced_statistics', 'not_supplied', NULL, 'Development seed: not loaded.')
ON CONFLICT (id) DO UPDATE SET
  season_id = EXCLUDED.season_id,
  module    = EXCLUDED.module,
  state     = EXCLUDED.state,
  provider  = EXCLUDED.provider,
  note      = EXCLUDED.note;
