-- Development seed: training-store names for the seeded English clubs, so the
-- model service can forecast a seeded fixture once E0 is loaded
-- (python -m fmip_model.training.load football-data --seasons 2425 --divisions E0).
-- The names are football-data.co.uk's spellings, as they appear in the files.

INSERT INTO training.team_alias (team_id, division, training_name) VALUES
  ('00000000-0000-4000-8000-000000000601', 'E0', 'Man United'),
  ('00000000-0000-4000-8000-000000000602', 'E0', 'Liverpool')
ON CONFLICT (team_id, division) DO UPDATE SET training_name = EXCLUDED.training_name;
