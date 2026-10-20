-- Development seed: one scheduled fixture far in the future, so that the
-- prediction journey (T-080) has a match that is open to predict and never
-- reaches kick-off. Liverpool v Manchester United, Anfield, Premier League
-- 2025/26 regular season, 1 January 2099. Fixed ids so re-running converges.
--
-- UUID block 09 = fixture, 0A = fixture_participant.

INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status, venue_id) VALUES
  ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000401', 'Matchweek 99',
    TIMESTAMPTZ '2099-01-01 15:00:00+00', 'scheduled', '00000000-0000-4000-8000-000000000502')
ON CONFLICT (id) DO UPDATE SET
  season_id  = EXCLUDED.season_id,
  stage_id   = EXCLUDED.stage_id,
  round      = EXCLUDED.round,
  kickoff_at = EXCLUDED.kickoff_at,
  status     = EXCLUDED.status,
  venue_id   = EXCLUDED.venue_id;

INSERT INTO fixture_participant (id, fixture_id, team_id, side) VALUES
  ('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000602', 'home'),
  ('00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000601', 'away')
ON CONFLICT (id) DO UPDATE SET
  fixture_id = EXCLUDED.fixture_id,
  team_id    = EXCLUDED.team_id,
  side       = EXCLUDED.side;

-- One verified highlight clip for the finished seeded match (T-1434), so the
-- Highlights page's journey (`journeys/highlights.spec.ts`) meets a listed
-- clip: offered in every territory, from the Highlightly source the
-- migration creates, on a reserved example address that is never followed.
-- UUID block 0F = highlight_feed.
INSERT INTO highlight_feed (id, fixture_id, source_id, url, title, publisher)
VALUES ('00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-000000000901',
        '00000000-0000-4000-8000-000000000902', 'https://example.com/highlights/e2e-0901',
        'Highlights', 'Example Publisher')
ON CONFLICT (id) DO UPDATE SET
  fixture_id = EXCLUDED.fixture_id,
  source_id  = EXCLUDED.source_id,
  url        = EXCLUDED.url,
  publisher  = EXCLUDED.publisher;
