-- Up Migration
-- T-1366 (D-184): verified match highlights from a licensed feed, Highlightly.
--
-- D-069 built the viewing schema so that "a second source slots in beside"
-- the editorial desk. This is that source: `licensed_feed`, and `link` rights
-- only -- the feed's clips are the rights holders' own uploads and the viewer
-- is sent to the original; nothing is played on our page and no thumbnail is
-- taken, whatever the provider offers.
--
-- Why not rows in `highlight`. That table is one row per match and territory,
-- which is right for a desk that enters a page for Iran. A feed clip carries
-- a rule instead -- allowed everywhere, only in these countries, everywhere
-- but these -- and writing it out per territory would be some 250 rows per
-- match. So the feed's clip is one row with its rule, and the read path
-- evaluates the rule for the viewer's territory (one copy, in the API's
-- `offeredIn`). A desk row for the same match and territory wins (D-184).
--
-- No provider id is kept here (rule 1): the match is ours, the clip is its
-- original address, and the publisher is the channel's own name as shown.

-- A fixed id, so the API names the feed by id and never by name (rule 1).
INSERT INTO viewing_source (id, name, homepage_url, kind, rights)
VALUES ('00000000-0000-4000-8000-000000000902', 'Highlightly', 'https://highlightly.net/',
        'licensed_feed', 'link');

CREATE TABLE highlight_feed (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id          uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  source_id           uuid NOT NULL REFERENCES viewing_source (id) ON DELETE CASCADE,
  -- The original: where a viewer is sent. Never a player.
  url                 text NOT NULL,
  title               text NOT NULL DEFAULT '',
  -- Who published the clip ("LaLiga", "Sky Sports"); null when the feed names nobody.
  publisher           text,
  -- The clip's territory rule: offered where `allowed` is empty or holds the
  -- territory, and `blocked` does not. A clip whose rule is unknown is never stored.
  allowed_territories text[] NOT NULL DEFAULT '{}',
  blocked_territories text[] NOT NULL DEFAULT '{}',
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  -- An editor's removal (rule 10): the row stays, so the feed never brings it back.
  withdrawn_at        timestamptz,
  withdrawn_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT highlight_feed_one_per_fixture UNIQUE (fixture_id),
  CONSTRAINT highlight_feed_url_https CHECK (url ~ '^https://'),
  CONSTRAINT highlight_feed_publisher_not_blank CHECK (publisher IS NULL OR btrim(publisher) <> ''),
  CONSTRAINT highlight_feed_allowed_codes
    CHECK (array_to_string(allowed_territories, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  CONSTRAINT highlight_feed_blocked_codes
    CHECK (array_to_string(blocked_territories, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  CONSTRAINT highlight_feed_withdrawn_is_whole
    CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL))
);

COMMENT ON TABLE highlight_feed IS
  'A licensed feed''s verified highlight for a match: one clip, its original address, its publisher and the territories it may be offered in (T-1366, D-184). Link only.';

CREATE TRIGGER highlight_feed_set_updated_at
  BEFORE UPDATE ON highlight_feed
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A feed's source grants a link and nothing more: the feed is never the desk,
-- and never a source that could put a player on the page.
CREATE FUNCTION highlight_feed_link_source() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  source record;
BEGIN
  SELECT kind, rights INTO source FROM viewing_source WHERE id = NEW.source_id;
  IF source.kind IS DISTINCT FROM 'licensed_feed' OR source.rights IS DISTINCT FROM 'link' THEN
    RAISE EXCEPTION 'a feed highlight needs a licensed feed that grants a link (T-1366)'
      USING ERRCODE = 'PL017';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER highlight_feed_link_source
  BEFORE INSERT OR UPDATE OF source_id ON highlight_feed
  FOR EACH ROW EXECUTE FUNCTION highlight_feed_link_source();

-- A dropped source takes its clips, as it takes its `highlight` rows (T-311).
CREATE FUNCTION viewing_source_dropped_takes_feed() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dropped_at IS NOT NULL AND OLD.dropped_at IS NULL THEN
    DELETE FROM highlight_feed WHERE source_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER viewing_source_dropped_takes_feed
  AFTER UPDATE OF dropped_at ON viewing_source
  FOR EACH ROW EXECUTE FUNCTION viewing_source_dropped_takes_feed();

-- Down Migration

DROP TRIGGER IF EXISTS viewing_source_dropped_takes_feed ON viewing_source;
DROP FUNCTION IF EXISTS viewing_source_dropped_takes_feed();
DROP TABLE highlight_feed;
DROP FUNCTION IF EXISTS highlight_feed_link_source();
DELETE FROM viewing_source WHERE id = '00000000-0000-4000-8000-000000000902';
