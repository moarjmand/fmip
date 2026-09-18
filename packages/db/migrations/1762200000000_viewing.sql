-- Up Migration
-- T-311 (blueprint 11): where a match can be watched and where its highlights
-- are, stored per territory, under the rights each source grants.
--
-- The same shape as news (T-141, D-061), because it is the same problem: a
-- source says what may be shown -- a link to the official destination only,
-- a thumbnail beside it, or an embed (a player on our page) -- and every
-- surface asks rather than assumes. Built before the licensing decision
-- (T-310) on purpose: the constraint is cheap while there is one kind of
-- source and expensive to retrofit when there are two.
--
-- "Not supplied" and "not available" are different sentences, and the
-- difference is the whole epic. `viewing_coverage` is what makes the second
-- one sayable: a listing for a match in a territory is only "nothing" when a
-- source that covers that territory for that season said nothing; with no
-- coverage row there is no answer, and the surface says `not_supplied`
-- (rule 3). Coverage is stored per territory because that is where it differs.

CREATE TABLE viewing_source (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  homepage_url   text NOT NULL,
  kind           text NOT NULL,
  -- What may be shown from this source, in ascending order of what it grants.
  rights         text NOT NULL,
  dropped_at     timestamptz,
  dropped_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viewing_source_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT viewing_source_kind_check CHECK (kind IN ('official_listing', 'licensed_feed', 'manual')),
  CONSTRAINT viewing_source_rights_check CHECK (rights IN ('link', 'thumbnail', 'embed')),
  CONSTRAINT viewing_source_dropped_is_whole CHECK ((dropped_at IS NULL) = (dropped_reason IS NULL))
);

COMMENT ON TABLE viewing_source IS
  'Where viewing and highlight data comes from and what it lets us show: a link, a thumbnail, or an embed (blueprint 11, T-311; the rights model of D-061).';

CREATE TRIGGER viewing_source_set_updated_at
  BEFORE UPDATE ON viewing_source
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE broadcaster (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  homepage_url text,
  kind         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcaster_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT broadcaster_kind_check CHECK (kind IN ('tv', 'streaming', 'radio')),
  CONSTRAINT broadcaster_homepage_format CHECK (homepage_url IS NULL OR homepage_url ~ '^https?://')
);

COMMENT ON TABLE broadcaster IS
  'A service or channel a match can be watched on: the canonical entity a listing names by id (rule 1), never by name.';

CREATE TRIGGER broadcaster_set_updated_at
  BEFORE UPDATE ON broadcaster
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- One listing: this match, in this territory, on this service, with this
-- access, at this official destination. The territory is part of the key
-- because the correct option differs between countries; a row is what one
-- source said, and says which source.
-- ---------------------------------------------------------------------------
CREATE TABLE viewing_option (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id     uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  territory      text NOT NULL REFERENCES territory (code) ON DELETE RESTRICT,
  broadcaster_id uuid NOT NULL REFERENCES broadcaster (id) ON DELETE RESTRICT,
  source_id      uuid NOT NULL REFERENCES viewing_source (id) ON DELETE CASCADE,
  access         text NOT NULL,
  -- The official destination: where a viewer is sent. Never a stream we host.
  url            text NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viewing_option_access_check
    CHECK (access IN ('free', 'registration', 'subscription', 'pay_per_view')),
  CONSTRAINT viewing_option_url_not_blank CHECK (btrim(url) <> ''),
  CONSTRAINT viewing_option_one_per_service UNIQUE (fixture_id, territory, broadcaster_id)
);

CREATE INDEX viewing_option_lookup_idx ON viewing_option (fixture_id, territory);

COMMENT ON TABLE viewing_option IS
  'Where a match can be watched in a territory: the service, the access type and the official destination (blueprint 11, T-311).';

CREATE TRIGGER viewing_option_set_updated_at
  BEFORE UPDATE ON viewing_option
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- A highlight: an approved embed where there is one, the official page where
-- there is not (blueprint 11). Per territory, because an embed cleared for
-- one country is not cleared for another. `url` is always the official page,
-- so a dead player still has somewhere to send the viewer.
-- ---------------------------------------------------------------------------
CREATE TABLE highlight (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id    uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  territory     text NOT NULL REFERENCES territory (code) ON DELETE RESTRICT,
  source_id     uuid NOT NULL REFERENCES viewing_source (id) ON DELETE CASCADE,
  kind          text NOT NULL,
  url           text NOT NULL,
  embed_url     text,
  thumbnail_url text,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT highlight_kind_check CHECK (kind IN ('embed', 'official_page')),
  CONSTRAINT highlight_url_not_blank CHECK (btrim(url) <> ''),
  CONSTRAINT highlight_embed_has_player CHECK ((kind = 'embed') = (embed_url IS NOT NULL)),
  CONSTRAINT highlight_embed_url_format CHECK (embed_url IS NULL OR embed_url ~ '^https://'),
  CONSTRAINT highlight_one_per_territory UNIQUE (fixture_id, territory)
);

CREATE INDEX highlight_lookup_idx ON highlight (fixture_id, territory);

COMMENT ON TABLE highlight IS
  'The official highlight for a match in a territory: an embed where the source grants one, else the official page (blueprint 11, T-311).';

CREATE TRIGGER highlight_set_updated_at
  BEFORE UPDATE ON highlight
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- PL017: a highlight carries no more than its source grants. A link-only
-- source cannot give us a thumbnail; only an embed source can give us a
-- player. The guard is here, not only in the writer, because the writer is
-- the thing most likely to be rewritten.
-- ---------------------------------------------------------------------------
CREATE FUNCTION highlight_within_rights() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  granted text;
BEGIN
  SELECT rights INTO granted FROM viewing_source WHERE id = NEW.source_id;
  IF granted IS NULL THEN
    RAISE EXCEPTION 'highlight % has no source', NEW.id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.kind = 'embed' AND granted <> 'embed' THEN
    RAISE EXCEPTION 'source grants % and cannot give an embed (T-311)', granted
      USING ERRCODE = 'PL017';
  END IF;
  IF NEW.thumbnail_url IS NOT NULL AND granted = 'link' THEN
    RAISE EXCEPTION 'source grants a link only and cannot give a thumbnail (T-311)'
      USING ERRCODE = 'PL017';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER highlight_within_rights
  BEFORE INSERT OR UPDATE ON highlight
  FOR EACH ROW EXECUTE FUNCTION highlight_within_rights();

-- ---------------------------------------------------------------------------
-- Coverage per territory: whether a source covers this season in this
-- territory at all. Without a row here, nothing can be said about a match in
-- that territory -- `not_supplied`, never "not available".
-- ---------------------------------------------------------------------------
CREATE TABLE viewing_coverage (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES season (id) ON DELETE CASCADE,
  territory  text NOT NULL REFERENCES territory (code) ON DELETE RESTRICT,
  module     text NOT NULL,
  state      text NOT NULL,
  source_id  uuid REFERENCES viewing_source (id) ON DELETE SET NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viewing_coverage_module_check CHECK (module IN ('viewing', 'highlights')),
  CONSTRAINT viewing_coverage_state_check
    CHECK (state IN ('available', 'limited', 'not_supplied', 'delayed')),
  -- Data that is available, limited or delayed came from somewhere.
  CONSTRAINT viewing_coverage_supplied_has_source CHECK (state = 'not_supplied' OR source_id IS NOT NULL),
  CONSTRAINT viewing_coverage_one_per_territory UNIQUE (season_id, territory, module)
);

COMMENT ON TABLE viewing_coverage IS
  'Whether a source covers a season in a territory, per module: what lets a surface say "nothing listed" instead of "no data" (blueprint 11, T-311, rule 3).';

CREATE TRIGGER viewing_coverage_set_updated_at
  BEFORE UPDATE ON viewing_coverage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- A source that is dropped takes what it gave: its listings and highlights go,
-- and the coverage it stood behind becomes `not_supplied` with the reason --
-- not deleted, because "why is there nothing for Turkey" needs an answer.
-- ---------------------------------------------------------------------------
CREATE FUNCTION viewing_source_dropped_takes_rows() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dropped_at IS NOT NULL AND OLD.dropped_at IS NULL THEN
    DELETE FROM viewing_option WHERE source_id = NEW.id;
    DELETE FROM highlight WHERE source_id = NEW.id;
    UPDATE viewing_coverage
       SET state = 'not_supplied', source_id = NULL,
           note = 'source dropped: ' || NEW.dropped_reason
     WHERE source_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER viewing_source_dropped_takes_rows
  AFTER UPDATE OF dropped_at ON viewing_source
  FOR EACH ROW EXECUTE FUNCTION viewing_source_dropped_takes_rows();

-- Down Migration

DROP TRIGGER IF EXISTS viewing_source_dropped_takes_rows ON viewing_source;
DROP FUNCTION IF EXISTS viewing_source_dropped_takes_rows();
DROP TABLE viewing_coverage;
DROP TRIGGER IF EXISTS highlight_within_rights ON highlight;
DROP FUNCTION IF EXISTS highlight_within_rights();
DROP TABLE highlight;
DROP TABLE viewing_option;
DROP TABLE broadcaster;
DROP TABLE viewing_source;
