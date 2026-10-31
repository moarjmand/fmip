-- Up Migration
-- T-1681 (D-327): scores of periods a match never had are removed.
--
-- API-Football sends `score.extratime` and `score.penalty` as zeros on some
-- matches that had neither (two Ekstraklasa league matches of October 2026,
-- an abandoned La Liga match), and once a zero shoot-out after a match settled
-- in extra time (Celtic 6-2 St Mirren, Scottish Cup semi-final 2026-04-19).
-- They were stored as played, and the match page showed "Pens 0-0". The
-- adapter now keeps those scores only for a match that reached the period
-- (T-1681); the ingestion never deletes a score kind, so the stored rows are
-- removed here. Found by the data auditor's first run (D-326, check R6).
--
-- A shoot-out has a winner, so a level `penalties` row on a match that is not
-- live is never true: removed. An `extra_time` row of 0-0 on such a match is
-- the same zeros (a real goalless extra time comes with a real shoot-out, and
-- `current` equals `full_time` either way): removed too. On production
-- (2026-10-31, read-only) 4 penalties rows and 3 extra-time rows.

DELETE FROM fixture_score e
 USING fixture f
 WHERE e.fixture_id = f.id
   AND f.status <> 'live'
   AND e.kind = 'extra_time' AND e.home = 0 AND e.away = 0
   AND EXISTS (SELECT 1 FROM fixture_score p
                WHERE p.fixture_id = e.fixture_id AND p.kind = 'penalties'
                  AND p.home = p.away);

DELETE FROM fixture_score p
 USING fixture f
 WHERE p.fixture_id = f.id
   AND f.status <> 'live'
   AND p.kind = 'penalties' AND p.home = p.away;

-- Down Migration
-- Nothing to restore: the removed rows were scores of periods never played.
SELECT 1;
