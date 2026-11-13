-- Up Migration
-- T-1817 (D-412): the Persian site shows the other languages' stories again,
-- each headline labelled with its language.
--
-- D-348 (T-1718, migration 1765900818000) kept a Persian reader to Persian
-- sources. The maintainer decided on 2026-11-13 (desk decision
-- d-2026-11-02-03) that English, German and the other languages' headlines
-- stay on /fa, each with its language beside it; the web draws the label. So
-- `news_visible_to()` answers for a Persian reader as it did before D-348 --
-- D-178's per-source rule: every source not set `same_language_only`, and a
-- source that is, in the reader's language. English keeps D-207's rule.
-- This is D-348's Down, and its Down is D-348's Up. No row is touched.

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

-- Down Migration

CREATE OR REPLACE FUNCTION news_visible_to(same_language_only boolean, source_language text, reader_locale text)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT reader_locale IS NULL
        OR CASE WHEN lower(split_part(reader_locale, '-', 1)) IN ('en', 'fa')
                THEN lower(split_part(source_language, '-', 1)) = lower(split_part(reader_locale, '-', 1))
                ELSE NOT same_language_only
                  OR lower(split_part(source_language, '-', 1)) = lower(split_part(reader_locale, '-', 1))
           END
  $$;
