-- Up Migration
-- T-1330 (D-178): a source whose stories are shown only to readers of its own
-- language, set per source by an administrator in the console. On by default
-- for every Persian source, which is what the maintainer asked for: a reader
-- of the site in English (or any other language) is not shown news read from
-- Persian publishers. A reader of a source's language sees it as before.

ALTER TABLE news_source
  ADD COLUMN same_language_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN news_source.same_language_only IS
  'When true, this source''s articles are shown only to a reader whose locale has the source''s language subtag (D-178). Set in the console, audited.';

UPDATE news_source SET same_language_only = true
 WHERE lower(split_part(language, '-', 1)) = 'fa';

-- Whether an article from a source is shown to a reader (D-178). No reader
-- locale (an internal caller, the console) sees everything; otherwise a
-- same-language-only source is shown only when the language subtags match.
-- A plain expression, so the planner inlines it.
CREATE FUNCTION news_visible_to(same_language_only boolean, source_language text, reader_locale text)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT reader_locale IS NULL
        OR NOT same_language_only
        OR lower(split_part(source_language, '-', 1)) = lower(split_part(reader_locale, '-', 1))
  $$;

-- The article a story shows a reader (D-178): its promoted original when that
-- is visible to the reader; otherwise, when the original is hidden by its
-- source's language setting, the newest visible article from a carried
-- source; NULL when none is. With no reader locale it is always the promoted
-- original, so every read without one is unchanged. A read that joins
-- `article a ON a.id = story_shown_article(...)` and then requires a carried
-- source keeps D-061's rule that a dropped original hides its story.
CREATE FUNCTION story_shown_article(p_story uuid, p_promoted uuid, p_locale text)
  RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT CASE
      WHEN p_locale IS NULL THEN p_promoted
      ELSE (
        SELECT a.id
          FROM article a
          JOIN news_source src ON src.id = a.source_id
         WHERE a.story_id = p_story
           AND news_visible_to(src.same_language_only, src.language, p_locale)
           AND (a.id = p_promoted OR src.dropped_at IS NULL)
         ORDER BY (a.id = p_promoted) DESC, a.fetched_at DESC, a.id
         LIMIT 1)
    END
  $$;

-- Down Migration

DROP FUNCTION story_shown_article(uuid, uuid, text);
DROP FUNCTION news_visible_to(boolean, text, text);
ALTER TABLE news_source DROP COLUMN same_language_only;
