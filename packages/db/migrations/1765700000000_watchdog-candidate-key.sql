-- Up Migration
-- T-1165 (D-140): the watchdog's condition for a candidate in shadow is keyed
-- `candidate:<version>`, and a version is `name@x.y.z`. The key check from
-- 1764733100000_watchdog.sql admits only `[a-z0-9_-]` after the colon, so the
-- first tick that read a candidate raised a check violation and every tick
-- since has thrown before recording anything. The suffix now also admits `.`
-- and `@`, which is what a version is made of; the prefix is unchanged.

ALTER TABLE watchdog_condition DROP CONSTRAINT watchdog_condition_key;
ALTER TABLE watchdog_condition
  ADD CONSTRAINT watchdog_condition_key CHECK (key ~ '^[a-z_]+(:[a-z0-9_.@-]+)?$');

-- Down Migration

DELETE FROM watchdog_condition WHERE key ~ '^[a-z_]+:.*[.@]';
ALTER TABLE watchdog_condition DROP CONSTRAINT watchdog_condition_key;
ALTER TABLE watchdog_condition
  ADD CONSTRAINT watchdog_condition_key CHECK (key ~ '^[a-z_]+(:[a-z0-9_-]+)?$');
