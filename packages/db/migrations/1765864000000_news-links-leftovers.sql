-- Up Migration
-- T-1411 (D-217): the news links D-215 (migration 1765860000000) reported as
-- not handled.
--
--   1. "Jordan Pickford defiant amid threat to England No 1 spot" lost
--      England: "to England" read as a place. A shirt number after a national
--      team's name ("England No 1", "England's No 1", "France number one") is
--      the team's, and so are its captain and goalkeeper ("France captain").
--      `news_shirt_number`, and `news_national_context` with those words.
--   2. "Spain win in Croatia" lost Croatia, the opponent and host. Where the
--      shape is "<nation> win/beat/lose/draw in <nation>" and the two national
--      teams meet within three days, the second is the team; where they do not
--      meet, it stays a place. `news_team_written` gains the names of the
--      national teams the team meets within three days (`opponents`).
--   3. A transfer story naming two clubs that meet within two days was filed
--      under the match. A match link now needs the article's words to be
--      about a match (`news_match_context`, `news_about_match`): "v"/"vs", a
--      scoreline, team news, line-ups, kick-off, highlights anywhere; or a
--      match's word ("against", "clash", "preview", "report", "win", "beat",
--      "draw", ...) in a headline without a transfer's word ("sign", "bid",
--      "fee", "loan", "deal", "move to", "target", "transfer", "swap",
--      "contract", ...), or in a summary where neither has one. In English,
--      German, Persian and Portuguese, the languages the stored match links
--      are in. The team links stay.
--
-- Everything is recomputed from stored rows: the team links already stored
-- are re-checked by the new function (it only widens D-215's rule, so this
-- removes nothing D-215 kept), then the match links that lose a side or whose
-- article is not about a match are removed. `article_entity` carries no
-- trigger (D-215), so a refused link is a plain delete.

-- Whether words[k] starts a shirt number: "No 1", "No.9", "No1", "number one".
CREATE FUNCTION news_shirt_number(words text[], k int) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT COALESCE(
             words[k] ~ '^no[0-9]{1,2}$'
             OR (words[k] IN ('no', 'number')
                 AND words[k + 1] ~ '^([0-9]{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven)$'),
             false)
  $$;

COMMENT ON FUNCTION news_shirt_number(text[], int) IS
  'Whether the folded words at k are a shirt number ("No 1", "number one"): after a national team''s name, the football team''s (T-1411, D-217).';

-- D-215's function, with a captain's and a goalkeeper's words and a shirt
-- number right after the name ("England No 1", "England's No 1"). Only after:
-- "No. 2 Georgia vs. No. 6 Alabama" ranks colleges.
CREATE OR REPLACE FUNCTION news_national_context(words text[], i int, n int, nations text[]) RETURNS boolean
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
  -- Only directly after the name (or its possessive): "England captain",
  -- "Germany keeper", "first England cap" -- never "Everton goalkeeper
  -- Jordan Pickford".
  role_after text[] := ARRAY['captain', 'captaincy', 'skipper', 'goalkeeper', 'keeper', 'shirt', 'cap'];
  vs text[] := ARRAY['v', 'vs', 'versus'];
  after text := ' ' || array_to_string(words[i + n + 1:i + n + 4], ' ') || ' ';
  before text := ' ' || array_to_string(words[greatest(1, i - 5):i - 2], ' ') || ' ';
  k int := CASE WHEN COALESCE(words[i + n], '') = 's' THEN i + n + 1 ELSE i + n END;
  word text;
  nation text;
BEGIN
  FOREACH word IN ARRAY team_words LOOP
    IF position(' ' || word || ' ' IN around) > 0 THEN
      RETURN true;
    END IF;
  END LOOP;
  IF public.news_shirt_number(words, k) OR COALESCE(words[k], '') = ANY (role_after) THEN
    RETURN true;
  END IF;
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

-- D-215's `news_team_written` with `opponents`: the folded names and aliases
-- of the national teams this team meets within three days of the article.
-- After a place preposition the name is also the team where a shirt number
-- follows it ("threat to England No 1 spot"), and where the headline reads
-- "<opponent> win/beat/lose/draw in <name>" (the opponent and host). The
-- nine-argument form stays for the down migration and is no longer called.
CREATE FUNCTION news_team_written(
  headline text, summary text, name text, longer text[], own_longer text[],
  is_national boolean, is_senior boolean, nations text[], fixture_near boolean, opponents text[]
) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
DECLARE
  written text[] := public.news_written_words(headline);
  words text[];
  gaps text[] := regexp_split_to_array(
                   regexp_replace(public.unaccent('public.unaccent', headline), E'[ـً-ْٰ]', '', 'g'),
                   '[[:alnum:]]+');
  n int := cardinality(public.news_folded_words(name));
  cased boolean := headline <> lower(headline);
  title boolean := public.news_title_case(headline);
  shortened boolean := n = 1 AND cardinality(COALESCE(own_longer, '{}')) > 0;
  places_before text[] := ARRAY['in', 'to', 'from', 'across', 'around', 'throughout', 'within', 'into'];
  to_team text[] := ARRAY['lose', 'loses', 'lost', 'losing', 'fall', 'falls', 'fell', 'falling',
                          'slip', 'slips', 'slipped', 'succumb', 'succumbs', 'succumbed',
                          'farewell', 'goodbye', 'allegiance', 'switch', 'switches', 'switched',
                          'commit', 'commits', 'committed', 'pledge', 'pledges', 'pledged'];
  from_team text[] := ARRAY['retire', 'retires', 'retired', 'retiring', 'retirement',
                            'withdraw', 'withdraws', 'withdrew', 'withdrawn', 'dropped', 'axed',
                            'omitted', 'released', 'exit', 'exits', 'banned', 'suspended', 'calls'];
  team_after text[] := ARRAY['squad', 'squads', 'camp', 'side', 'team', 'national', 'international',
                             'duty', 'manager', 'coach', 'boss', 'captain', 'debut', 'shirt', 'spot',
                             'call', 'win', 'wins', 'victory', 'defeat', 'draw', 'loss', 'drubbing',
                             'thrashing', 'rout', 'game', 'match', 'clash', 'tie', 'fixture', 'career',
                             'captaincy', 'skipper', 'goalkeeper', 'keeper', 'cap'];
  -- "Spain win in Croatia", "Spain's victory in Croatia": a result away.
  result_in text[] := ARRAY['win', 'wins', 'won', 'beat', 'beats', 'lose', 'loses', 'lost',
                            'draw', 'draws', 'drew', 'held', 'victory', 'defeat', 'triumph', 'triumphs'];
  i int;
  k int;
  head text;
  opponent text;
  hosted boolean;
  after text;
  previous text;
  before_previous text;
BEGIN
  IF headline IS NULL OR n = 0 THEN
    RETURN false;
  END IF;
  words := ARRAY(SELECT public.search_key(w) FROM unnest(written) WITH ORDINALITY AS t(w, o) ORDER BY o);
  FOREACH i IN ARRAY public.news_name_places(headline, name, longer) LOOP
    after := COALESCE(words[i + n], '');
    previous := COALESCE(words[i - 1], '');
    before_previous := COALESCE(words[i - 2], '');
    CONTINUE WHEN is_senior AND (after ~ '^u[0-9]{2}s?$' OR after = 'youth'
                              OR (after IN ('u', 'under') AND COALESCE(words[i + n + 1], '') ~ '^[0-9]{2}s?$'));
    IF shortened AND cased THEN
      IF title OR i = 1 THEN
        CONTINUE WHEN NOT public.news_summary_names(summary, name, own_longer);
      ELSE
        CONTINUE WHEN left(written[i - 1], 1) <> lower(left(written[i - 1], 1));
      END IF;
    END IF;
    IF is_national THEN
      -- The opponent and host: the words before the verb end with the name
      -- of a national team this one meets within three days.
      hosted := false;
      IF previous = 'in' AND before_previous = ANY (result_in) THEN
        k := i - 3;
        IF COALESCE(words[k], '') = 's' THEN
          k := k - 1;
        END IF;
        IF k >= 1 THEN
          head := ' ' || array_to_string(words[1:k], ' ') || ' ';
          FOREACH opponent IN ARRAY COALESCE(opponents, '{}') LOOP
            IF right(head, length(opponent) + 2) = ' ' || opponent || ' ' THEN
              hosted := true;
              EXIT;
            END IF;
          END LOOP;
        END IF;
      END IF;
      CONTINUE WHEN previous = ANY (places_before)
        AND COALESCE(gaps[i], ' ') !~ '[:;|.!?–—]'
        AND after <> 's' AND COALESCE(gaps[i + n], '') !~ '^[''’]'
        AND NOT (after = ANY (team_after))
        AND NOT public.news_shirt_number(words, i + n)
        AND NOT (previous = 'to' AND before_previous = ANY (to_team))
        AND NOT (previous = 'from' AND before_previous = ANY (from_team))
        AND NOT hosted;
      CONTINUE WHEN NOT (public.news_national_context(words, i, n, nations) OR fixture_near);
    END IF;
    RETURN true;
  END LOOP;
  RETURN false;
END
$$;

COMMENT ON FUNCTION news_team_written(text, text, text, text[], text[], boolean, boolean, text[], boolean, text[]) IS
  'Whether a headline writes a team''s name as that team: D-215''s rule, and after a place preposition a shirt number or "<opponent> win in <name>" against a national team met within three days (T-1411, D-217).';

-- Whether a headline and its summary are about a match (T-1411, D-217).
--   * Anywhere: "v"/"vs"/"versus", a scoreline ("2-1", "2:1"), team news,
--     line-ups, kick-off, half/full time, highlights, a match report.
--   * A match's word in the headline when the headline has no transfer's
--     word, or in the summary when neither has one.
-- Words are compared folded (`news_text_key`) and whole, so the lists below
-- can be written as a reader writes them.
CREATE FUNCTION news_match_context(headline text, summary text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
DECLARE
  -- A "new signing" is a player already signed: "Why new Juventus signing Neto
  -- will miss Cagliari game".
  h text := regexp_replace(' ' || COALESCE(public.news_text_key(headline), '') || ' ',
                           ' new ((\S+ ){0,2})signing ', ' new \1player ', 'g');
  s text := regexp_replace(' ' || COALESCE(public.news_text_key(summary), '') || ' ',
                           ' new ((\S+ ){0,2})signing ', ' new \1player ', 'g');
  scoreline text := '(^|[^0-9])[0-9]{1,2} ?[-–:] ?[0-9]{1,2}([^0-9]|$)';
  strong text[] := ARRAY[
    'v', 'vs', 'versus', 'team news', 'line up', 'line ups', 'lineup', 'lineups',
    'starting xi', 'confirmed xi', 'predicted xi', 'kick off', 'kickoff', 'half time', 'full time',
    'highlights', 'match report', 'as it happened',
    'aufstellung', 'anpfiff', 'vorbericht', 'halbzeit',
    'ترکیب', 'escalacao'];
  match_words text[] := ARRAY[
    'against', 'clash', 'clashes', 'match', 'matches', 'game', 'games', 'derby', 'fixture', 'tie',
    'face', 'faces', 'facing', 'host', 'hosts', 'hosting', 'visit', 'visits', 'trip', 'meet', 'meets',
    'showdown', 'encounter', 'preview', 'report', 'prediction', 'predictions', 'predicted', 'odds',
    'result', 'results', 'score', 'scores', 'scored', 'scorer', 'goal', 'goals', 'win', 'wins', 'won',
    'beat', 'beats', 'beaten', 'lose', 'loses', 'lost', 'draw', 'draws', 'drew', 'defeat', 'defeats',
    'defeated', 'victory', 'thrash', 'thrashing', 'thrashed', 'rout', 'routed', 'edge', 'edges', 'edged',
    'stun', 'stuns', 'stunned', 'hold', 'holds', 'held', 'equaliser', 'equalizer', 'winner', 'comeback',
    'live', 'talking points', 'player ratings', 'ratings', 'stats', 'sink', 'sinks', 'sank',
    'overcome', 'overcomes', 'blow away', 'past', 'reunion', 'debut', 'xis', 'sent off', 'red card',
    'penalty', 'var', 'referee',
    'gegen', 'spiel', 'spiele', 'duell', 'sieg', 'siegt', 'gewinnt', 'gewonnen', 'niederlage',
    'verliert', 'verloren', 'remis', 'unentschieden', 'schlägt', 'geschlagen', 'empfängt', 'gastiert',
    'trifft', 'auswärts', 'heimspiel', 'tor', 'tore', 'ergebnis', 'unterliegt', 'besiegt',
    'مقابل', 'برابر', 'دیدار', 'بازی', 'شکست', 'پیروزی', 'تساوی', 'مساوی', 'برد', 'باخت', 'گل',
    'نتیجه', 'دربی', 'شهرآورد', 'میزبان', 'میهمان', 'مهمان', 'ببازیم', 'ببازد', 'ببرد', 'ببریم',
    'بردیم', 'باختیم', 'تقابل', 'نبرد', 'جدال', 'رویارویی', 'لیگ',
    'contra', 'x', 'jogo', 'partida', 'clássico', 'vence', 'venceu', 'vitória', 'derrota', 'empate',
    'empata', 'placar'];
  transfer_words text[] := ARRAY[
    'sign', 'signs', 'signed', 'signing', 'signings', 'fee', 'fees', 'loan', 'loans',
    'loaned', 'deal', 'deals', 'target', 'targets', 'transfer', 'transfers', 'swap',
    'contract', 'contracts', 'in talks', 'talks with', 'talks over', 'advanced talks', 'undergo medical', 'undergoes medical', 'undergoing medical',
    'complete medical', 'completes medical', 'pass medical', 'passes medical', 'release clause', 'swoop', 'hijack', 'pursuit',
    'personal terms', 'extension',
    'wechsel', 'wechselt', 'vertrag', 'leihe', 'ausgeliehen', 'ablöse', 'ablösesumme', 'verpflichtet',
    'verpflichtung', 'angebot', 'transferziel',
    'انتقال', 'قرارداد', 'جذب', 'خرید', 'پیشنهاد', 'قرضی', 'جدایی', 'مذاکره', 'ترانسفر', 'تمدید',
    'contratação', 'contrata', 'contratar', 'transferência', 'proposta', 'empréstimo', 'negociação',
    'reforço'];
  -- "move to", "move for": a transfer; "move top", "move clear": a table. "A
  -- bid for": a transfer; "in bid to return to winning ways": not one. ("Flick
  -- talks Raphinha" is a press conference: "talks" counts only as "in talks".)
  move_to text := ' (moves? (?!(top|up|clear|level|within|into|above|off|second|third|fourth|ahead|on|back|closer) )|bids? (?!to ))';
  word text;
  strong_hit boolean := COALESCE(headline, '') ~ scoreline OR COALESCE(summary, '') ~ scoreline;
  h_match boolean := false;
  s_match boolean := false;
  h_transfer boolean := h ~ move_to;
  s_transfer boolean := s ~ move_to;
  key text;
BEGIN
  FOREACH word IN ARRAY strong LOOP
    EXIT WHEN strong_hit;
    key := ' ' || public.news_text_key(word) || ' ';
    strong_hit := position(key IN h) > 0 OR position(key IN s) > 0;
  END LOOP;
  IF strong_hit THEN
    RETURN true;
  END IF;
  FOREACH word IN ARRAY transfer_words LOOP
    key := ' ' || public.news_text_key(word) || ' ';
    h_transfer := h_transfer OR position(key IN h) > 0;
    s_transfer := s_transfer OR position(key IN s) > 0;
  END LOOP;
  IF h_transfer THEN
    RETURN false;
  END IF;
  FOREACH word IN ARRAY match_words LOOP
    key := ' ' || public.news_text_key(word) || ' ';
    h_match := h_match OR position(key IN h) > 0;
    s_match := s_match OR position(key IN s) > 0;
  END LOOP;
  RETURN h_match OR (s_match AND NOT s_transfer);
END
$$;

COMMENT ON FUNCTION news_match_context(text, text) IS
  'Whether a headline and summary are about a match: "v", a scoreline, team news anywhere, or a match''s word where no transfer''s word is (T-1411, D-217).';

-- Whether any version of an article is about a match: a match link needs it.
CREATE FUNCTION news_about_match(p_article uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (SELECT 1 FROM article_version v
                    WHERE v.article_id = p_article AND news_match_context(v.headline, v.summary))
  $$;

COMMENT ON FUNCTION news_about_match(uuid) IS
  'Whether any version''s headline and summary are about a match (news_match_context): the linker files an article under a match only then (T-1411, D-217).';

-- D-215's function, passing each national team's opponents within three days.
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
      SELECT hit.entity_type, hit.entity_id, hit.label, hit.key, t.id AS team_id, t.name AS team_name,
             t.kind, t.gender, t.age_group
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
                            WHERE j.key = news_text_key(j.team_name) AND news_text_key(o.label) <> j.key
                              AND position(' ' || j.key || ' ' IN ' ' || news_text_key(o.label) || ' ') > 0),
                          j.kind = 'national', j.age_group = 'senior', nations.keys,
                          j.kind = 'national' AND EXISTS (
                            SELECT 1 FROM fixture_participant p JOIN fixture f ON f.id = p.fixture_id
                             WHERE p.team_id = j.team_id
                               AND f.kickoff_at BETWEEN moment.at - interval '3 days'
                                                    AND moment.at + interval '3 days'),
                          CASE WHEN j.kind = 'national' THEN (
                            SELECT COALESCE(array_agg(DISTINCT news_text_key(o.label)), '{}')
                              FROM fixture_participant p
                              JOIN fixture f ON f.id = p.fixture_id
                              JOIN fixture_participant q ON q.fixture_id = f.id AND q.team_id <> p.team_id
                              JOIN team t3 ON t3.id = q.team_id AND t3.kind = 'national' AND t3.gender = j.gender
                              CROSS JOIN LATERAL (
                                SELECT t3.name AS label
                                UNION ALL
                                SELECT a3.alias FROM entity_alias a3
                                 WHERE a3.entity_type = 'team' AND a3.entity_id = t3.id
                              ) o
                             WHERE p.team_id = j.team_id
                               AND f.kickoff_at BETWEEN moment.at - interval '3 days'
                                                    AND moment.at + interval '3 days')
                          ELSE '{}'::text[] END))
           END
  $$;

COMMENT ON FUNCTION news_named_entities(uuid, int, boolean) IS
  'The teams and competitions an article''s headlines write as names, by id (T-142, T-1396, D-211), teams by news_team_written (T-1400, D-215; T-1411, D-217). from_links: only re-check the entities already linked.';

-- The team links already stored, checked by the same rule (5 is the linker's
-- MINIMUM_NAME_LENGTH), exactly as migration 1765860000000 did.
DELETE FROM article_entity e
 WHERE e.entity_type = 'team'
   AND NOT EXISTS (
         SELECT 1 FROM news_named_entities(e.article_id, 5, true) k
          WHERE k.entity_type = e.entity_type AND k.entity_id = e.entity_id);

-- A match link stands on both of its sides being linked (D-211) and on the
-- article being about a match (this decision).
DELETE FROM article_entity e
 WHERE e.entity_type = 'fixture'
   AND ((SELECT count(*)
           FROM fixture_participant p
           JOIN article_entity t
             ON t.article_id = e.article_id AND t.entity_type = 'team' AND t.entity_id = p.team_id
          WHERE p.fixture_id = e.entity_id) < 2
        OR NOT news_about_match(e.article_id));

-- Down Migration

-- The links removed above are not restored: they were wrong. D-215's
-- functions come back as migration 1765860000000 left them.
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
      SELECT hit.entity_type, hit.entity_id, hit.label, hit.key, t.id AS team_id, t.name AS team_name,
             t.kind, t.gender, t.age_group
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
                            WHERE j.key = news_text_key(j.team_name) AND news_text_key(o.label) <> j.key
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

CREATE OR REPLACE FUNCTION news_national_context(words text[], i int, n int, nations text[]) RETURNS boolean
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

DROP FUNCTION news_about_match(uuid);
DROP FUNCTION news_match_context(text, text);
DROP FUNCTION news_team_written(text, text, text, text[], text[], boolean, boolean, text[], boolean, text[]);
DROP FUNCTION news_shirt_number(text[], int);
