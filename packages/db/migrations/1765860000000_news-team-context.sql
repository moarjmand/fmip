-- Up Migration
-- T-1400 (D-215): a story is filed under a national team only where its
-- headline writes the country as a football team, never under a men's team
-- when it names women, never under the senior side when it names an age
-- group, and a club whose stored name is a shortening of its own name ("Derby"
-- for Derby County) only where the short word cannot be read as a noun.
--
-- Production's English pages on 2026-10-12 still filed, after D-211:
--   * a country named as a place: "Messi buys a club in Spain", "Sevilla
--     manager names Barcelona the best team in Spain", "Real Madrid loanee
--     Mastantuono ... feeling 'very good' in Italy", "New owners want to bring
--     'Northampton DNA to Brazil'", "From U-17 World Cup to Brazil";
--   * women's football under the men's teams: "Spain strike first and beat
--     the United States in Washington" (its summary: "The Spain women's
--     national team"), "Russo named England player of the year" ("England
--     women's player of the year"), "USWNT ... falls to Spain", the WSL and
--     the Women's Champions League under Arsenal, Manchester City, Chelsea,
--     Aston Villa and others (50 of the English stories);
--   * an age group under the senior side: "Spain U21s must not slip up",
--     "Max Dowman given 'harsh' straight red for England u19s v USA";
--   * "Derby" as a word: "Fla-Flu, Derby and Gre-Nal: share your predictions
--     for today's derbies", "In The East Anglia Derby The Table Never
--     Mattered", "Derby weekend and European football feature in the quiz",
--     "Derby defeat 'one that got away' for Pompey" (its summary: Pompey's
--     defeat by Southampton); "Junior boys soccer forward's hat trick" under
--     the Colombian club Junior.
--
-- `news_named_entities` keeps its signature and D-211's rule for every name,
-- and adds, for teams only:
--   1. A men's team only when no version's headline or summary names women
--      (`news_names_women`), and a women's team only when one does. We hold
--      no women's team today; one added later is linked by the same rule.
--   2. Not the senior side where an age group follows the name ("Spain U21s",
--      "England u19s", "Wales Under-23s", "Ex-England youth star").
--   3. A national team needs football-team context at that place
--      (`news_national_context`): a word of a team within three words of the
--      name ("squad", "manager", "World Cup", "friendly", "Nations League",
--      ...), "v"/"vs" with another national team's name on its other side,
--      or a fixture of that team within three days of the article. And never
--      where the name follows a place preposition ("in Spain", "to Brazil",
--      "from England"), unless a team word follows it ("in England squad") or
--      "to" follows a result ("falls to Spain", "lost to Italy").
--   4. A one-word name that the team's own longer name or alias contains
--      ("Derby" in "Derby County") is a shortening (`news_team_written`):
--      where the headline's case says nothing about it -- the headline's first
--      word, or a Title Case headline -- the summary must name the team (the
--      longer name, or the short one capitalised mid-sentence); elsewhere it
--      must not follow another capitalised word ("East Anglia Derby",
--      "Fla-Flu, Derby").
-- `article_entity` carries no trigger (checked again: only `article_version`
-- and `article` of the news tables carry one, and neither is written here),
-- so a link this rule refuses is a plain delete, as in D-211.

-- Whether a text names women's football. Whole words, any case.
CREATE FUNCTION news_names_women(input text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT COALESCE(public.unaccent('public.unaccent', input)
             ~* '(^|[^[:alpha:]])(women|womens|lionesses|wnt|uswnt|nwsl|wsl|uwcl|frauen|girls)([^[:alpha:]]|$)',
           false)
  $$;

COMMENT ON FUNCTION news_names_women(text) IS
  'Whether a headline or summary names women''s football (women, Lionesses, USWNT, WSL, ...): no men''s team is linked from it (T-1400, D-215).';

-- Whether a text is written in Title Case: at least three words of four or
-- more letters, every one capitalised. There case says nothing about a word.
CREATE FUNCTION news_title_case(input text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT COALESCE(count(*) >= 3 AND bool_and(left(w, 1) <> lower(left(w, 1))), false)
      FROM unnest(public.news_written_words(input)) AS t(w)
     WHERE w ~ '^[[:alpha:]]' AND length(w) >= 4
  $$;

-- The places (word positions) where `headline` writes `name` as a name by
-- D-211's rule: whole words, the first capitalised where the headline has
-- case, not inside a longer name of `longer` written at the same place.
CREATE FUNCTION news_name_places(headline text, name text, longer text[]) RETURNS int[]
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
DECLARE
  written text[] := public.news_written_words(headline);
  words text[];
  key text[] := public.news_folded_words(name);
  n int := cardinality(key);
  cased boolean := headline <> lower(headline);
  outer_words text[];
  m int;
  i int;
  s int;
  masked boolean;
  other text;
  places int[] := '{}';
BEGIN
  IF n = 0 OR headline IS NULL THEN
    RETURN places;
  END IF;
  words := ARRAY(SELECT public.search_key(w) FROM unnest(written) WITH ORDINALITY AS t(w, o) ORDER BY o);
  FOR i IN 1 .. cardinality(words) - n + 1 LOOP
    CONTINUE WHEN words[i:i + n - 1] <> key;
    CONTINUE WHEN cased AND left(written[i], 1) <> upper(left(written[i], 1));
    masked := false;
    FOREACH other IN ARRAY COALESCE(longer, '{}') LOOP
      outer_words := public.news_folded_words(other);
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
      places := places || i;
    END IF;
  END LOOP;
  RETURN places;
END
$$;

-- Whether `summary` names the team a shortened name stands for: one of its
-- longer names anywhere, or the short name capitalised in a sentence-case
-- summary, neither its first word nor directly after another capitalised word.
CREATE FUNCTION news_summary_names(summary text, name text, own_longer text[]) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
DECLARE
  written text[] := public.news_written_words(summary);
  other text;
  p int;
BEGIN
  IF summary IS NULL THEN
    RETURN false;
  END IF;
  FOREACH other IN ARRAY COALESCE(own_longer, '{}') LOOP
    IF cardinality(public.news_name_places(summary, other, '{}')) > 0 THEN
      RETURN true;
    END IF;
  END LOOP;
  IF summary = lower(summary) OR public.news_title_case(summary) THEN
    RETURN false;
  END IF;
  FOREACH p IN ARRAY public.news_name_places(summary, name, '{}') LOOP
    IF p > 1 AND left(written[p - 1], 1) = lower(left(written[p - 1], 1)) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END
$$;

-- Whether the words around a national team's name at `i` (n words long) say
-- it is the football team: a team word within three words either side, or
-- "v"/"vs"/"versus" with another national team's name (`nations`, folded
-- keys) on its other side.
CREATE FUNCTION news_national_context(words text[], i int, n int, nations text[]) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
DECLARE
  around text := ' ' || array_to_string(words[greatest(1, i - 3):i - 1], ' ') || ' '
              || array_to_string(words[i + n:i + n + 2], ' ') || ' ';
  team_words text[] := ARRAY[
    'national team', 'national side', 'squad', 'squads', 'manager', 'coach', 'boss',
    'world cup', 'qualifier', 'qualifiers', 'qualifying', 'qualification', 'play off',
    'friendly', 'friendlies', 'nations league', 'euro', 'euros', 'copa america', 'afcon',
    'asian cup', 'gold cup', 'international', 'internationals', 'call up', 'called up',
    'camp', 'xi', 'line up', 'line ups', 'lineup', 'lineups', 'debut', 'caps'];
  vs text[] := ARRAY['v', 'vs', 'versus'];
  after text := ' ' || array_to_string(words[i + n + 1:i + n + 4], ' ') || ' ';
  before text := ' ' || array_to_string(words[greatest(1, i - 5):i - 2], ' ') || ' ';
  word text;
  nation text;
BEGIN
  FOREACH word IN ARRAY team_words LOOP
    IF position(' ' || word || ' ' IN around) > 0 THEN
      RETURN true;
    END IF;
  END LOOP;
  FOREACH nation IN ARRAY COALESCE(nations, '{}') LOOP
    IF COALESCE(words[i + n], '') = ANY (vs) AND left(after, length(nation) + 2) = ' ' || nation || ' ' THEN
      RETURN true;
    END IF;
    IF i > 2 AND words[i - 1] = ANY (vs) AND right(before, length(nation) + 2) = ' ' || nation || ' ' THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END
$$;

-- Whether `headline` writes a team's name as that team (D-211, then 2-4 above).
--   own_longer: the team's other names and aliases that contain `name` as a
--     word and are longer (its full name, for a shortened one);
--   is_national / is_senior: the team's kind and age group;
--   nations: the folded keys of the national teams' names this article writes;
--   fixture_near: whether the team plays within three days of the article.
CREATE FUNCTION news_team_written(
  headline text, summary text, name text, longer text[], own_longer text[],
  is_national boolean, is_senior boolean, nations text[], fixture_near boolean
) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
DECLARE
  written text[] := public.news_written_words(headline);
  words text[];
  n int := cardinality(public.news_folded_words(name));
  cased boolean := headline <> lower(headline);
  title boolean := public.news_title_case(headline);
  shortened boolean := n = 1 AND cardinality(COALESCE(own_longer, '{}')) > 0;
  places_before text[] := ARRAY['in', 'to', 'from', 'across', 'around', 'throughout', 'inside', 'within', 'into'];
  results text[] := ARRAY['lose', 'loses', 'lost', 'losing', 'fall', 'falls', 'fell', 'falling',
                          'slip', 'slips', 'slipped', 'succumb', 'succumbs', 'succumbed', 'defeat', 'defeats', 'defeated'];
  i int;
  after text;
  previous text;
BEGIN
  IF headline IS NULL OR n = 0 THEN
    RETURN false;
  END IF;
  words := ARRAY(SELECT public.search_key(w) FROM unnest(written) WITH ORDINALITY AS t(w, o) ORDER BY o);
  FOREACH i IN ARRAY public.news_name_places(headline, name, longer) LOOP
    after := COALESCE(words[i + n], '');
    previous := COALESCE(words[i - 1], '');
    -- An age group right after the name is the youth side's, not the senior team's.
    CONTINUE WHEN is_senior AND (after ~ '^u[0-9]{2}s?$' OR after = 'youth'
                              OR (after IN ('u', 'under') AND COALESCE(words[i + n + 1], '') ~ '^[0-9]{2}s?$'));
    IF shortened AND cased THEN
      IF title OR i = 1 THEN
        CONTINUE WHEN NOT public.news_summary_names(summary, name, own_longer);
      ELSE
        -- Directly after another capitalised word: a compound or a list of names.
        CONTINUE WHEN left(written[i - 1], 1) <> lower(left(written[i - 1], 1));
      END IF;
    END IF;
    IF is_national THEN
      -- A place: "in Spain", "to Brazil" -- unless a team word follows
      -- ("in England squad") or "to" follows a result ("falls to Spain").
      CONTINUE WHEN previous = ANY (places_before)
        AND NOT (previous = 'to' AND i > 2 AND words[i - 2] = ANY (results))
        AND NOT (after IN ('squad', 'squads', 'camp', 'side', 'team', 'manager', 'coach', 'boss', 'debut', 'shirt'));
      CONTINUE WHEN NOT (public.news_national_context(words, i, n, nations) OR fixture_near);
    END IF;
    RETURN true;
  END LOOP;
  RETURN false;
END
$$;

COMMENT ON FUNCTION news_team_written(text, text, text, text[], text[], boolean, boolean, text[], boolean) IS
  'Whether a headline writes a team''s name as that team: D-211''s rule, then no age group after it, a shortened name not read as a noun, and a national team only with football-team context (T-1400, D-215).';

-- D-211's function with the team conditions above. Competitions are judged
-- exactly as before.
CREATE OR REPLACE FUNCTION news_named_entities(p_article uuid, p_minimum int, p_from_links boolean)
  RETURNS TABLE (entity_type text, entity_id uuid)
  LANGUAGE sql STABLE
  AS $$
    WITH version AS (
      SELECT v.headline, v.summary, ' ' || news_text_key(v.headline) || ' ' AS text
        FROM article_version v
       WHERE v.article_id = p_article
    ),
    moment AS (
      SELECT COALESCE((SELECT min(v.published_at) FROM article_version v WHERE v.article_id = p_article),
                      (SELECT a.fetched_at FROM article a WHERE a.id = p_article)) AS at
    ),
    women AS (
      SELECT COALESCE(bool_or(news_names_women(v.headline) OR news_names_women(v.summary)), false) AS named
        FROM version v
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
    ),
    nations AS (
      SELECT COALESCE(array_agg(DISTINCT hit.key), '{}') AS keys
        FROM hit JOIN team t ON hit.entity_type = 'team' AND t.id = hit.entity_id
       WHERE t.kind = 'national'
    ),
    judged AS (
      SELECT hit.entity_type, hit.entity_id, hit.label, hit.key, t.id AS team_id, t.kind, t.gender,
             t.age_group
        FROM hit
        LEFT JOIN team t ON hit.entity_type = 'team' AND t.id = hit.entity_id
    )
    SELECT DISTINCT j.entity_type, j.entity_id
      FROM judged j, longer, moment, women, nations
     WHERE CASE
             WHEN j.team_id IS NULL THEN
               EXISTS (SELECT 1 FROM version h WHERE news_name_written(h.headline, j.label, longer.names))
             ELSE
               (j.gender = 'women') = women.named
               AND EXISTS (
                 SELECT 1 FROM version h
                  WHERE news_team_written(
                          h.headline, h.summary, j.label, longer.names,
                          (SELECT COALESCE(array_agg(o.label), '{}')
                             FROM (SELECT t2.name AS label FROM team t2 WHERE t2.id = j.team_id
                                   UNION
                                   SELECT a2.alias FROM entity_alias a2
                                    WHERE a2.entity_type = 'team' AND a2.entity_id = j.team_id) o
                            WHERE news_text_key(o.label) <> j.key
                              AND position(' ' || j.key || ' ' IN ' ' || news_text_key(o.label) || ' ') > 0),
                          j.kind = 'national', j.age_group = 'senior', nations.keys,
                          j.kind = 'national' AND EXISTS (
                            SELECT 1 FROM fixture_participant p JOIN fixture f ON f.id = p.fixture_id
                             WHERE p.team_id = j.team_id
                               AND f.kickoff_at BETWEEN moment.at - interval '3 days'
                                                    AND moment.at + interval '3 days')))
           END
  $$;

COMMENT ON FUNCTION news_named_entities(uuid, int, boolean) IS
  'The teams and competitions an article''s headlines write as names, by id (T-142, T-1396, D-211), teams by news_team_written (T-1400, D-215). from_links: only re-check the entities already linked.';

-- The team links already stored, checked by the same rule (5 is the linker's
-- MINIMUM_NAME_LENGTH). Competition links are unchanged by this rule.
DELETE FROM article_entity e
 WHERE e.entity_type = 'team'
   AND NOT EXISTS (
         SELECT 1 FROM news_named_entities(e.article_id, 5, true) k
          WHERE k.entity_type = e.entity_type AND k.entity_id = e.entity_id);

-- A match link stands on both of its sides being linked (D-211).
DELETE FROM article_entity e
 WHERE e.entity_type = 'fixture'
   AND (SELECT count(*)
          FROM fixture_participant p
          JOIN article_entity t
            ON t.article_id = e.article_id AND t.entity_type = 'team' AND t.entity_id = p.team_id
         WHERE p.fixture_id = e.entity_id) < 2;

-- Down Migration

-- The links removed above are not restored: they were wrong. D-211's function
-- comes back as it was.
CREATE OR REPLACE FUNCTION news_named_entities(p_article uuid, p_minimum int, p_from_links boolean)
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
DROP FUNCTION news_team_written(text, text, text, text[], text[], boolean, boolean, text[], boolean);
DROP FUNCTION news_national_context(text[], int, int, text[]);
DROP FUNCTION news_summary_names(text, text, text[]);
DROP FUNCTION news_name_places(text, text, text[]);
DROP FUNCTION news_title_case(text);
DROP FUNCTION news_names_women(text);
