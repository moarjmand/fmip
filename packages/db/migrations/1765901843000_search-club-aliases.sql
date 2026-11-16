-- Up Migration
-- T-1843: the short forms readers search big clubs by (teammate request
-- 9d1c6511, «قسمت جستجو», point 4: "PSG", "Man United" / "Man Utd", "Spurs",
-- "Man City", "Wolves" to Wolverhampton, "QPR" to Queens Park Rangers; the
-- teammate's list, and only it). Rows in entity_alias of kind 'alias' --
-- never 'name', so no surface shows them in place of the club's name
-- (localised_name() reads kind 'name' only) -- and 'alias' rather than
-- 'abbreviation', since the news translation check carries 'name' and
-- 'alias' rows only (translations-admin-store.ts).
--
-- Wolves and QPR are stored under those short names, so the long form is the
-- alias there. Search finds every alias; the news linker (news_named_entities)
-- also reads them, whole words of five letters or more: on production
-- (read-only, 2026-11-16) a random 25 of the 96 "Spurs" headlines over 30
-- days were all Tottenham,
-- and "Man City" / "Man Utd" / "Man United" name those clubs. "PSG" is under
-- the linker's five letters and stays search-only. "Spurs" is also a verb: a
-- Title Case headline such as "Saka Strike Spurs Arsenal On" would link
-- Tottenham (review of T-1843); none was in that sample.
--
-- Each club is found by the provider's team id in provider_mapping, never by
-- its name (rule 1), as in production on 2026-11-16. A database without these
-- clubs (a fresh one, CI) inserts nothing.

WITH aliases(external_id, alias, kind) AS (
  VALUES
    ('85', 'PSG', 'alias'),                            -- Paris Saint Germain
    ('33', 'Man United', 'alias'),                     -- Manchester United
    ('33', 'Man Utd', 'alias'),
    ('47', 'Spurs', 'alias'),                          -- Tottenham
    ('50', 'Man City', 'alias'),                       -- Manchester City
    ('39', 'Wolverhampton Wanderers', 'alias'),        -- Wolves
    ('72', 'Queens Park Rangers', 'alias')             -- QPR
)
INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
SELECT 'team', t.id, a.alias, 'en', a.kind, 't1843'
  FROM aliases a
  JOIN provider_mapping m
    ON m.provider = 'api_football' AND m.entity_type = 'team' AND m.external_id = a.external_id
  JOIN team t ON t.id = m.internal_id
ON CONFLICT DO NOTHING;

-- Down Migration
DELETE FROM entity_alias WHERE source = 't1843' AND entity_type = 'team';
