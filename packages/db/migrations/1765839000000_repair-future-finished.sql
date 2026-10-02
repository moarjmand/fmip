-- Up Migration
-- A match a day or more ahead that the provider called finished (T-1348).
-- Before T-1350 the adapter took API-Football's "FT" 2-2 for AFCON qualifier
-- 1545957 (Tunisia v Botswana, kick-off 28 March 2027) as played, and group
-- H's table counted it. T-1350 stops new ones; this puts back the one that
-- was stored: no score, no summary, scheduled again. Nothing was predicted
-- or settled on it (checked on production 2026-10-02). Any other fixture in
-- the same state is repaired the same way; there was none.
DELETE FROM match_summary s
 USING fixture f
 WHERE s.fixture_id = f.id
   AND f.status IN ('live', 'finished') AND f.kickoff_at > now() + interval '1 day';
DELETE FROM fixture_score s
 USING fixture f
 WHERE s.fixture_id = f.id
   AND f.status IN ('live', 'finished') AND f.kickoff_at > now() + interval '1 day';
UPDATE fixture SET status = 'scheduled', minute = NULL
 WHERE status IN ('live', 'finished') AND kickoff_at > now() + interval '1 day';

-- Down Migration
-- A repair: nothing to put back.
SELECT 1;
