-- Up Migration

-- T-1611 (D-282): a country's flag is entity media like a crest (D-176).
-- The provider names each competition's country flag in the fixture lists
-- the ingestion jobs already read; the writers note it against the
-- competition's country, and the media fetch job copies it to our own volume
-- on its usual tick. No backfill: rows appear as the fixture lists are read.
--
-- Only the kind check changes: `country` entities carry a `flag`.
-- `entity_media` has `entity_media_set_updated_at` (a constraint is replaced,
-- no row written).

ALTER TABLE entity_media DROP CONSTRAINT entity_media_kind_check;
ALTER TABLE entity_media ADD CONSTRAINT entity_media_kind_check CHECK (
  (entity_type = 'team' AND kind = 'crest')
  OR (entity_type = 'competition' AND kind = 'logo')
  OR (entity_type = 'person' AND kind = 'photo')
  OR (entity_type = 'venue' AND kind = 'venue')
  OR (entity_type = 'country' AND kind = 'flag')
);

-- Down Migration

DELETE FROM entity_media WHERE entity_type = 'country';
ALTER TABLE entity_media DROP CONSTRAINT entity_media_kind_check;
ALTER TABLE entity_media ADD CONSTRAINT entity_media_kind_check CHECK (
  (entity_type = 'team' AND kind = 'crest')
  OR (entity_type = 'competition' AND kind = 'logo')
  OR (entity_type = 'person' AND kind = 'photo')
  OR (entity_type = 'venue' AND kind = 'venue')
);
