-- Up Migration
-- Persian display names for the clubs a Persian reader meets first and for
-- every competition we carry (T-1311, D-175): rows in entity_alias with
-- kind = 'name' and language = 'fa', which localised_name() already reads
-- (T-303) and search already matches (T-038).
--
-- The clubs are those that played in the Persian Gulf Pro League in any
-- season we hold, matched by their stored name and that league, so a club of
-- the same name elsewhere is untouched. The competitions are matched by name. A database without them (a fresh one, CI) inserts nothing.
-- The words were written by the agent at the maintainer's request (D-175).

WITH names(name, fa) AS (
  VALUES
    ('Aluminium Arak', 'آلومینیوم اراک'),
    ('Chadormalu SC', 'چادرملو اردکان'),
    ('Esteghlal FC', 'استقلال'),
    ('Esteghlal Khuzestan', 'استقلال خوزستان'),
    ('Fajr Sepasi', 'فجر سپاسی'),
    ('Foolad FC', 'فولاد'),
    ('Gol Gohar', 'گل‌گهر سیرجان'),
    ('Havadar', 'هوادار'),
    ('Kheybar Khorramabad', 'خیبر خرم‌آباد'),
    ('Malavan', 'ملوان'),
    ('Mes Rafsanjan', 'مس رفسنجان'),
    ('Mes Shahr-e Babak', 'مس شهربابک'),
    ('Nassaji Mazandaran', 'نساجی مازندران'),
    ('Paykan', 'پیکان'),
    ('Persepolis FC', 'پرسپولیس'),
    ('Sanat Naft', 'صنعت نفت آبادان'),
    ('Sepahan FC', 'سپاهان'),
    ('Shams Azar Qazvin', 'شمس آذر قزوین'),
    ('Tractor Sazi', 'تراکتور'),
    ('ZOB Ahan', 'ذوب‌آهن')
), clubs AS (
  SELECT DISTINCT t.id, n.fa
    FROM names n
    JOIN team t ON t.name = n.name
    JOIN fixture_participant fp ON fp.team_id = t.id
    JOIN fixture f ON f.id = fp.fixture_id
    JOIN season s ON s.id = f.season_id
    JOIN competition c ON c.id = s.competition_id
   WHERE c.name = 'Persian Gulf Pro League'
)
INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
SELECT 'team', id, fa, 'fa', 'name', 'd175' FROM clubs
ON CONFLICT DO NOTHING;

WITH names(name, fa) AS (
  VALUES
    ('Belgian Pro League', 'لیگ برتر بلژیک'),
    ('Bundesliga', 'بوندس‌لیگا'),
    ('Championship', 'چمپیونشیپ انگلیس'),
    ('Eredivisie', 'اردیویسی هلند'),
    ('La Liga', 'لالیگا'),
    ('Ligue 1', 'لوشامپیونه'),
    ('Persian Gulf Pro League', 'لیگ برتر خلیج فارس'),
    ('Premier League', 'لیگ برتر انگلیس'),
    ('Primeira Liga', 'لیگ برتر پرتغال'),
    ('Scottish Premiership', 'لیگ برتر اسکاتلند'),
    ('Serie A', 'سری آ'),
    ('Süper Lig', 'سوپرلیگ ترکیه'),
    ('UEFA Champions League', 'لیگ قهرمانان اروپا'),
    ('UEFA Conference League', 'لیگ کنفرانس اروپا'),
    ('UEFA Europa League', 'لیگ اروپا')
)
INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
SELECT 'competition', c.id, n.fa, 'fa', 'name', 'd175'
  FROM names n
  JOIN competition c ON c.name = n.name
ON CONFLICT DO NOTHING;

-- Down Migration

DELETE FROM entity_alias WHERE source = 'd175' AND kind = 'name' AND language = 'fa';
