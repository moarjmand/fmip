-- Up Migration
-- T-303: localised entity names against the canonical UUID (blueprint 13.1).
--
-- The tempting shape is a `name_ar` column on `team`, then `name_es`, and
-- eight columns later a translator asks for a language nobody planned. This
-- is rule 1 in a place it is easy to break: a team's Arabic name is a fact
-- *about* the team, never a second team, and never a second column.
--
-- So a localised name is a row in `entity_alias` -- the table search already
-- reads (T-038, T-152) -- with `kind = 'name'` and the language it belongs to.
-- Nothing about search changes: a name row is an alias row, so a reader who
-- types the Arabic name finds the team by the thing that already finds names.
-- What the row adds is *display*: the API can ask for the name in a language
-- and show it beside the canonical one.
--
-- Three things the shape guarantees, here and not in any caller:
--
-- **A name has a language.** An alias may be universal (`language IS NULL`,
-- "Man Utd"); a name may not, because a name without a language is the
-- canonical name, and that lives on the entity.
--
-- **One name per language per entity.** Two Arabic names for one team is two
-- people disagreeing, and the row that wins by chance is not a decision. The
-- unique index is partial: it constrains names and leaves the other kinds as
-- they were.
--
-- **Reading it is one call.** `localised_name(type, id, language)` answers the
-- row or NULL, so every place that shows an entity asks the same question the
-- same way, and NULL means "nobody has written this" rather than "" or the
-- English copied in.
ALTER TABLE entity_alias DROP CONSTRAINT entity_alias_kind_check;
ALTER TABLE entity_alias ADD CONSTRAINT entity_alias_kind_check
  CHECK (kind IN ('name', 'alias', 'transliteration', 'abbreviation', 'former_name', 'misspelling'));

ALTER TABLE entity_alias ADD CONSTRAINT entity_alias_name_has_language
  CHECK (kind <> 'name' OR language IS NOT NULL);

CREATE UNIQUE INDEX entity_alias_one_name_per_language
  ON entity_alias (entity_type, entity_id, language)
  WHERE kind = 'name';

CREATE FUNCTION localised_name(p_entity_type text, p_entity_id uuid, p_language text)
  RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT alias
      FROM entity_alias
     WHERE entity_type = p_entity_type
       AND entity_id = p_entity_id
       AND kind = 'name'
       AND language = p_language
     LIMIT 1
  $$;

COMMENT ON FUNCTION localised_name(text, uuid, text) IS
  'The display name of an entity in one language, or NULL when nobody has written one (T-303). NULL, never the English: the caller decides what a missing name looks like, and it must look missing.';

COMMENT ON TABLE entity_alias IS
  'Every spelling a name does not carry itself: aliases, transliterations, abbreviations, former names, misspellings (T-038) -- and, with kind = name and a language, the entity''s localised display name (T-303). One table, so search finds all of them the same way.';

-- Down Migration
-- The name rows go before the constraint narrows, or the narrowing fails on
-- data the wider constraint allowed. A down migration that cannot run is a
-- down migration that does not exist.
DROP FUNCTION localised_name(text, uuid, text);
DROP INDEX entity_alias_one_name_per_language;
DELETE FROM entity_alias WHERE kind = 'name';
ALTER TABLE entity_alias DROP CONSTRAINT entity_alias_name_has_language;
ALTER TABLE entity_alias DROP CONSTRAINT entity_alias_kind_check;
ALTER TABLE entity_alias ADD CONSTRAINT entity_alias_kind_check
  CHECK (kind IN ('alias', 'transliteration', 'abbreviation', 'former_name', 'misspelling'));
COMMENT ON TABLE entity_alias IS
  'Every spelling a name does not carry itself: aliases, transliterations, abbreviations, former names, misspellings (T-038).';
