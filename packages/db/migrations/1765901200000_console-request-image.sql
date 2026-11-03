-- Up Migration

-- ---------------------------------------------------------------------------
-- Pictures on the teammate requests (T-1731, D-357).
--
-- A console user adds up to eight pictures to an open request: a screenshot
-- from a phone, a photo, a picture pasted from the clipboard. Claude, in the
-- maintainer's chat, downloads them with the request (`requests-pull`) and
-- reads them as it reads the text: as data.
--
-- The upload is never stored as sent. The API checks its first bytes, decodes
-- it, and writes a WebP re-encoding with every piece of metadata removed
-- (EXIF with any GPS position, XMP, ICC) and the long side at most 2400 px,
-- plus a 480 px thumbnail. The files live on the media volume under
-- `console-requests/<request>/`, a folder no public route reads: the bytes
-- are served only to a console session and to the server's command line.
-- This row is what is known of the stored file; the upload's own type and
-- size are kept for the record.
-- ---------------------------------------------------------------------------

CREATE TABLE console_request_image (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid NOT NULL REFERENCES console_request (id) ON DELETE CASCADE,
  uploaded_by         uuid NOT NULL REFERENCES console_user (id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- 1, 2, 3 ... per request in the order added; a removed one's number stays unused.
  position            integer NOT NULL,
  caption             text,
  -- The stored file (the re-encoding), and its thumbnail.
  content_type        text NOT NULL,
  byte_size           integer NOT NULL,
  width               integer NOT NULL,
  height              integer NOT NULL,
  sha256              text NOT NULL,
  storage_key         text NOT NULL,
  thumb_key           text NOT NULL,
  thumb_width         integer NOT NULL,
  thumb_height        integer NOT NULL,
  thumb_byte_size     integer NOT NULL,
  -- What was uploaded, before the re-encoding.
  original_type       text NOT NULL,
  original_byte_size  integer NOT NULL,
  CONSTRAINT console_request_image_position CHECK (position >= 1),
  CONSTRAINT console_request_image_position_unique UNIQUE (request_id, position),
  CONSTRAINT console_request_image_caption_length CHECK (
    caption IS NULL OR (btrim(caption) <> '' AND char_length(caption) <= 300)
  ),
  CONSTRAINT console_request_image_type CHECK (content_type IN ('image/webp')),
  CONSTRAINT console_request_image_original_type CHECK (
    original_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  ),
  -- The upload is at most 8 MiB; the stored files are smaller than that.
  CONSTRAINT console_request_image_sizes CHECK (
    byte_size > 0 AND thumb_byte_size > 0
    AND original_byte_size > 0 AND original_byte_size <= 8388608
  ),
  CONSTRAINT console_request_image_dimensions CHECK (
    width BETWEEN 1 AND 2400 AND height BETWEEN 1 AND 2400
    AND thumb_width BETWEEN 1 AND 480 AND thumb_height BETWEEN 1 AND 480
  ),
  CONSTRAINT console_request_image_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Under the private folder, named by the request and the picture.
  CONSTRAINT console_request_image_keys CHECK (
    storage_key = 'console-requests/' || request_id || '/' || id || '.webp'
    AND thumb_key = 'console-requests/' || request_id || '/' || id || '-thumb.webp'
  )
);

CREATE INDEX console_request_image_request ON console_request_image (request_id, position);

COMMENT ON TABLE console_request_image IS
  'Pictures on the teammate requests (T-1731, D-357): re-encoded WebP without metadata, stored privately on the media volume under console-requests/, served only to a console session and the server CLI.';

-- The history learns three more kinds; only a person writes them (the
-- existing actor check: every kind but `result` and `asked` has a person).
ALTER TABLE console_request_event DROP CONSTRAINT console_request_event_kind;
ALTER TABLE console_request_event ADD CONSTRAINT console_request_event_kind CHECK (kind IN (
  'created', 'edited', 'cancelled', 'reopened', 'execute_requested', 'execute_withdrawn',
  'asked', 'decided', 'result', 'image_added', 'image_removed', 'image_captioned'
));

-- The ceiling (D-103's inventory): forty pictures an hour per console
-- account, counted by the API from the person's own `image_added` events in
-- the clock hour, before the upload is decoded. Each upload is also one of
-- the person's sixty `console_request` changes an hour. Decoding is the
-- costly part on a two-core server; two people attaching screenshots do not
-- add forty an hour.
INSERT INTO rate_limit (action, per_hour) VALUES ('console_request_image', 40)
ON CONFLICT (action) DO NOTHING;

-- Down Migration

DELETE FROM rate_limit WHERE action = 'console_request_image';
-- The history is immutable, so rows of the new kinds stay; the old list is
-- put back for new rows only.
ALTER TABLE console_request_event DROP CONSTRAINT console_request_event_kind;
ALTER TABLE console_request_event ADD CONSTRAINT console_request_event_kind CHECK (kind IN (
  'created', 'edited', 'cancelled', 'reopened', 'execute_requested', 'execute_withdrawn',
  'asked', 'decided', 'result'
)) NOT VALID;
DROP TABLE console_request_image;
