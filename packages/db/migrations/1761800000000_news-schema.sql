-- Up Migration
-- T-141: the article schema (blueprint 3.3, 13.1), built against what a source
-- actually grants (D-061).
--
-- Four things this schema is shaped by, and the shape is where they live:
--
-- **Rights live on the source, and every article row obeys them.** A
-- `news_source` says what may be shown -- the headline only, the publisher's
-- summary, or the full text -- and a version that carries more than its source
-- grants is refused by the database (PL016), not by a renderer remembering to
-- check. Today every source is a free feed and the answer is `headline` or
-- `summary`; a licensed wire arrives as a rights row and an adapter, and this
-- constraint is the reason that is not a rewrite.
--
-- **An article links to its football by UUID, never by name (rule 1).**
-- `article_entity` is (article, entity_type, entity_id) and nothing else; the
-- name is the entity's to show. There is no `team_name` column anywhere here.
--
-- **One canonical article, a version per language (13.1).** `article` is the
-- identity: which source, which story, which original. `article_version` is
-- what is shown, one per language, immutable, and a change is a new version --
-- the same rule the founder's analysis keeps (T-130), so "last updated" is a
-- fact about the newest version and "what did it say before" always has an
-- answer. No translation of a publisher's words (D-061): a feed item has one
-- version, in the language the publisher wrote it.
--
-- **Duplicate reports become one story.** `story` is the cluster's identity;
-- T-142 promotes an original into `promoted_article_id`. It exists now so that
-- an article belongs to a story from its first row rather than being grouped
-- later by a job that has to guess.
--
-- Nothing here is on the critical path (rule 9): a source that goes away takes
-- its own articles with it and nothing else, which the cascades say exactly.

-- ---------------------------------------------------------------------------
-- news_source
-- ---------------------------------------------------------------------------
CREATE TABLE news_source (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  homepage_url text NOT NULL,
  feed_url     text,
  -- How items arrive: a free publisher feed today; a licensed wire is another
  -- kind with its own adapter, and its own rights row below.
  kind         text NOT NULL,
  -- What this source grants the product to show of each item. The renderer
  -- asks; PL016 refuses a version that carries more.
  rights       text NOT NULL,
  -- BCP 47 tag of the language the publisher writes in.
  language     text NOT NULL,
  -- A publisher who asks to be dropped is dropped without argument: the row
  -- stays, dated and with the reason, so the answer to "why is X not here" is
  -- in the table rather than in somebody's memory.
  dropped_at   timestamptz,
  dropped_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_source_kind_check CHECK (kind IN ('rss', 'atom', 'licensed')),
  CONSTRAINT news_source_rights_check CHECK (rights IN ('headline', 'summary', 'full_text')),
  CONSTRAINT news_source_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT news_source_feed_for_feed_kinds CHECK (kind = 'licensed' OR feed_url IS NOT NULL),
  CONSTRAINT news_source_dropped_is_whole CHECK (
    (dropped_at IS NULL AND dropped_reason IS NULL)
    OR (dropped_at IS NOT NULL AND btrim(coalesce(dropped_reason, '')) <> '')
  )
);

COMMENT ON TABLE news_source IS
  'Where news comes from, and what that source grants the product to show of it (T-141, D-061). Rights live here and every article version obeys them.';

CREATE TRIGGER news_source_set_updated_at
  BEFORE UPDATE ON news_source FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- story
-- ---------------------------------------------------------------------------
CREATE TABLE story (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Set by T-142 once a cluster has an original worth promoting. A story with
  -- one article is its own original; the column is what makes "the strongest
  -- original" a fact rather than a sort order.
  promoted_article_id  uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE story IS
  'One event as the news reports it: the cluster duplicate reports are grouped under (blueprint 3.3, T-141). T-142 promotes an original.';

-- ---------------------------------------------------------------------------
-- article
-- ---------------------------------------------------------------------------
CREATE TABLE article (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL REFERENCES news_source (id) ON DELETE CASCADE,
  story_id     uuid NOT NULL REFERENCES story (id) ON DELETE RESTRICT,
  -- The item's identity in its feed (guid, or the link when the feed has none),
  -- so a fetch that sees the same item twice writes it once.
  external_id  text NOT NULL,
  -- The original, which is where a reader is sent (D-061).
  url          text NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT article_external_id_per_source UNIQUE (source_id, external_id),
  CONSTRAINT article_url_not_blank CHECK (btrim(url) <> '')
);

CREATE INDEX article_story_idx ON article (story_id, fetched_at DESC);
CREATE INDEX article_source_idx ON article (source_id, fetched_at DESC);

COMMENT ON TABLE article IS
  'The identity of one article: its source, its story and its original. What it says is in article_version, one per language (T-141).';

CREATE TRIGGER article_set_updated_at
  BEFORE UPDATE ON article FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE story ADD CONSTRAINT story_promoted_article_fk
  FOREIGN KEY (promoted_article_id) REFERENCES article (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- article_version
-- ---------------------------------------------------------------------------
CREATE TABLE article_version (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      uuid NOT NULL REFERENCES article (id) ON DELETE CASCADE,
  -- BCP 47. One version per language per number; a feed item has one language.
  language        text NOT NULL,
  version_number  integer NOT NULL,
  headline        text NOT NULL,
  -- Only what the source grants: PL016 refuses a summary on a headline-only
  -- source and a body on anything but a full-text one.
  summary         text,
  body            text,
  byline          text,
  -- The publisher's time, not ours; fetched_at on the article is ours.
  published_at    timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT article_version_number_positive CHECK (version_number >= 1),
  CONSTRAINT article_version_unique UNIQUE (article_id, language, version_number),
  CONSTRAINT article_version_headline_not_blank CHECK (btrim(headline) <> ''),
  CONSTRAINT article_version_optional_not_blank CHECK (
    (summary IS NULL OR btrim(summary) <> '')
    AND (body IS NULL OR btrim(body) <> '')
    AND (byline IS NULL OR btrim(byline) <> '')
  ),
  CONSTRAINT article_version_language_format CHECK (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);

CREATE INDEX article_version_newest_idx ON article_version (article_id, language, version_number DESC);

COMMENT ON TABLE article_version IS
  'What an article says in one language, one row per version (blueprint 13.1, T-141). Immutable: a change is a new version, so what was said before stays readable.';

-- Immutable, with the one exception D-061 requires. `refuse_change()` refuses
-- every UPDATE and DELETE, which is right for a forecast and wrong here: a
-- publisher who asks to be dropped takes their items with them, and a version
-- that could not go with its article would keep the publisher's words on a
-- site they asked to leave. So: no edit, ever; and no delete except the one
-- that arrives because the article itself is gone. During a cascade the
-- parent row is already deleted when this fires, which is exactly the test.
CREATE FUNCTION refuse_change_unless_article_gone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% rows are immutable (CLAUDE.md rule 5); write a new version instead', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM article WHERE id = OLD.article_id) THEN
    RAISE EXCEPTION '% rows go only with their article (D-061); a row is never deleted on its own', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$$;

COMMENT ON FUNCTION refuse_change_unless_article_gone() IS
  'Immutability for article rows (T-141): never updated, and deleted only as part of their article going -- which is how a dropped publisher takes their words with them (D-061).';

CREATE TRIGGER article_version_immutable
  BEFORE UPDATE OR DELETE ON article_version
  FOR EACH ROW EXECUTE FUNCTION refuse_change_unless_article_gone();

-- The rights guard. A version may not carry more than its source grants; the
-- check is here, at the write, so no renderer has to remember it and no
-- licensed source later needs anything but its own rights row.
CREATE FUNCTION article_version_within_rights() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  granted text;
BEGIN
  SELECT s.rights INTO granted
    FROM article a JOIN news_source s ON s.id = a.source_id
   WHERE a.id = NEW.article_id;
  IF granted IS NULL THEN
    RAISE EXCEPTION 'article % has no source', NEW.article_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.summary IS NOT NULL AND granted = 'headline' THEN
    RAISE EXCEPTION 'this source grants the headline only; a summary may not be stored'
      USING ERRCODE = 'PL016', HINT = 'news_source.rights = headline';
  END IF;
  IF NEW.body IS NOT NULL AND granted <> 'full_text' THEN
    RAISE EXCEPTION 'this source does not grant the full text; a body may not be stored'
      USING ERRCODE = 'PL016', HINT = format('news_source.rights = %s', granted);
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION article_version_within_rights() IS
  'Refuses an article_version that carries more than its source''s rights grant (T-141, D-061). SQLSTATE PL016.';

CREATE TRIGGER article_version_within_rights
  BEFORE INSERT ON article_version
  FOR EACH ROW EXECUTE FUNCTION article_version_within_rights();

-- ---------------------------------------------------------------------------
-- article_entity
-- ---------------------------------------------------------------------------
-- The links to the football: by canonical UUID, one row per link, and no name
-- anywhere (rule 1). `entity_id` is not a foreign key because it points at
-- four tables; the type says which, and the API resolves the row from it the
-- way entity_alias already does (T-038).
CREATE TABLE article_entity (
  article_id   uuid NOT NULL REFERENCES article (id) ON DELETE CASCADE,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  PRIMARY KEY (article_id, entity_type, entity_id),
  CONSTRAINT article_entity_type_check
    CHECK (entity_type IN ('fixture', 'team', 'person', 'competition'))
);

CREATE INDEX article_entity_lookup_idx ON article_entity (entity_type, entity_id);

COMMENT ON TABLE article_entity IS
  'Which match, teams, players and competition an article is about, by canonical id and never by name (blueprint 3.3, rule 1, T-141).';

-- ---------------------------------------------------------------------------
-- article_correction
-- ---------------------------------------------------------------------------
-- Blueprint 3.3: visible corrections. A correction is a dated note against the
-- article, immutable like everything that records what was said; the page
-- shows them under the current version (T-144).
CREATE TABLE article_correction (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  uuid NOT NULL REFERENCES article (id) ON DELETE CASCADE,
  note        text NOT NULL,
  noted_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT article_correction_note_not_blank CHECK (btrim(note) <> '')
);

CREATE INDEX article_correction_idx ON article_correction (article_id, noted_at DESC);

COMMENT ON TABLE article_correction IS
  'A visible correction to an article (blueprint 3.3, T-141). Immutable and dated; shown under the current version.';

CREATE TRIGGER article_correction_immutable
  BEFORE UPDATE OR DELETE ON article_correction
  FOR EACH ROW EXECUTE FUNCTION refuse_change_unless_article_gone();

-- ---------------------------------------------------------------------------
-- A dropped publisher takes their items with them (D-061)
-- ---------------------------------------------------------------------------
-- The source row stays, dated and with the reason, because "why is X not
-- here" must have an answer in the table. The articles do not stay: the
-- moment `dropped_at` is set, they go -- and their versions, links and
-- corrections with them, through the cascades above. Marking is the act; the
-- deletion is its consequence, and nobody has to remember to do it.
CREATE FUNCTION news_source_dropped_takes_items() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM article WHERE source_id = NEW.id;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION news_source_dropped_takes_items() IS
  'When a news_source is marked dropped, its articles are removed; the source row stays as the record of why (T-141, D-061).';

CREATE TRIGGER news_source_dropped_takes_items
  AFTER UPDATE OF dropped_at ON news_source
  FOR EACH ROW
  WHEN (OLD.dropped_at IS NULL AND NEW.dropped_at IS NOT NULL)
  EXECUTE FUNCTION news_source_dropped_takes_items();

-- Down Migration
DROP TRIGGER news_source_dropped_takes_items ON news_source;
DROP FUNCTION news_source_dropped_takes_items();
DROP TABLE article_correction;
DROP TABLE article_entity;
DROP TRIGGER article_version_within_rights ON article_version;
DROP FUNCTION article_version_within_rights();
DROP TABLE article_version;
DROP FUNCTION refuse_change_unless_article_gone();
ALTER TABLE story DROP CONSTRAINT story_promoted_article_fk;
DROP TABLE article;
DROP TABLE story;
DROP TABLE news_source;
