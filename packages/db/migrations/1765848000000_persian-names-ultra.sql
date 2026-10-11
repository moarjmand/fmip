-- Up Migration
-- Persian names for the 20 competitions added on the API-Football Ultra plan
-- on 2026-10-11 (T-1379, D-197; written by the agent at the maintainer's
-- request, D-175). Found by the provider's ids in `provider_mapping`, never by
-- a name (rule 1); a deployment without these competitions writes nothing.
WITH names(external_id, fa) AS (
  VALUES
    ('45', 'جام حذفی انگلیس'),
    ('143', 'کوپا دل ری'),
    ('137', 'جام حذفی ایتالیا'),
    ('81', 'جام حذفی آلمان'),
    ('307', 'لیگ برتر عربستان'),
    ('253', 'لیگ ام‌ال‌اس آمریکا'),
    ('71', 'سری آ برزیل'),
    ('128', 'لیگ برتر آرژانتین'),
    ('13', 'کوپا لیبرتادورس'),
    ('17', 'لیگ نخبگان آسیا'),
    ('301', 'لیگ برتر امارات'),
    ('305', 'لیگ ستارگان قطر'),
    ('106', 'لیگ برتر لهستان'),
    ('286', 'سوپرلیگ صربستان'),
    ('210', 'لیگ برتر کرواسی'),
    ('218', 'بوندس‌لیگای اتریش'),
    ('207', 'سوپرلیگ سوئیس'),
    ('119', 'سوپرلیگای دانمارک'),
    ('197', 'سوپرلیگ یونان'),
    ('345', 'لیگ برتر چک')
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
   AND m.external_id IN ('45', '143', '137', '81', '307', '253', '71', '128', '13', '17',
                         '301', '305', '106', '286', '210', '218', '207', '119', '197', '345')
   AND a.entity_id = m.internal_id;
