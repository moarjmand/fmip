-- Up Migration

-- T-152: fold Arabic-script letter variants in `search_key`, so the same name
-- typed in Arabic and in Persian is the same string to search.
--
-- **The measurement that prompted this.** The seeded Persian alias for
-- Manchester United is `منچستر یونایتد`. Typed with the Arabic letter forms —
-- `منچستر يونايتد`, which differ only in characters that look nearly identical
-- on screen — it scored **0.467** against that alias, against a 0.45 threshold.
-- A near-miss is worse than a clean failure: it works for one name and not the
-- next, and nobody can tell why.
--
-- What this does is what `unaccent` already does for Latin: fold the forms a
-- reader cannot reliably distinguish, before comparing. It is not
-- transliteration. `ليفربول` still will not find `Liverpool` — that needs an
-- alias, which is what `entity_alias` is for, and inventing a rule to guess it
-- would produce matches nobody can justify.
--
-- The foldings, all of them standard for Arabic-script search:
--   * yeh forms  ی ئ ى  → ي     (Farsi yeh, hamza-yeh, alef maksura)
--   * kaf forms  ک      → ك     (keheh)
--   * alef forms أ إ آ ٱ → ا
--   * heh        ة      → ه     (teh marbuta)
--   * waw        ؤ      → و
--   * digits     ٠-٩ ۰-۹ → 0-9
--   * removed: tatweel ـ and the harakat, which are optional in writing and
--     almost never typed into a search box.

-- The indexes below are built on `search_key`, so replacing the function makes
-- every stored entry wrong. They are dropped first and rebuilt after, rather
-- than reindexed, so that a failure leaves no index silently disagreeing with
-- the function that built it.
DROP INDEX IF EXISTS entity_alias_unique;
DROP INDEX IF EXISTS entity_alias_trgm_idx;
DROP INDEX IF EXISTS team_name_trgm_idx;
DROP INDEX IF EXISTS competition_name_trgm_idx;
DROP INDEX IF EXISTS person_full_name_trgm_idx;
DROP INDEX IF EXISTS person_known_as_trgm_idx;

-- One function, not two. A helper would have to exist before this body could
-- be parsed, and an ordering that subtle inside a migration is a trap for
-- whoever edits it next.
CREATE OR REPLACE FUNCTION search_key(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT regexp_replace(translate(lower(public.unaccent('public.unaccent', input)), 'یئىکأإآٱةؤ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ييييااااهو01234567890123456789'), '[ـً-ْٰ]', '', 'g') $$;

COMMENT ON FUNCTION search_key(text) IS
  'Accent-folded, lower-cased, Arabic-script-folded form of a name: what search compares and indexes (T-038, T-152).';

-- Rebuilding the unique index can fail, and that failure is information: two
-- aliases of one entity that differ only in letter forms are the same alias
-- twice, and one of them should be removed rather than kept apart by a
-- distinction no reader can see.
CREATE UNIQUE INDEX entity_alias_unique ON entity_alias (entity_type, entity_id, search_key(alias));
CREATE INDEX entity_alias_trgm_idx ON entity_alias USING gin (search_key(alias) gin_trgm_ops);
CREATE INDEX team_name_trgm_idx ON team USING gin (search_key(name) gin_trgm_ops);
CREATE INDEX competition_name_trgm_idx ON competition USING gin (search_key(name) gin_trgm_ops);
CREATE INDEX person_full_name_trgm_idx ON person USING gin (search_key(full_name) gin_trgm_ops);
CREATE INDEX person_known_as_trgm_idx ON person USING gin (search_key(known_as) gin_trgm_ops);

-- Down Migration

DROP INDEX IF EXISTS entity_alias_unique;
DROP INDEX IF EXISTS entity_alias_trgm_idx;
DROP INDEX IF EXISTS team_name_trgm_idx;
DROP INDEX IF EXISTS competition_name_trgm_idx;
DROP INDEX IF EXISTS person_full_name_trgm_idx;
DROP INDEX IF EXISTS person_known_as_trgm_idx;

CREATE OR REPLACE FUNCTION search_key(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent', input)) $$;

CREATE UNIQUE INDEX entity_alias_unique ON entity_alias (entity_type, entity_id, search_key(alias));
CREATE INDEX entity_alias_trgm_idx ON entity_alias USING gin (search_key(alias) gin_trgm_ops);
CREATE INDEX team_name_trgm_idx ON team USING gin (search_key(name) gin_trgm_ops);
CREATE INDEX competition_name_trgm_idx ON competition USING gin (search_key(name) gin_trgm_ops);
CREATE INDEX person_full_name_trgm_idx ON person USING gin (search_key(full_name) gin_trgm_ops);
CREATE INDEX person_known_as_trgm_idx ON person USING gin (search_key(known_as) gin_trgm_ops);
