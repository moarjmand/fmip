-- Up Migration
-- T-620: the first-run flow (language, territory, time zone, favourite teams)
-- is offered once. The moment a member finished or dismissed it is kept on the
-- account, so a second device or a cleared browser does not offer it again.
-- NULL means it has not happened yet. Additive and nullable: no backfill, so an
-- account that existed before this column is offered the flow once as well,
-- which it can dismiss in one click.

ALTER TABLE user_account ADD COLUMN first_run_done_at timestamptz;

COMMENT ON COLUMN user_account.first_run_done_at IS
  'When the member finished or dismissed the first-run flow (T-620); NULL until then. Set once, never moved.';

-- Down Migration

ALTER TABLE user_account DROP COLUMN first_run_done_at;
