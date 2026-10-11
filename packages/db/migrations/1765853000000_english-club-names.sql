-- Up Migration
-- T-1395 (D-210): English display names for the big foreign clubs, in the
-- form an English reader expects ("Bayern Munich", not the feed's "Bayern
-- München"), beside the Iranian clubs' (T-1391, D-207). Rows in entity_alias
-- with kind = 'name' and language = 'en', which localised_name() and the
-- names on every surface (T-1312) already read; search finds them too.
--
-- The clubs of the five big leagues, the Champions League, Europa League and
-- Conference League league-phase sides, and the Eredivisie, Primeira Liga and
-- Süper Lig, as stored in production on 2026-10-11 (read-only). Each is found
-- by the provider's team id in provider_mapping, never by its name (rule 1).
-- Only a club whose English form differs from its stored name is listed, and
-- a club whose stored name already reads that way is skipped. A database
-- without these clubs (a fresh one, CI) inserts nothing.

WITH names(external_id, en) AS (
  VALUES
    -- Serie A
    ('497', 'Roma'),                      -- AS Roma
    -- La Liga
    ('542', 'Alavés'),                    -- Alaves
    ('530', 'Atlético Madrid'),           -- Atletico Madrid
    ('544', 'Deportivo La Coruña'),       -- Deportivo La Coruna
    ('535', 'Málaga'),                    -- Malaga
    -- Bundesliga
    ('157', 'Bayern Munich'),             -- Bayern München
    ('192', 'Cologne'),                   -- 1. FC Köln
    ('163', 'Mönchengladbach'),           -- Borussia Mönchengladbach
    ('170', 'Augsburg'),                  -- FC Augsburg
    ('174', 'Schalke 04'),                -- FC Schalke 04
    ('164', 'Mainz'),                     -- FSV Mainz 05
    ('175', 'Hamburg'),                   -- Hamburger SV
    ('167', 'Hoffenheim'),                -- 1899 Hoffenheim
    ('185', 'Paderborn'),                 -- SC Paderborn 07
    ('160', 'Freiburg'),                  -- SC Freiburg
    ('1660', 'Elversberg'),               -- SV Elversberg
    ('172', 'Stuttgart'),                 -- VfB Stuttgart
    -- Ligue 1
    ('85', 'Paris Saint-Germain'),        -- Paris Saint Germain
    ('110', 'Troyes'),                    -- Estac Troyes
    ('106', 'Brest'),                     -- Stade Brestois 29
    -- Eredivisie
    ('410', 'Go Ahead Eagles'),           -- GO Ahead Eagles
    -- Primeira Liga
    ('212', 'Porto'),                     -- FC Porto
    ('217', 'Braga'),                     -- SC Braga
    ('238', 'Académico de Viseu'),        -- Academico Viseu
    ('15130', 'Estrela da Amadora'),      -- Estrela
    ('242', 'Famalicão'),                 -- Famalicao
    ('762', 'Gil Vicente'),               -- GIL Vicente
    ('214', 'Marítimo'),                  -- Maritimo
    ('224', 'Vitória de Guimarães'),      -- Vitória SC
    -- Süper Lig
    ('1009', 'Erzurumspor'),              -- Erzurumspor FK
    ('3573', 'Gaziantep'),                -- Gaziantep FK
    ('997', 'Gençlerbirliği'),            -- Gençlerbirliği S.K.
    -- Champions League league phase
    ('575', 'AEK Athens'),                -- AEK Athens FC
    ('327', 'Bodø/Glimt'),                -- Bodo/Glimt
    ('569', 'Club Brugge'),               -- Club Brugge KV
    ('1026', 'LASK'),                     -- Lask Linz
    ('13976', 'Sabah'),                   -- Sabah FA
    ('560', 'Slavia Prague'),             -- Slavia Praha
    -- Europa League league phase
    ('651', 'Ferencváros'),               -- Ferencvarosi TC
    ('347', 'Lech Poznań'),               -- Lech Poznan
    ('321', 'Lillestrøm'),                -- Lillestrom
    ('553', 'Olympiacos'),                -- Olympiakos Piraeus
    ('567', 'Viktoria Plzeň'),            -- Plzen
    ('628', 'Sparta Prague'),             -- Sparta Praha
    ('1393', 'Union Saint-Gilloise'),     -- Union St. Gilloise
    -- Conference League league phase
    ('3327', 'Egnatia'),                  -- Egnatia Rrogozhinë
    ('3502', 'Iberia 1999'),              -- FC Iberia 1999
    ('606', 'Lugano'),                    -- FC Lugano
    ('397', 'Midtjylland'),               -- FC Midtjylland
    ('398', 'Nordsjælland'),              -- FC Nordsjaelland
    ('1012', 'Thun'),                     -- FC Thun
    ('598', 'Red Star Belgrade'),         -- FK Crvena Zvezda
    ('1122', 'Jablonec'),                 -- FK Jablonec
    ('608', 'Hajduk Split'),              -- HNK Hajduk Split
    ('254', 'Hearts'),                    -- Heart Of Midlothian
    ('667', 'Lincoln Red Imps'),          -- Lincoln Red Imps FC
    ('2240', 'Mjällby'),                  -- Mjallby AIF
    ('10124', 'Riga FC'),                 -- Riga
    ('735', 'Sint-Truiden')               -- St. Truiden
)
INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
SELECT 'team', t.id, n.en, 'en', 'name', 'd210'
  FROM names n
  JOIN provider_mapping m
    ON m.provider = 'api_football' AND m.entity_type = 'team' AND m.external_id = n.external_id
  JOIN team t ON t.id = m.internal_id
 WHERE t.name <> n.en
ON CONFLICT DO NOTHING;

-- Down Migration
DELETE FROM entity_alias WHERE source = 'd210' AND entity_type = 'team' AND kind = 'name' AND language = 'en';
