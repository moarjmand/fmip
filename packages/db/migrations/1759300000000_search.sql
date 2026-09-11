-- Up Migration

-- Entity search (T-038, D-039): trigram similarity over accent-folded,
-- lower-cased names, plus an alias table for the spellings a name does not
-- carry itself (transliterations, abbreviations, former names, common
-- misspellings). Both extensions ship with PostgreSQL contrib.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is STABLE (its dictionary could change), so it cannot sit in an
-- index expression directly. This wrapper declares the immutability we rely
-- on: the shipped dictionary is the only one in use.
CREATE FUNCTION search_key(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent', input)) $$;

COMMENT ON FUNCTION search_key(text) IS
  'Accent-folded, lower-cased form of a name: what search compares and indexes.';

CREATE TABLE entity_alias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  alias       text NOT NULL,
  -- BCP 47 tag of the alias when it belongs to one language ('fa'), NULL when it is universal.
  language    text,
  kind        text NOT NULL,
  -- Where the alias came from: 'seed', 'admin', a provider name.
  source      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_alias_type_check CHECK (entity_type IN ('team', 'competition', 'person')),
  CONSTRAINT entity_alias_kind_check CHECK (
    kind IN ('alias', 'transliteration', 'abbreviation', 'former_name', 'misspelling')
  ),
  CONSTRAINT entity_alias_not_blank CHECK (btrim(alias) <> '')
);

COMMENT ON TABLE entity_alias IS
  'Other spellings of a catalog entity''s name, for search (T-038). Never shown as the name.';

CREATE UNIQUE INDEX entity_alias_unique ON entity_alias (entity_type, entity_id, search_key(alias));
CREATE INDEX entity_alias_entity_idx ON entity_alias (entity_type, entity_id);
CREATE INDEX entity_alias_trgm_idx ON entity_alias USING gin (search_key(alias) gin_trgm_ops);

CREATE INDEX team_name_trgm_idx ON team USING gin (search_key(name) gin_trgm_ops);
CREATE INDEX competition_name_trgm_idx ON competition USING gin (search_key(name) gin_trgm_ops);
CREATE INDEX person_full_name_trgm_idx ON person USING gin (search_key(full_name) gin_trgm_ops);
CREATE INDEX person_known_as_trgm_idx ON person USING gin (search_key(known_as) gin_trgm_ops);

-- Down Migration

DROP INDEX person_known_as_trgm_idx;
DROP INDEX person_full_name_trgm_idx;
DROP INDEX competition_name_trgm_idx;
DROP INDEX team_name_trgm_idx;
DROP TABLE entity_alias;
DROP FUNCTION search_key(text);
DROP EXTENSION unaccent;
DROP EXTENSION pg_trgm;
