-- Development seed: one finished fixture, so that match-centre work has a
-- real row to read before ingestion exists.
--
-- Liverpool 2-2 Manchester United, Anfield, Premier League 2024/25, played on
-- 5 January 2025 (16:30 UTC kick-off). Only facts known for certain are
-- recorded: the participants, the kick-off, the half-time and full-time
-- scores, the venue. Incidents, lineups, periods and statistics are left
-- for ingestion rather than typed from memory (CLAUDE.md rule 3).
--
-- UUID block 09 = fixture, 0A = fixture_participant, 0B = fixture_score.
-- Depends on 001_catalog.sql for the season, teams and venue.

INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status, venue_id) VALUES
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000301', NULL,
    'Matchweek 20', TIMESTAMPTZ '2025-01-05 16:30:00+00', 'finished',
    '00000000-0000-4000-8000-000000000502')
ON CONFLICT (id) DO UPDATE SET
  season_id  = EXCLUDED.season_id,
  stage_id   = EXCLUDED.stage_id,
  round      = EXCLUDED.round,
  kickoff_at = EXCLUDED.kickoff_at,
  status     = EXCLUDED.status,
  venue_id   = EXCLUDED.venue_id;

INSERT INTO fixture_participant (id, fixture_id, team_id, side) VALUES
  ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000602', 'home'),
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000601', 'away')
ON CONFLICT (id) DO UPDATE SET
  fixture_id = EXCLUDED.fixture_id,
  team_id    = EXCLUDED.team_id,
  side       = EXCLUDED.side;

INSERT INTO fixture_score (id, fixture_id, kind, home, away) VALUES
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000901', 'half_time', 0, 0),
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000901', 'full_time', 2, 2),
  ('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000901', 'current', 2, 2)
ON CONFLICT (id) DO UPDATE SET
  fixture_id = EXCLUDED.fixture_id,
  kind       = EXCLUDED.kind,
  home       = EXCLUDED.home,
  away       = EXCLUDED.away;
