-- Up Migration
-- T-1322 (D-177, amending D-061): news photos, only from the sources whose
-- licence covers them, and only the agency's own photos, each shown with its
-- credit and licence.
--
-- **The right lives on the source, as the words' rights do (D-061).** A
-- `news_source` either grants images under a named licence or it does not;
-- the default is that it does not, so every source added later shows no
-- image until somebody records that its licence covers one. The licence, its
-- URL, the credit a reader sees and the hosts the agency's own photos live on
-- are one fact and are set together or not at all.
--
-- **An image row obeys its source (PL022),** the way a version obeys PL016
-- and a highlight PL017: the database refuses an image on an article whose
-- source grants none, and a stored image under any licence but its source's.
-- The job applies the right before it writes, so PL022 is the guard that
-- never fires in normal operation.
--
-- **What the agency's host said is ours to keep, never to show.**
-- `source_url` is where the file came from, kept for the operator and for a
-- re-fetch; no contract carries it, and a reader's browser only ever asks
-- our own route for `file_key` (D-089 precedent, rule 2).
--
-- **Provenance is recorded, not assumed.** `state` is `stored` (the file is
-- ours to show), `refused` (the evidence says it is not the agency's own, or
-- there is no evidence at all) or `failed` (it could not be fetched or is not
-- an image we accept); `reason` says which, in words. An editor may show or
-- hide one article's image (`editor_override`), each decision an audit row.

ALTER TABLE news_source
  ADD COLUMN image_licence text,
  ADD COLUMN image_licence_url text,
  ADD COLUMN image_credit text,
  ADD COLUMN image_hosts text[],
  ADD CONSTRAINT news_source_image_licence_check CHECK (image_licence IN ('cc-by-4.0')),
  ADD CONSTRAINT news_source_image_right_is_whole CHECK (
    (image_licence IS NULL AND image_licence_url IS NULL AND image_credit IS NULL
       AND image_hosts IS NULL)
    OR (image_licence IS NOT NULL
        AND btrim(coalesce(image_licence_url, '')) <> ''
        AND btrim(coalesce(image_credit, '')) <> ''
        AND coalesce(cardinality(image_hosts), 0) > 0)
  );

COMMENT ON COLUMN news_source.image_licence IS
  'The licence under which this source''s own photos may be shown (T-1322, D-177); NULL (the default) shows no image.';
COMMENT ON COLUMN news_source.image_hosts IS
  'Registrable domains the agency''s own photos are served from; an image elsewhere is not a candidate (D-177).';

CREATE TABLE article_image (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      uuid NOT NULL UNIQUE REFERENCES article (id) ON DELETE CASCADE,
  -- Provider-side only: never in a contract, never requested by a reader.
  source_url      text NOT NULL,
  state           text NOT NULL,
  reason          text NOT NULL,
  -- Our stored file, relative to MEDIA_DIR.
  file_key        text,
  content_type    text,
  width           integer,
  height          integer,
  byte_size       integer,
  credit          text,
  licence         text,
  licence_url     text,
  editor_override text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT article_image_state_check CHECK (state IN ('stored', 'refused', 'failed')),
  CONSTRAINT article_image_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT article_image_content_type_check
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT article_image_file_key_format
    CHECK (file_key ~ '^news/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  CONSTRAINT article_image_size_positive CHECK (
    (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
    AND (byte_size IS NULL OR byte_size > 0)
  ),
  CONSTRAINT article_image_licence_check CHECK (licence IN ('cc-by-4.0')),
  CONSTRAINT article_image_override_check CHECK (editor_override IN ('show', 'hide')),
  -- A stored image is a whole fact: the file, its type and size, and what a
  -- reader must be shown beside it. Anything less is not shown, so it is
  -- not stored.
  CONSTRAINT article_image_stored_is_whole CHECK (
    state <> 'stored' OR (
      file_key IS NOT NULL AND content_type IS NOT NULL AND byte_size IS NOT NULL
      AND btrim(coalesce(credit, '')) <> '' AND licence IS NOT NULL
      AND btrim(coalesce(licence_url, '')) <> ''
    )
  )
);

COMMENT ON TABLE article_image IS
  'One article''s photo under its source''s image right (T-1322, D-177): the file we store and serve, its credit and licence, and why it is or is not shown. source_url never leaves the server.';

CREATE TRIGGER article_image_set_updated_at
  BEFORE UPDATE ON article_image FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- PL022: an image may not outrun its source's right.
CREATE FUNCTION article_image_within_rights() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  granted text;
  found boolean;
BEGIN
  SELECT TRUE, s.image_licence INTO found, granted
    FROM article a JOIN news_source s ON s.id = a.source_id
   WHERE a.id = NEW.article_id;
  IF found IS NULL THEN
    RAISE EXCEPTION 'article % has no source', NEW.article_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF granted IS NULL THEN
    RAISE EXCEPTION 'this source grants no image; an image may not be recorded'
      USING ERRCODE = 'PL022', HINT = 'news_source.image_licence IS NULL';
  END IF;
  IF NEW.licence IS NOT NULL AND NEW.licence <> granted THEN
    RAISE EXCEPTION 'this source grants images under %, not %', granted, NEW.licence
      USING ERRCODE = 'PL022', HINT = format('news_source.image_licence = %s', granted);
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION article_image_within_rights() IS
  'Refuses an article_image on an article whose source grants no image, or under another licence (T-1322, D-177). SQLSTATE PL022.';

CREATE TRIGGER article_image_within_rights
  BEFORE INSERT OR UPDATE ON article_image
  FOR EACH ROW EXECUTE FUNCTION article_image_within_rights();

-- The sources the maintainer named (2026-10-01): Mehr News (both feeds),
-- Tasnim and Tehran Times, whose sites state CC BY 4.0. Matched by the host
-- of the feed they are read from, because that is what identifies a source
-- here; a database without them (development, CI) updates nothing. Tehran
-- Times' pages carry Mehr's statement and serve photos from both groups'
-- hosts, so both are its own.
UPDATE news_source
   SET image_licence = 'cc-by-4.0',
       image_licence_url = 'https://creativecommons.org/licenses/by/4.0/',
       image_credit = 'Mehr News Agency',
       image_hosts = ARRAY['mehrnews.com']
 WHERE feed_url ~* '^https?://([a-z0-9-]+\.)*mehrnews\.com(:[0-9]+)?(/|$)';

UPDATE news_source
   SET image_licence = 'cc-by-4.0',
       image_licence_url = 'https://creativecommons.org/licenses/by/4.0/',
       image_credit = 'Tasnim News Agency',
       image_hosts = ARRAY['tasnimnews.com']
 WHERE feed_url ~* '^https?://([a-z0-9-]+\.)*tasnimnews\.com(:[0-9]+)?(/|$)';

UPDATE news_source
   SET image_licence = 'cc-by-4.0',
       image_licence_url = 'https://creativecommons.org/licenses/by/4.0/',
       image_credit = 'Tehran Times / Mehr News Agency',
       image_hosts = ARRAY['tehrantimes.com', 'mehrnews.com']
 WHERE feed_url ~* '^https?://([a-z0-9-]+\.)*tehrantimes\.com(:[0-9]+)?(/|$)';

-- Down Migration
DROP TRIGGER article_image_within_rights ON article_image;
DROP FUNCTION article_image_within_rights();
DROP TABLE article_image;
ALTER TABLE news_source
  DROP CONSTRAINT news_source_image_right_is_whole,
  DROP CONSTRAINT news_source_image_licence_check,
  DROP COLUMN image_hosts,
  DROP COLUMN image_credit,
  DROP COLUMN image_licence_url,
  DROP COLUMN image_licence;
