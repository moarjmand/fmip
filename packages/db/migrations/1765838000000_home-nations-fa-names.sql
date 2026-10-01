-- Up Migration
-- Persian names for the national teams whose country has no ISO code, so no
-- CLDR name to fall back on (T-1337; written by the agent at the maintainer's
-- request, D-175): the four home nations and Kosovo. Found by FIFA code,
-- never by a team name (rule 1).
WITH names(code, fa) AS (
  VALUES
    ('ENG', 'انگلیس'),
    ('SCO', 'اسکاتلند'),
    ('WAL', 'ولز'),
    ('NIR', 'ایرلند شمالی'),
    ('KVX', 'کوزوو')
)
INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
SELECT 'team', t.id, n.fa, 'fa', 'name', 'd175'
  FROM names n
  JOIN country c ON c.code = n.code
  JOIN team t ON t.country_id = c.id AND t.kind = 'national'
ON CONFLICT DO NOTHING;

-- Down Migration
DELETE FROM entity_alias a
 USING team t, country c
 WHERE a.entity_type = 'team' AND a.language = 'fa' AND a.source = 'd175'
   AND a.entity_id = t.id AND t.kind = 'national' AND t.country_id = c.id
   AND c.code IN ('ENG', 'SCO', 'WAL', 'NIR', 'KVX');
