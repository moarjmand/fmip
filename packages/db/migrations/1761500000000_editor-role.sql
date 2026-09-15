-- Up Migration

-- T-261: the `editor` role.
--
-- Blueprint 7.3 and 10.2 have named an editor since the beginning -- "manual
-- approval by the founder, editor or administrator" -- and the role list has
-- not had one, because until now nothing needed it. This is the migration that
-- builds the surface it covers, which is where a widened CHECK belongs (the
-- rule T-210 set for `sanction.scope`).
--
-- **It is not `moderator`, and the difference is the point.** Moderation is
-- about conduct: what somebody did to another member, and what the platform does
-- about it. Editorial review is about whether a piece of writing is good enough
-- to publish under the platform's name. They need different judgement, they go
-- wrong in different ways, and a product that used one role for both would make
-- every moderator an editor by accident -- and would have no way to appoint
-- somebody to read analysis without also handing them the power to sanction.
--
-- `admin` keeps both, as it keeps everything: an administrator with no editor
-- row can still review, because a deployment with one person in it should not
-- need two grants to get started.
ALTER TABLE user_role DROP CONSTRAINT user_role_role_check;
ALTER TABLE user_role ADD CONSTRAINT user_role_role_check
  CHECK (role IN ('admin', 'founder', 'moderator', 'editor'));

COMMENT ON TABLE user_role IS
  'What a member may do beyond being a member: admin, founder, moderator or editor (T-040, editor added in T-261). Each row names who granted it and why.';

-- Down Migration

-- The rows go before the constraint narrows, or the narrowing would fail on
-- data the wider constraint allowed. A down migration that cannot run is a down
-- migration that does not exist.
DELETE FROM user_role WHERE role = 'editor';
ALTER TABLE user_role DROP CONSTRAINT user_role_role_check;
ALTER TABLE user_role ADD CONSTRAINT user_role_role_check
  CHECK (role IN ('admin', 'founder', 'moderator'));
