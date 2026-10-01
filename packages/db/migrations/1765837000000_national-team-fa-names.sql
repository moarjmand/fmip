-- Up Migration
-- Persian names for the national teams whose CLDR region name is not what a
-- Persian football reader calls the side (T-1335; written by the agent at the
-- maintainer's request, D-175). Every other national team keeps its
-- country's CLDR name (T-1334). Found by the country's FIFA code, never by a
-- team name (rule 1); a deployment without these teams writes nothing.
WITH names(code, fa) AS (
  VALUES
    ('COD', 'کنگو دموکراتیک'),
    ('CGO', 'کنگو'),
    ('PLE', 'فلسطین'),
    ('HKG', 'هنگ‌کنگ'),
    ('USA', 'آمریکا'),
    ('UAE', 'امارات')
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
   AND c.code IN ('COD', 'CGO', 'PLE', 'HKG', 'USA', 'UAE');
