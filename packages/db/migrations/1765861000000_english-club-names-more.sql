-- Up Migration
-- T-1400 (D-215): English display names for the clubs D-210 (migration
-- 1765853000000) left as the feed names them, in the competitions added since
-- or not covered then: the Championship, the Scottish Premiership, the Belgian
-- Pro League, the Saudi, UAE and Qatari leagues, MLS, the Brasileirão, the
-- leagues added on 2026-10-11 (D-197), the four domestic cups, the
-- Libertadores, the AFC Champions League Elite and the UEFA qualifying rounds,
-- as stored in production on 2026-10-12 (read-only). Rows in entity_alias,
-- kind 'name', language 'en', source 'd215', read by localised_name() and by
-- every surface (T-1312), search and the news linker. Each is found by the
-- provider's team id through provider_mapping, never by its name (rule 1).
--
-- Only real oddities, each with the stored name beside it:
--   * a stored name that is also an English word, which the news linker
--     cannot tell from the word ("Derby", "Junior", "Bravo", "Europa");
--   * an abbreviation or a letter case no English reader writes ("Sheffield
--     Utd", "ST Mirren", "Estudiantes L.P.", "SHANGHAI SIPG", "Vasco DA Gama");
--   * a feed spelling that is wrong ("Atletico Paranaense" for Athletico,
--     "Al Taawon"), a former name ("SHANGHAI SIPG", "WSG Wattens"), or a city
--     standing for an American club whose name carries "FC" ("Austin",
--     "Charlotte", "San Diego");
--   * the legal prefixes and suffixes D-210 already drops elsewhere ("FC",
--     "SC", "VfL", "1. FC", "NK", "HNK"), and the club's diacritics restored
--     ("Grêmio", "São Paulo", "Wisła Kraków"), as D-210 did.
-- A club already called that, or already carrying an English name, is
-- skipped. City names an English reader uses for the club ("Bolton",
-- "Norwich", "Preston") stay as stored, as D-210 kept "Newcastle". A database
-- without these clubs (a fresh one, CI) inserts nothing.

WITH names(external_id, en) AS (
  VALUES
    -- Championship
    ('69', 'Derby County'),                 -- Derby (the word "derby")
    ('62', 'Sheffield United'),             -- Sheffield Utd
    -- Scottish Premiership
    ('258', 'St Johnstone'),                -- ST Johnstone
    ('251', 'St Mirren'),                   -- ST Mirren
    ('1386', 'Dundee United'),              -- Dundee Utd
    -- Belgian Pro League
    ('733', 'Standard Liège'),              -- Standard Liege
    ('266', 'Mechelen'),                    -- KV Mechelen
    ('261', 'Westerlo'),                    -- KVC Westerlo
    ('5902', 'La Louvière'),                -- RAAL La Louvière
    ('738', 'Beveren'),                     -- SK Beveren
    ('259', 'Lommel'),                      -- Lommel United (a former name)
    -- Saudi Pro League
    ('2932', 'Al-Hilal'),                   -- Al-Hilal Saudi FC
    ('2938', 'Al-Ittihad'),                 -- Al-Ittihad FC
    ('2933', 'Al-Qadsiah'),                 -- Al-Qadisiyah FC
    ('2930', 'Al-Faisaly'),                 -- Al-Faisaly FC
    ('2928', 'Al-Khaleej'),                 -- Al Khaleej Saihat
    ('2940', 'Al-Shabab'),                  -- Al Shabab
    ('2936', 'Al-Taawoun'),                 -- Al Taawon
    ('10509', 'Al-Kholood'),                -- Al Kholood
    ('10511', 'Al-Riyadh'),                 -- Al Riyadh
    ('26738', 'Al-Diriyah'),                -- Al Diriyah
    ('2945', 'Al-Hazem'),                   -- Al-Hazm
    -- UAE Pro League
    ('2875', 'Al-Wahda'),                   -- Al Wahda FC
    ('2872', 'Al-Wasl'),                    -- Al-Wasl FC
    ('10155', 'Al-Nasr'),                   -- Al Nasr
    ('2877', 'Baniyas'),                    -- Baniyas SC
    ('2869', 'Hatta'),                      -- Hatta SC
    ('2874', 'Sharjah'),                    -- Sharjah FC
    -- Qatar Stars League
    ('2905', 'Al-Arabi'),                   -- Al-Arabi SC
    ('2904', 'Al-Duhail'),                  -- Al-Duhail SC
    ('2897', 'Al-Rayyan'),                  -- Al-Rayyan SC
    -- Major League Soccer
    ('1608', 'Atlanta United'),             -- Atlanta United FC
    ('1612', 'Minnesota United'),           -- Minnesota United FC
    ('1614', 'CF Montréal'),                -- CF Montreal
    ('16489', 'Austin FC'),                 -- Austin
    ('18310', 'Charlotte FC'),              -- Charlotte
    ('25484', 'San Diego FC'),              -- San Diego
    ('1605', 'LA Galaxy'),                  -- Los Angeles Galaxy
    ('20787', 'St. Louis City SC'),         -- St. Louis City
    -- Brasileirão
    ('134', 'Athletico Paranaense'),        -- Atletico Paranaense
    ('1062', 'Atlético Mineiro'),           -- Atletico-MG
    ('132', 'Chapecoense'),                 -- Chapecoense-sc
    ('130', 'Grêmio'),                      -- Gremio
    ('126', 'São Paulo'),                   -- Sao Paulo
    ('133', 'Vasco da Gama'),               -- Vasco DA Gama
    ('136', 'Vitória'),                     -- Vitoria
    -- Liga Profesional Argentina
    ('458', 'Argentinos Juniors'),          -- Argentinos JRS
    ('455', 'Atlético Tucumán'),            -- Atletico Tucuman
    ('1065', 'Central Córdoba'),            -- Central Cordoba de Santiago
    ('442', 'Defensa y Justicia'),          -- Defensa Y Justicia
    ('450', 'Estudiantes de La Plata'),     -- Estudiantes L.P.
    ('2424', 'Estudiantes de Río Cuarto'),  -- Estudiantes de Rio Cuarto
    ('434', 'Gimnasia La Plata'),           -- Gimnasia L.P.
    ('1066', 'Gimnasia Mendoza'),           -- Gimnasia M.
    ('445', 'Huracán'),                     -- Huracan
    ('473', 'Independiente Rivadavia'),     -- Independ. Rivadavia
    ('446', 'Lanús'),                       -- Lanus
    ('457', 'Newell''s Old Boys'),          -- Newells Old Boys
    ('441', 'Unión Santa Fe'),              -- Union Santa Fe
    ('438', 'Vélez Sarsfield'),             -- Velez Sarsfield
    -- CONMEBOL Libertadores
    ('1176', 'Cerro Porteño'),              -- Cerro Porteno
    ('1174', 'Guaraní'),                    -- Club Guarani
    ('2807', 'Deportivo Táchira'),          -- Deportivo Tachira FC
    ('1128', 'Independiente Medellín'),     -- Independiente Medellin
    ('1135', 'Atlético Junior'),            -- Junior (the word "junior")
    ('1158', 'LDU Quito'),                  -- LDU de Quito
    ('2348', 'Peñarol'),                    -- Penarol
    ('1139', 'Independiente Santa Fe'),     -- Santa Fe (a city; "Unión Santa Fe" is another club)
    ('1157', 'Universidad Católica'),       -- Universidad Catolica
    ('2810', 'Carabobo'),                   -- Carabobo FC
    -- AFC Champions League Elite
    ('836', 'Shanghai Port'),               -- SHANGHAI SIPG (its former name)
    ('2762', 'Jeonbuk Hyundai Motors'),     -- Jeonbuk Motors
    ('290', 'Kashima Antlers'),             -- Kashima
    ('2523', 'Johor Darul Ta''zim'),        -- Johor Darul Takzim FC
    -- Ekstraklasa
    ('339', 'Legia Warsaw'),                -- Legia Warszawa
    ('350', 'Cracovia'),                    -- Cracovia Krakow
    ('338', 'Wisła Kraków'),                -- Wisla Krakow
    ('341', 'Wisła Płock'),                 -- Wisla Plock
    ('348', 'Pogoń Szczecin'),              -- Pogon Szczecin
    ('337', 'Śląsk Wrocław'),               -- Slask Wroclaw
    ('345', 'Zagłębie Lubin'),              -- Zaglebie Lubin
    ('340', 'Górnik Zabrze'),               -- Gornik Zabrze
    ('336', 'Jagiellonia Białystok'),       -- Jagiellonia
    -- Danish Superliga
    ('407', 'Brøndby'),                     -- Brondby
    ('396', 'SønderjyskE'),                 -- Sonderjyske
    ('401', 'Randers'),                     -- Randers FC
    ('404', 'Horsens'),                     -- AC Horsens
    -- Super League Greece
    ('1123', 'Aris Thessaloniki'),          -- Aris Thessalonikis
    ('2110', 'Volos'),                      -- Volos NFC
    ('1124', 'OFI Crete'),                  -- OFI
    -- Swiss Super League
    ('565', 'Young Boys'),                  -- BSC Young Boys
    ('551', 'Basel'),                       -- FC Basel 1893
    ('644', 'Luzern'),                      -- FC Luzern
    ('783', 'Zürich'),                      -- FC Zurich
    ('1011', 'St. Gallen'),                 -- FC ST. Gallen
    ('630', 'Sion'),                        -- FC Sion
    ('660', 'Vaduz'),                       -- FC Vaduz
    ('2184', 'Servette'),                   -- Servette FC
    -- HNL
    ('1068', 'Gorica'),                     -- HNK Gorica
    ('1017', 'Lokomotiva Zagreb'),          -- NK Lokomotiva Zagreb
    ('616', 'Osijek'),                      -- NK Osijek
    ('1018', 'Slaven Belupo'),              -- NK Slaven Belupo
    ('1019', 'Rudeš'),                      -- Rudes
    ('561', 'Rijeka'),                      -- HNK Rijeka
    ('1483', 'Varaždin'),                   -- NK Varazdin
    -- Austrian Bundesliga
    ('618', 'Altach'),                      -- SCR Altach
    ('1072', 'Hartberg'),                   -- TSV Hartberg
    ('1398', 'WSG Tirol'),                  -- WSG Wattens (its former name)
    -- Serbian SuperLiga
    ('2656', 'Čukarički'),                  -- Cukaricki
    ('2637', 'Mačva'),                      -- Macva
    ('699', 'Mladost Lučani'),              -- Mladost Lucani
    ('2644', 'Radnički 1923'),              -- Radnicki 1923
    ('2254', 'Radnički Niš'),               -- Radnicki NIS
    ('573', 'Partizan'),                    -- FK Partizan
    -- Czech First League
    ('640', 'Mladá Boleslav'),              -- Mlada Boleslav
    ('603', 'Zlín'),                        -- Zlin
    ('4257', 'Artis Brno'),                 -- Artis
    -- DFB-Pokal
    ('180', 'Heidenheim'),                  -- 1. FC Heidenheim
    ('745', 'Kaiserslautern'),              -- 1. FC Kaiserslautern
    ('179', 'Magdeburg'),                   -- 1. FC Magdeburg
    ('171', 'Nürnberg'),                    -- 1. FC Nürnberg
    ('186', 'St. Pauli'),                   -- FC St. Pauli
    ('1325', 'Carl Zeiss Jena'),            -- FC Carl Zeiss Jena
    ('1639', 'Saarbrücken'),                -- FC Saarbrücken
    ('1620', 'Viktoria Köln'),              -- FC Viktoria Köln
    ('181', 'Darmstadt'),                   -- SV Darmstadt 98
    ('1319', 'Wehen Wiesbaden'),            -- SV Wehen
    ('178', 'Greuther Fürth'),              -- SpVgg Greuther Fürth
    ('786', '1860 Munich'),                 -- TSV 1860 München
    ('176', 'Bochum'),                      -- VfL Bochum
    ('1324', 'Osnabrück'),                  -- VfL Osnabrück
    ('161', 'Wolfsburg'),                   -- VfL Wolfsburg
    ('159', 'Hertha Berlin'),               -- Hertha BSC
    ('187', 'Duisburg'),                    -- MSV Duisburg
    ('785', 'Karlsruhe'),                   -- Karlsruher SC
    -- Coppa Italia
    ('1578', 'Südtirol'),                   -- Sudtirol
    ('1584', 'Vicenza'),                    -- Vicenza Virtus
    ('527', 'Entella'),                     -- Virtus Entella
    -- Copa del Rey
    ('724', 'Cádiz'),                       -- Cadiz
    ('723', 'Almería'),                     -- Almeria
    ('537', 'Leganés'),                     -- Leganes
    ('799', 'Mirandés'),                    -- Mirandes
    ('731', 'Sporting Gijón'),              -- Sporting Gijon
    ('715', 'Granada'),                     -- Granada CF
    ('713', 'Córdoba'),                     -- Cordoba
    ('593', 'CE Europa'),                   -- Europa Fc
    ('10139', 'Ceuta'),                     -- AD Ceuta FC
    ('5262', 'Cartagena'),                  -- FC Cartagena
    ('9410', 'Recreativo de Huelva'),       -- Recreativo Huelva
    -- FA Cup
    ('1843', 'Havant & Waterlooville'),     -- Havant & Wville
    ('7642', 'Felixstowe & Walton United'), -- Felixstowe & Walton Utd
    ('1825', 'Maidstone United'),           -- Maidstone Utd
    ('1835', 'Sutton United'),              -- Sutton Utd
    ('4680', 'Hampton & Richmond Borough'), -- Hampton & Richmond
    -- UEFA qualifying rounds
    ('357', 'Connah''s Quay Nomads'),       -- GAP Connah S Quay FC
    ('698', 'St Joseph''s'),                -- St Joseph S Fc
    ('2402', 'Győri ETO'),                  -- Gyori ETO FC
    ('669', 'Coleraine'),                   -- Coleraine FC
    ('659', 'Valletta'),                    -- Valletta FC
    ('388', 'BATE Borisov'),                -- Bate Borisov
    ('366', 'IFK Göteborg'),                -- IFK Goteborg
    ('325', 'Tromsø'),                      -- Tromso
    ('556', 'Qarabağ'),                     -- Qarabag
    ('278', 'Víkingur Reykjavík'),          -- Vikingur Reykjavik
    ('2392', 'Debrecen'),                   -- Debreceni VSC
    ('4359', 'NK Bravo'),                   -- Bravo (the word "bravo")
    ('10125', 'Europa FC')                  -- Europa (the word, and D-211's Europa League)
)
INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
SELECT 'team', t.id, n.en, 'en', 'name', 'd215'
  FROM names n
  JOIN provider_mapping m
    ON m.provider = 'api_football' AND m.entity_type = 'team' AND m.external_id = n.external_id
  JOIN team t ON t.id = m.internal_id
 WHERE t.name <> n.en
   AND NOT EXISTS (SELECT 1 FROM entity_alias a
                    WHERE a.entity_type = 'team' AND a.entity_id = t.id
                      AND a.kind = 'name' AND a.language = 'en')
ON CONFLICT DO NOTHING;

-- A longer name changes how the stored short one is read in a headline
-- (migration 1765860000000, rule 4: "Derby" beside "Derby County"), so the
-- stored links of the clubs named here are checked again by the same rule.
-- 5 is the linker's MINIMUM_NAME_LENGTH. `article_entity` has no trigger.
DELETE FROM article_entity e
 WHERE e.entity_type = 'team'
   AND e.entity_id IN (SELECT a.entity_id FROM entity_alias a
                        WHERE a.source = 'd215' AND a.entity_type = 'team')
   AND NOT EXISTS (
         SELECT 1 FROM news_named_entities(e.article_id, 5, true) k
          WHERE k.entity_type = e.entity_type AND k.entity_id = e.entity_id);

DELETE FROM article_entity e
 WHERE e.entity_type = 'fixture'
   AND (SELECT count(*)
          FROM fixture_participant p
          JOIN article_entity t
            ON t.article_id = e.article_id AND t.entity_type = 'team' AND t.entity_id = p.team_id
         WHERE p.fixture_id = e.entity_id) < 2;

-- Down Migration
-- The links removed above are not restored: they were wrong.
DELETE FROM entity_alias WHERE source = 'd215' AND entity_type = 'team' AND kind = 'name' AND language = 'en';
