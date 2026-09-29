-- Up Migration

-- T-1020 (D-132): who may invite to a group.
--
-- Blueprint 8.2 lets an owner decide who may invite. Three answers, as a
-- closed list: the owner alone, the owner and the moderators, or every member.
-- The default is the middle one because it is what every group already did
-- (T-241 let the owner and the moderators invite): an existing group keeps
-- today's behaviour until its owner changes it.
--
-- The rule is the schema's, like every other membership rule (D-057): the
-- invitation guard below refuses an invitation the policy does not allow, so
-- no caller can route around it.
ALTER TABLE user_group
  ADD COLUMN invite_policy text NOT NULL DEFAULT 'owner_and_moderators',
  ADD CONSTRAINT user_group_invite_policy_kind
    CHECK (invite_policy IN ('owner', 'owner_and_moderators', 'members'));

COMMENT ON COLUMN user_group.invite_policy IS
  'Who may invite (T-1020, D-132): owner, owner_and_moderators (the default, and what every group did before), or members. Enforced by group_invite_policy_guard.';

-- Whether this member may invite to this group under its policy. One place, so
-- the invitation guard and the invite links of T-1021 ask the same question.
CREATE FUNCTION group_may_invite(target uuid, who uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM group_member m
      JOIN user_group g ON g.id = m.group_id
     WHERE m.group_id = target
       AND m.user_id = who
       AND CASE g.invite_policy
             WHEN 'owner' THEN m.role = 'owner'
             WHEN 'owner_and_moderators' THEN m.role IN ('owner', 'moderator')
             ELSE true
           END
  )
$$;

COMMENT ON FUNCTION group_may_invite(uuid, uuid) IS
  'Whether a member may invite to a group under its invite_policy (T-1020, D-132). Somebody outside the group never may.';

CREATE FUNCTION refuse_invite_against_policy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT group_may_invite(NEW.group_id, NEW.invited_by) THEN
    RAISE EXCEPTION 'this group''s invite policy does not let this member invite'
      USING ERRCODE = 'PL006', HINT = 'invite_policy';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_invite_against_policy() IS
  'Refuses an invitation the group''s invite_policy does not allow (T-1020). SQLSTATE PL006, hint invite_policy.';

-- Named to fire before `group_invite_guard` (alphabetical order): somebody
-- who may not invite at all is told that, rather than whether the invitee is
-- already inside.
CREATE TRIGGER group_invite_a_policy_guard
  BEFORE INSERT ON group_invite
  FOR EACH ROW EXECUTE FUNCTION refuse_invite_against_policy();

-- Down Migration

DROP TRIGGER IF EXISTS group_invite_a_policy_guard ON group_invite;
DROP FUNCTION IF EXISTS refuse_invite_against_policy();
DROP FUNCTION IF EXISTS group_may_invite(uuid, uuid);
ALTER TABLE user_group DROP CONSTRAINT IF EXISTS user_group_invite_policy_kind;
ALTER TABLE user_group DROP COLUMN IF EXISTS invite_policy;
