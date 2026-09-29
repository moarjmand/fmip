-- Up Migration
-- T-1102 (D-140): several candidates in shadow at once. A shadow forecast is
-- numbered within its own model version, so each candidate's record is its
-- own and a new candidate starts at 1 without touching another's numbers.
-- Published versions keep counting on their own, exactly as before (T-531):
-- a member reading "version 3" never sees a gap left by a shadow.
--
-- No row is written or renumbered. Every existing row already satisfies both
-- indexes, because (fixture_id, role, version_number) was unique: two shadow
-- rows of one fixture never shared a number, whatever their versions. So
-- 0.5.0's stored shadow rows keep their numbers, and its next shadow version
-- on a fixture is its own highest there plus one. T-535 counts 0.5.0's
-- pre-kick-off evaluations by model version, which this does not touch.

ALTER TABLE forecast DROP CONSTRAINT forecast_version_unique;
CREATE UNIQUE INDEX forecast_published_version_unique
  ON forecast (fixture_id, version_number) WHERE role = 'published';
CREATE UNIQUE INDEX forecast_shadow_version_unique
  ON forecast (fixture_id, model_version_id, version_number) WHERE role = 'shadow';

COMMENT ON INDEX forecast_shadow_version_unique IS
  'A shadow forecast is numbered within its fixture and model version: each candidate in shadow counts on its own (T-1102, D-140).';

-- Down Migration

-- Refuses once two candidates have numbered the same fixture's shadow
-- versions alike: renumbering would edit forecasts, which are never edited
-- (rule 5).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM forecast WHERE role = 'shadow'
     GROUP BY fixture_id, version_number HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'shadow forecasts of several versions share a number; they are not renumbered';
  END IF;
END $$;
DROP INDEX forecast_shadow_version_unique;
DROP INDEX forecast_published_version_unique;
ALTER TABLE forecast ADD CONSTRAINT forecast_version_unique UNIQUE (fixture_id, role, version_number);
