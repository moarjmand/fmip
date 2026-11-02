-- Up Migration
-- T-1718 (D-348): Persian readers are shown Persian-language sources only.
--
-- /fa/news listed English and German headlines among its first thirty
-- (aud-2026-11-01-02, qa-2026-10-31-04): only a source set
-- `same_language_only` was kept from other readers (D-178), and the English
-- and German publishers are not. The maintainer decided on 2026-11-02 that
-- /fa shows only Persian news. As D-207 did for English, `news_visible_to()`
-- now answers, for a reader whose language subtag is `fa`, whether the
-- source's language is Persian. The source's language, not the version's:
-- D-178 and D-207 already rejected the version's (a translation is not a
-- Persian publisher). Every reader path calls this function, so every one
-- inherits it: the news sections, the breaking strip, team, competition,
-- player and match news, the story page (404), story search, saved stories
-- (`other_language`), the Following feed and story alerts. English keeps
-- D-207's rule, and every other language the console's per-source setting
-- (D-178). `news_source.language` is NOT NULL, so no source is without one.

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

-- Down Migration

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
