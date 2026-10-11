-- Up Migration
-- T-1391 (D-207): the English site for a reader abroad.
--
-- 1. The competitions' order per language. `competition.display_order`
--    (T-504, D-154) stays the default order, the one /fa reads today. A
--    language may state an order of its own here; a reader in that language
--    gets it, and a competition it does not place comes after every one it
--    does (by country and name, as an unplaced competition always has). A
--    language with no row at all reads the default order. Set with
--    `catalog.mjs --set-order --locale en` or the console, both audited.

CREATE TABLE competition_display_order (
  competition_id uuid NOT NULL REFERENCES competition (id) ON DELETE CASCADE,
  -- The language subtag the order is for: 'en', never 'en-GB'.
  locale         text NOT NULL,
  position       smallint NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, locale),
  CONSTRAINT competition_display_order_locale_format CHECK (locale ~ '^[a-z]{2,3}$'),
  CONSTRAINT competition_display_order_position_positive CHECK (position >= 1)
);

CREATE INDEX competition_display_order_locale_idx ON competition_display_order (locale);

COMMENT ON TABLE competition_display_order IS
  'A language''s own order of the competitions on the scores page and the homepage (T-1391, D-207). A language with rows here reads them, unplaced competitions after; a language with none reads competition.display_order.';

-- 2. English readers are shown English-language sources only (D-207). The
--    console's per-source setting (D-178) still decides for every other
--    language, so a Persian reader is shown what they were shown before. A
--    source always carries a language (`news_source.language` is NOT NULL).

CREATE OR REPLACE FUNCTION news_visible_to(same_language_only boolean, source_language text, reader_locale text)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT reader_locale IS NULL
        OR CASE WHEN lower(split_part(reader_locale, '-', 1)) = 'en'
                THEN lower(split_part(source_language, '-', 1)) = 'en'
                ELSE NOT same_language_only
                  OR lower(split_part(source_language, '-', 1)) = lower(split_part(reader_locale, '-', 1))
           END
  $$;

-- 3. English display names for the Persian Gulf Pro League's clubs, in the
--    short form an English reader knows (T-1391, D-207), beside the Persian
--    ones (T-1311, D-175): rows in entity_alias with kind = 'name' and
--    language = 'en', which localised_name() and the names on every surface
--    (T-1312) already read. Matched as D-175's were, by the club's stored
--    name and the league (here by its provider id, 290, in provider_mapping),
--    so a club of the same name elsewhere is untouched. A name the club
--    already carries is not written again. A database without the league
--    (a fresh one, CI) inserts nothing.

WITH names(name, en) AS (
  VALUES
    ('Aluminium Arak', 'Aluminium Arak'),
    ('Chadormalu SC', 'Chadormalu'),
    ('Esteghlal FC', 'Esteghlal'),
    ('Esteghlal Khuzestan', 'Esteghlal Khuzestan'),
    ('Fajr Sepasi', 'Fajr Sepasi'),
    ('Foolad FC', 'Foolad'),
    ('Gol Gohar', 'Gol Gohar'),
    ('Havadar', 'Havadar'),
    ('Kheybar Khorramabad', 'Kheybar Khorramabad'),
    ('Malavan', 'Malavan'),
    ('Mes Rafsanjan', 'Mes Rafsanjan'),
    ('Mes Shahr-e Babak', 'Mes Shahr-e Babak'),
    ('Nassaji Mazandaran', 'Nassaji'),
    ('Paykan', 'Paykan'),
    ('Persepolis FC', 'Persepolis'),
    ('Sanat Naft', 'Sanat Naft'),
    ('Sepahan FC', 'Sepahan'),
    ('Shams Azar Qazvin', 'Shams Azar'),
    ('Tractor Sazi', 'Tractor'),
    ('ZOB Ahan', 'Zob Ahan')
), clubs AS (
  SELECT DISTINCT t.id, n.en
    FROM names n
    JOIN team t ON t.name = n.name
    JOIN fixture_participant fp ON fp.team_id = t.id
    JOIN fixture f ON f.id = fp.fixture_id
    JOIN season s ON s.id = f.season_id
    JOIN provider_mapping pm ON pm.internal_id = s.competition_id
                            AND pm.entity_type = 'competition'
                            AND pm.provider = 'api_football'
                            AND pm.external_id = '290'
   WHERE n.en <> n.name
)
INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
SELECT 'team', id, en, 'en', 'name', 'd207' FROM clubs
ON CONFLICT DO NOTHING;

-- Down Migration

DELETE FROM entity_alias WHERE source = 'd207' AND kind = 'name' AND language = 'en';

CREATE OR REPLACE FUNCTION news_visible_to(same_language_only boolean, source_language text, reader_locale text)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT reader_locale IS NULL
        OR NOT same_language_only
        OR lower(split_part(source_language, '-', 1)) = lower(split_part(reader_locale, '-', 1))
  $$;

DROP TABLE competition_display_order;
