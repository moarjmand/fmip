-- Up Migration
-- Persian names for the ten cups added on 2026-10-29 for the model factors
-- (T-1649, D-303, D-304; written by the agent at the maintainer's request,
-- D-175). Found by the provider's ids in `provider_mapping`, never by a name
-- (rule 1); a deployment without these competitions writes nothing. The style
-- follows 1765848000000_persian-names-ultra.sql ("جام حذفی انگلیس").
WITH names(external_id, fa) AS (
  VALUES
    ('48', 'جام اتحادیه انگلیس'),
    ('90', 'جام حذفی هلند'),
    ('96', 'جام حذفی پرتغال'),
    ('206', 'جام حذفی ترکیه'),
    ('181', 'جام حذفی اسکاتلند'),
    ('185', 'جام اتحادیه اسکاتلند'),
    ('147', 'جام حذفی بلژیک'),
    ('495', 'جام حذفی ایران'),
    ('11', 'کوپا سودامریکانا'),
    ('18', 'لیگ قهرمانان آسیا ۲')
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
   AND m.external_id IN ('48', '90', '96', '206', '181', '185', '147', '495', '11', '18')
   AND a.entity_id = m.internal_id;
