-- Up Migration
-- T-812 (D-094): a member deletes their account. The row stays, as a
-- tombstone, because predictions, settlements, rating snapshots, points,
-- reports and the audit trail hold it with ON DELETE RESTRICT and must keep
-- doing so (rules 8 and 10). What this migration adds is what makes the
-- tombstone safe:
--
--   1. The username the member had is retired, not released. It is copied to
--      `retired_username` -- the string and a date, deliberately without the
--      account id, so it cannot be joined back to the anonymised row -- and a
--      trigger refuses it to any account that is not deleted. The refusal is a
--      unique violation on `user_account_username_unique`, so registration
--      answers "already taken" exactly as it does for a live username.
--   2. The tombstone's own username (`deleted_` and twelve hex digits) is a
--      shape no live account may take, so a reader seeing it knows the author
--      is a deleted member and nobody can register one to pose as the ghost.
--   3. Deletion is final: an account that is deleted cannot be set back.
--   4. A member's briefings are theirs alone and are the one immutable
--      table whose rows are personal writing about the member; they may now be
--      deleted, but only once the account is deleted.
--
-- Additive: a new table, new functions and triggers, and one trigger swapped
-- on `member_briefing`. No existing row changes; an existing account whose
-- username already starts with `deleted_` is not touched (the trigger fires
-- on a change to username or status only).

CREATE TABLE retired_username (
  username   text PRIMARY KEY,
  retired_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE retired_username IS
  'Usernames of deleted accounts (T-812, D-094), never reusable. No account id, on purpose.';

CREATE FUNCTION refuse_retired_username() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'deleted' AND NEW.status <> 'deleted' THEN
    RAISE EXCEPTION 'a deleted account cannot be restored'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'deleted' AND (
       NEW.username LIKE 'deleted\_%'
       OR EXISTS (SELECT 1 FROM retired_username r WHERE r.username = NEW.username)
     ) THEN
    RAISE EXCEPTION 'username % is not available', NEW.username
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'user_account_username_unique';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_account_username_not_retired
  BEFORE INSERT OR UPDATE OF username, status ON user_account
  FOR EACH ROW EXECUTE FUNCTION refuse_retired_username();

CREATE FUNCTION refuse_briefing_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = OLD.user_id AND u.status = 'deleted') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are immutable (CLAUDE.md rule 5); write a new version instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER member_briefing_immutable ON member_briefing;
CREATE TRIGGER member_briefing_immutable
  BEFORE DELETE OR UPDATE ON member_briefing
  FOR EACH ROW EXECUTE FUNCTION refuse_briefing_change();

-- Down Migration

DROP TRIGGER member_briefing_immutable ON member_briefing;
CREATE TRIGGER member_briefing_immutable
  BEFORE DELETE OR UPDATE ON member_briefing
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
DROP FUNCTION refuse_briefing_change();

DROP TRIGGER user_account_username_not_retired ON user_account;
DROP FUNCTION refuse_retired_username();
DROP TABLE retired_username;
