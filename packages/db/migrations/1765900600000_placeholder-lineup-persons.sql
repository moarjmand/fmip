-- Up Migration
-- T-1707 (D-342): line-up slots a feed labels "Trialist", "Unknown", "TBA"
-- are not people.
--
-- API-Football gives an unnamed trialist a positive player id and the name
-- "Trialist", the same id for the trialists of different clubs. People are
-- adopted one row per provider id (D-079), so that id became one person
-- "Trialist", and every match where both clubs fielded a trialist listed that
-- one person for both teams: the data auditor's I2 check (one person on both
-- sides of a match) rose from 5 to 10 on 2026-11-02, six of them Scottish
-- League Cup matches (aud-2026-11-02-01). The ingestion no longer resolves a
-- placeholder label to a person (`isPlaceholderPersonName` in
-- `packages/ingestion/src/placeholder-name.ts`); the line-up and per-player
-- statistics rows it wrote before are removed here.
--
-- The list below is that file's `PLACEHOLDER_PERSON_NAMES`, compared the same
-- way: the whole name, trimmed, spaces collapsed, case folded -- never a word
-- inside a name. A person is a placeholder when the name we hold for them,
-- `full_name` or `known_as`, is one of the labels or empty.
--
-- Only `lineup` and `fixture_player_stat` rows go; neither is immutable (both
-- carry only updated_at and notify triggers), and no forecast, prediction or
-- rating reads them as a stored input. The person rows and their provider
-- mappings stay: other rows may name them (an incident, a squad), and the
-- ingestion simply never resolves the label again. A line-up loses the slot
-- it could not name, which is what the ingestion now writes for it too.

WITH placeholder AS (
  SELECT p.id
    FROM person p
   WHERE lower(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g'))
           IN ('', 'trialist', 'unknown', 'unknown player', 'tba', 'tbc', 'tbd', 'n/a', '-', '?')
      OR lower(regexp_replace(btrim(p.known_as), '\s+', ' ', 'g'))
           IN ('trialist', 'unknown', 'unknown player', 'tba', 'tbc', 'tbd', 'n/a', '-', '?')
)
DELETE FROM lineup l
 USING placeholder x
 WHERE l.person_id = x.id;

WITH placeholder AS (
  SELECT p.id
    FROM person p
   WHERE lower(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g'))
           IN ('', 'trialist', 'unknown', 'unknown player', 'tba', 'tbc', 'tbd', 'n/a', '-', '?')
      OR lower(regexp_replace(btrim(p.known_as), '\s+', ' ', 'g'))
           IN ('trialist', 'unknown', 'unknown player', 'tba', 'tbc', 'tbd', 'n/a', '-', '?')
)
DELETE FROM fixture_player_stat s
 USING placeholder x
 WHERE s.person_id = x.id;

-- Down Migration
-- Nothing to restore: the removed rows named a label, not a player.
SELECT 1;
