-- Up Migration

-- Rule 1: every football entity has an internal UUID that we generate.
-- `gen_random_uuid()` is in core Postgres from 13 onward; before that it needed
-- the pgcrypto extension. Fail loudly here rather than at the first CREATE
-- TABLE in T-010, where the error would name a column instead of the cause.
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 130000 THEN
    RAISE EXCEPTION
      'PostgreSQL 13 or newer is required (gen_random_uuid lives in core from 13); this server is %',
      current_setting('server_version');
  END IF;
END
$$;

-- Every table that records when it last changed attaches this. Writing the
-- timestamp in a trigger rather than in application code means a row updated by
-- a migration, a backfill or psql carries an honest `updated_at` too — which is
-- what rule 4 depends on.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'Trigger function: stamps NEW.updated_at with now(). Attach BEFORE UPDATE on any table with an updated_at column.';

-- Down Migration

DROP FUNCTION IF EXISTS set_updated_at();
