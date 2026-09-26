-- Up Migration
-- T-531: shadow forecasts. A candidate model version is computed beside the
-- published one for every forecast the published one makes, stored exactly
-- as a forecast is (rule 5: immutable, with its inputs and its model), and
-- shown nowhere. The evaluation records (T-066) read both, so a candidate is
-- promoted on forecasts it made before kick-off (D-031), never on a belief
-- (T-535). It is the same model's next version, not a second prediction
-- product (rule 6): never published beside the first, never blended with it.
--
-- `role` defaults to 'published', which every existing row is; the default
-- is a constant, so adding it rewrites nothing. Version numbers count within
-- a role, so a member reading "version 3" of a published forecast never sees
-- a gap left by a shadow one.

ALTER TABLE forecast ADD COLUMN role text NOT NULL DEFAULT 'published';
ALTER TABLE forecast ADD CONSTRAINT forecast_role_check CHECK (role IN ('published', 'shadow'));
ALTER TABLE forecast DROP CONSTRAINT forecast_version_unique;
ALTER TABLE forecast ADD CONSTRAINT forecast_version_unique UNIQUE (fixture_id, role, version_number);

COMMENT ON COLUMN forecast.role IS
  'published: the model version the product shows; shadow: a candidate computed beside it, stored and never shown (T-531).';

-- Down Migration

-- Refuses while shadow rows exist: dropping them would delete forecasts,
-- which are never deleted (rule 5).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM forecast WHERE role = 'shadow') THEN
    RAISE EXCEPTION 'shadow forecasts exist; they are immutable and are not dropped by a migration';
  END IF;
END $$;
ALTER TABLE forecast DROP CONSTRAINT forecast_version_unique;
ALTER TABLE forecast ADD CONSTRAINT forecast_version_unique UNIQUE (fixture_id, version_number);
ALTER TABLE forecast DROP CONSTRAINT forecast_role_check;
ALTER TABLE forecast DROP COLUMN role;
