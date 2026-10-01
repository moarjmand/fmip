-- Up Migration

-- T-1320 (D-176): the entity media store. Team crests, competition logos and
-- player photos are copied once from the provider onto our own volume and
-- served from our own origin, so a reader's browser never asks the provider
-- for anything (the same rule D-089 applied to fonts).
--
-- One row per (entity_type, entity_id, kind). `entity_id` is our UUID (rule 1)
-- and, like `provider_mapping.internal_id`, not a foreign key: it names one of
-- three tables depending on `entity_type`.
--
-- `source_url` is the provider's address for the image. It is written by the
-- ingestion writers and read by the media fetch job alone; no query that builds
-- an API response selects it (rule 2). The file itself is named by its sha256
-- (`storage_key`), relative to MEDIA_DIR, so the column never holds a host path.
--
-- States:
--   pending       the provider named an image; it has not been fetched yet.
--   available     the file is on the volume; the four file columns are set.
--   not_supplied  the provider has no real image for this entity (it served its
--                 generic silhouette), so readers are told so, never shown it.
--   failed        the last attempt failed validation or transport; retried
--                 after a back-off. Read as not_supplied by the API.
CREATE TABLE entity_media (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       text NOT NULL,
  entity_id         uuid NOT NULL,
  kind              text NOT NULL,
  source_provider   text NOT NULL,
  source_url        text NOT NULL,
  state             text NOT NULL DEFAULT 'pending',
  storage_key       text,
  content_type      text,
  byte_size         integer,
  sha256            text,
  source_fetched_at timestamptz,
  last_checked_at   timestamptz,
  attempts          integer NOT NULL DEFAULT 0,
  failure           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_media_unique UNIQUE (entity_type, entity_id, kind),
  CONSTRAINT entity_media_kind_check CHECK (
    (entity_type = 'team' AND kind = 'crest')
    OR (entity_type = 'competition' AND kind = 'logo')
    OR (entity_type = 'person' AND kind = 'photo')
  ),
  CONSTRAINT entity_media_provider_check
    CHECK (source_provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT entity_media_source_url_check CHECK (source_url ~ '^https://[^[:space:]]+$'),
  CONSTRAINT entity_media_state_check
    CHECK (state IN ('pending', 'available', 'not_supplied', 'failed')),
  CONSTRAINT entity_media_content_type_check CHECK (
    content_type IS NULL
    OR content_type IN ('image/png', 'image/jpeg', 'image/svg+xml', 'image/webp')
  ),
  CONSTRAINT entity_media_byte_size_check
    CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 524288),
  CONSTRAINT entity_media_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT entity_media_storage_key_check
    CHECK (storage_key IS NULL OR storage_key ~ '^[0-9a-f]{2}/[0-9a-f]{64}\.(png|jpg|svg|webp)$'),
  CONSTRAINT entity_media_available_has_file CHECK (
    state <> 'available'
    OR (storage_key IS NOT NULL AND content_type IS NOT NULL AND byte_size IS NOT NULL
        AND sha256 IS NOT NULL AND source_fetched_at IS NOT NULL)
  ),
  CONSTRAINT entity_media_attempts_check CHECK (attempts >= 0)
);

-- What the fetch job asks for: rows not yet fetched, or due for a re-check.
CREATE INDEX entity_media_due_idx ON entity_media (state, last_checked_at NULLS FIRST);

CREATE TRIGGER entity_media_set_updated_at
  BEFORE UPDATE ON entity_media FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE entity_media IS
  'Crests, logos and player photos copied to our own volume (T-1320, D-176). source_url is read by the fetch job only, never by a response.';

-- Down Migration

DROP TABLE entity_media;
