-- Up Migration

-- T-1761 (D-381): our own code for a competition the committed league-zone
-- list (`packages/contracts/zones/league-zones.json`, D-171) keys by
-- competition rather than by training division or country.
--
-- The list keys a domestic league by its training division (D-171) or its
-- country (D-234). A continental competition has neither, so the Champions
-- League's league phase -- 36 clubs ranked in one table, its bands fixed by
-- UEFA's regulations -- could never find its entry. `zone_key` is that key:
-- our code ("UCL"), never a name or a provider id (rules 1 and 2), read by the
-- standings boundary with the competition's other list keys. It is NULL for
-- every competition the list does not key this way.
--
-- One row is set here: the competition the provider's id 2 maps to (UEFA
-- Champions League), found in `provider_mapping` as the earlier data
-- migrations do (T-1421); a deployment without it writes nothing.

ALTER TABLE competition ADD COLUMN zone_key text;
ALTER TABLE competition ADD CONSTRAINT competition_zone_key_format
  CHECK (zone_key IS NULL OR zone_key ~ '^[A-Z][A-Z0-9_]{1,15}$');
CREATE UNIQUE INDEX competition_zone_key_idx ON competition (zone_key) WHERE zone_key IS NOT NULL;

COMMENT ON COLUMN competition.zone_key IS
  'Our code for the competition in the committed league-zone list when it has no training division or country to be found by (T-1761, D-381): UCL. NULL otherwise.';

UPDATE competition c
   SET zone_key = 'UCL'
  FROM provider_mapping m
 WHERE m.provider = 'api_football' AND m.entity_type = 'competition' AND m.external_id = '2'
   AND m.internal_id = c.id;

-- Down Migration

DROP INDEX IF EXISTS competition_zone_key_idx;
ALTER TABLE competition DROP CONSTRAINT IF EXISTS competition_zone_key_format;
ALTER TABLE competition DROP COLUMN IF EXISTS zone_key;
