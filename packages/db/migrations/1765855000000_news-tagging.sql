-- Up Migration
-- T-1396 (D-211): a story is filed under a team or competition only where its
-- headline writes that name as a name, and a report the site already carries
-- is shown once.
--
-- A read-only audit of production's /en pages on 2026-10-12 found stories
-- filed under clubs they are not about, because a name was matched as a word
-- wherever it occurred:
--   * the common noun: "Grêmio and Internacional line-ups for the
--     relegation-battle derby", "Ten-man Southampton beat Portsmouth in heated
--     derby" (and four more) under Derby County, whose stored name is "Derby";
--     "Public League championship", "the Big Ten championship picture" under
--     the Championship;
--   * the name inside a longer name: "Inter Miami's Lionel Messi nets twice"
--     under Inter as well as Inter Miami; "United's struggles deepen at Old
--     Trafford" under Trafford; "What punishment could Vinicius Junior face"
--     under Junior; "miss Europa League clash" under Europa.
-- The linker (`PostgresNewsStore.linkEntities`) now asks `news_named_entities`
-- below, and this migration applies the same function to the links already
-- stored. `article_entity` carries no trigger (it is not one of the
-- `refuse_change_unless_article_gone` tables), so removing a link is a plain
-- delete; the article, its versions and its story are untouched.

-- The words of a text as it is written: accents removed, case kept, split
-- where `search_key` and the linker's KEY split (every run of non-letters),
-- with the Arabic tatweel and harakat removed first as `search_key` removes
-- them, so the n-th word here is the n-th word of KEY(text).
CREATE FUNCTION news_written_words(input text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$
    SELECT COALESCE(array_agg(w ORDER BY n), '{}')
      FROM regexp_split_to_table(
             regexp_replace(public.unaccent('public.unaccent', input), E'[ـً-ْٰ]', '', 'g'),
             '[^[:alnum:]]+') WITH ORDINALITY AS t(w, n)
     WHERE w <> ''
  $$;

COMMENT ON FUNCTION news_written_words(text) IS
  'A text''s words as written (accents removed, case kept), aligned with the words of its search key (T-1396, D-211).';

-- The same words folded as `search_key` folds them.
CREATE FUNCTION news_folded_words(input text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT COALESCE(array_agg(public.search_key(w) ORDER BY n), '{}')
          FROM unnest(public.news_written_words(input)) WITH ORDINALITY AS t(w, n) $$;

-- The folded, whole-word key of a text: the linker's KEY, as a function, so
-- an index can be built on it and the read side can compare headlines.
CREATE FUNCTION news_text_key(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT btrim(regexp_replace(public.search_key(input), '[^[:alnum:]]+', ' ', 'g')) $$;

COMMENT ON FUNCTION news_text_key(text) IS
  'Folded whole-word form of a headline or name (search_key, every run of non-letters one space): what news linking and deduplication compare (T-142, T-1396).';

-- Whether `name` is written in `headline` as a name (D-211):
--   * its words, whole and in order, are in the headline;
--   * the first of them starts with a capital, unless the headline has no
--     capital letter at all (a script without case, or a headline written in
--     lower case, which says nothing either way) -- "derby" in a sentence is
--     the noun, "Derby" may be the club. Only the first: a name's later words
--     may be particles ("Atlético de Madrid", "Inter Club d'Escaldes");
--   * and that place is not inside a longer name in `longer` also written
--     there -- "Inter" inside "Inter Miami", "Trafford" inside "Old Trafford",
--     "Junior" inside "Vinicius Junior".
-- One place that passes is enough.
CREATE FUNCTION news_name_written(headline text, name text, longer text[]) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
DECLARE
  written text[] := public.news_written_words(headline);
  words text[];
  key text[] := news_folded_words(name);
  n int := cardinality(key);
  cased boolean := headline <> lower(headline);
  outer_words text[];
  m int;
  i int;
  s int;
  masked boolean;
  other text;
BEGIN
  IF n = 0 OR headline IS NULL THEN
    RETURN false;
  END IF;
  words := ARRAY(SELECT public.search_key(w) FROM unnest(written) WITH ORDINALITY AS t(w, o) ORDER BY o);
  FOR i IN 1 .. cardinality(words) - n + 1 LOOP
    CONTINUE WHEN words[i:i + n - 1] <> key;
    CONTINUE WHEN cased AND left(written[i], 1) <> upper(left(written[i], 1));
    masked := false;
    FOREACH other IN ARRAY COALESCE(longer, '{}') LOOP
      outer_words := news_folded_words(other);
      m := cardinality(outer_words);
      CONTINUE WHEN m <= n;
      FOR s IN greatest(1, i + n - m) .. i LOOP
        IF s + m - 1 <= cardinality(words) AND words[s:s + m - 1] = outer_words THEN
          masked := true;
          EXIT;
        END IF;
      END LOOP;
      EXIT WHEN masked;
    END LOOP;
    IF NOT masked THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END
$$;

COMMENT ON FUNCTION news_name_written(text, text, text[]) IS
  'Whether a headline writes a name as a name: whole words, the first capitalised where the headline has case, not inside a longer catalogued name written at the same place (T-1396, D-211).';

-- The teams and competitions an article's headlines name (D-211), by id
-- (rule 1). A name or alias of at least `minimum` folded letters that one of
-- the article's headlines writes as a name (`news_name_written`), the longer
-- names being every other team or competition name or alias, venue name and
-- person name containing it that a headline also carries. With `from_links`
-- the candidates are only the entities already linked to the article -- what
-- this migration checks -- instead of the whole catalogue, which is what a
-- newly read report is matched against.
CREATE FUNCTION news_named_entities(p_article uuid, p_minimum int, p_from_links boolean)
  RETURNS TABLE (entity_type text, entity_id uuid)
  LANGUAGE sql STABLE
  AS $$
    WITH version AS (
      SELECT v.headline, ' ' || news_text_key(v.headline) || ' ' AS text
        FROM article_version v
       WHERE v.article_id = p_article
    ),
    named AS (
      SELECT 'team'::text AS entity_type, t.id AS entity_id, t.name AS label FROM team t
       WHERE NOT p_from_links
      UNION ALL
      SELECT 'competition', c.id, c.name FROM competition c
       WHERE NOT p_from_links
      UNION ALL
      SELECT a.entity_type, a.entity_id, a.alias FROM entity_alias a
       WHERE NOT p_from_links AND a.entity_type IN ('team', 'competition')
      UNION ALL
      SELECT e.entity_type, e.entity_id, COALESCE(t.name, c.name)
        FROM article_entity e
        LEFT JOIN team t ON e.entity_type = 'team' AND t.id = e.entity_id
        LEFT JOIN competition c ON e.entity_type = 'competition' AND c.id = e.entity_id
       WHERE p_from_links AND e.article_id = p_article AND e.entity_type IN ('team', 'competition')
      UNION ALL
      SELECT a.entity_type, a.entity_id, a.alias
        FROM article_entity e
        JOIN entity_alias a ON a.entity_type = e.entity_type AND a.entity_id = e.entity_id
       WHERE p_from_links AND e.article_id = p_article AND e.entity_type IN ('team', 'competition')
    ),
    keyed AS (
      SELECT n.entity_type, n.entity_id, n.label, news_text_key(n.label) AS key
        FROM named n
       WHERE n.label IS NOT NULL
    ),
    hit AS (
      SELECT DISTINCT k.entity_type, k.entity_id, k.label, k.key
        FROM keyed k
       WHERE length(k.key) >= p_minimum
         AND EXISTS (SELECT 1 FROM version h WHERE position(' ' || k.key || ' ' IN h.text) > 0)
    ),
    -- Candidates for a longer name, narrowed by the trigram indexes on the
    -- search keys (any punctuation between the words); whether one is
    -- really written in a headline is decided below, by its whole words.
    patterned AS (
      SELECT DISTINCT hit.key, '%' || replace(hit.key, ' ', '%') || '%' AS pattern FROM hit
    ),
    containing AS (
      SELECT x.label
        FROM patterned hit
        JOIN LATERAL (
          SELECT t.name AS label FROM team t WHERE search_key(t.name) LIKE hit.pattern
          UNION ALL
          SELECT c.name FROM competition c WHERE search_key(c.name) LIKE hit.pattern
          UNION ALL
          SELECT a.alias FROM entity_alias a
           WHERE a.entity_type IN ('team', 'competition') AND search_key(a.alias) LIKE hit.pattern
          UNION ALL
          SELECT v.name FROM venue v WHERE search_key(v.name) LIKE hit.pattern
          UNION ALL
          SELECT p.full_name FROM person p WHERE search_key(p.full_name) LIKE hit.pattern
          UNION ALL
          SELECT p.known_as FROM person p
           WHERE p.known_as IS NOT NULL AND search_key(p.known_as) LIKE hit.pattern
        ) x ON TRUE
    ),
    longer AS (
      SELECT COALESCE(array_agg(DISTINCT c.label), '{}') AS names
        FROM containing c
       WHERE EXISTS (SELECT 1 FROM version h
                      WHERE position(' ' || news_text_key(c.label) || ' ' IN h.text) > 0)
    )
    SELECT DISTINCT hit.entity_type, hit.entity_id
      FROM hit, longer
     WHERE EXISTS (SELECT 1 FROM version h WHERE news_name_written(h.headline, hit.label, longer.names))
  $$;

COMMENT ON FUNCTION news_named_entities(uuid, int, boolean) IS
  'The teams and competitions an article''s headlines write as names, by id (T-142, T-1396, D-211). from_links: only re-check the entities already linked.';

-- The read side compares headlines by their key (D-211): one story's report
-- that another story already carries is listed once.
CREATE INDEX article_version_headline_key_idx ON article_version (news_text_key(headline));

-- "Europa League", "Conference League" and "Champions League" as written in
-- English headlines: the competitions' stored names begin with "UEFA", so a
-- headline naming the Europa League matched only the Gibraltar club Europa.
-- By the provider's league id (rule 1), as T-1395's names are; a database
-- without these competitions inserts nothing.
WITH names(external_id, alias) AS (
  VALUES ('2', 'Champions League'), ('3', 'Europa League'), ('848', 'Conference League')
)
INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
SELECT 'competition', c.id, n.alias, 'en', 'alias', 'd211'
  FROM names n
  JOIN provider_mapping m
    ON m.provider = 'api_football' AND m.entity_type = 'competition' AND m.external_id = n.external_id
  JOIN competition c ON c.id = m.internal_id
 WHERE news_text_key(c.name) <> news_text_key(n.alias)
ON CONFLICT DO NOTHING;

-- The links already stored, checked by the same rule. 5 is the linker's
-- MINIMUM_NAME_LENGTH (news-clustering.service.ts).
DELETE FROM article_entity e
 WHERE e.entity_type IN ('team', 'competition')
   AND NOT EXISTS (
         SELECT 1 FROM news_named_entities(e.article_id, 5, true) k
          WHERE k.entity_type = e.entity_type AND k.entity_id = e.entity_id);

-- A match link stands on both of its sides being linked; one whose side went
-- above goes with it.
DELETE FROM article_entity e
 WHERE e.entity_type = 'fixture'
   AND (SELECT count(*)
          FROM fixture_participant p
          JOIN article_entity t
            ON t.article_id = e.article_id AND t.entity_type = 'team' AND t.entity_id = p.team_id
         WHERE p.fixture_id = e.entity_id) < 2;

-- Down Migration

-- The links removed above are not restored: they were wrong.
DELETE FROM entity_alias WHERE source = 'd211' AND entity_type = 'competition';
DROP INDEX article_version_headline_key_idx;
DROP FUNCTION news_named_entities(uuid, int, boolean);
DROP FUNCTION news_name_written(text, text, text[]);
DROP FUNCTION news_text_key(text);
DROP FUNCTION news_folded_words(text);
DROP FUNCTION news_written_words(text);
