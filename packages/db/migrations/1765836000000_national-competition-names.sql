-- Up Migration
-- Persian names for the national-team competitions added on 2026-10-01
-- (T-1332, D-179; written by the agent at the maintainer's request, D-175).
-- Found by the provider's ids in `provider_mapping`, never by a name (rule 1);
-- a deployment without these competitions writes nothing. National teams need
-- no rows: they are called what their country is called (T-1334).
WITH names(external_id, fa) AS (
  VALUES
    ('5', 'لیگ ملت‌های اروپا'),
    ('10', 'بازی‌های دوستانه‌ی ملی'),
    ('7', 'جام ملت‌های آسیا'),
    ('36', 'مقدماتی جام ملت‌های آفریقا')
)
INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
SELECT 'competition', m.internal_id, n.fa, 'fa', 'name', 'd175'
  FROM names n
  JOIN provider_mapping m
    ON m.provider = 'api_football' AND m.entity_type = 'competition' AND m.external_id = n.external_id
ON CONFLICT DO NOTHING;

-- Down Migration
DELETE FROM entity_alias a
 USING provider_mapping m
 WHERE a.entity_type = 'competition' AND a.language = 'fa' AND a.source = 'd175'
   AND m.provider = 'api_football' AND m.entity_type = 'competition'
   AND m.external_id IN ('5', '10', '7', '36') AND a.entity_id = m.internal_id;
