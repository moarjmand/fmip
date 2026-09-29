-- Up Migration

-- T-1021 (D-132): invite links.
--
-- A link is an invitation to whoever holds it, so it obeys what a direct
-- invitation obeys (T-240, T-1020): only somebody the group's invite policy
-- lets invite makes one, a contact sanction stops them, and a block between
-- the maker and the follower stops the follow. It adds three limits of its
-- own -- an expiry, a use cap, and revocation -- because a link travels
-- further than a name typed into a form.
--
-- **Only the token's hash is stored.** The token is shown once, to its maker,
-- when the link is made; the database keeps its SHA-256, so a read of this
-- table (a backup, a leaked dump) cannot be followed.

CREATE TABLE group_invite_link (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES user_group (id) ON DELETE CASCADE,
  -- Lower-case hex SHA-256 of the token. Never the token.
  token_hash  text NOT NULL,
  created_by  uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  max_uses    integer NOT NULL,
  uses        integer NOT NULL DEFAULT 0,
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES user_account (id) ON DELETE SET NULL,
  CONSTRAINT group_invite_link_hash_unique UNIQUE (token_hash),
  CONSTRAINT group_invite_link_hash_shape CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- At most thirty days: a link is for an occasion, not a standing door.
  CONSTRAINT group_invite_link_expiry
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  CONSTRAINT group_invite_link_max_uses CHECK (max_uses BETWEEN 1 AND 500),
  CONSTRAINT group_invite_link_uses CHECK (uses BETWEEN 0 AND max_uses),
  -- Who revoked it goes with when; the who may later be gone (an account
  -- deleted), the when stays.
  CONSTRAINT group_invite_link_revocation CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL)
);

CREATE INDEX group_invite_link_group_idx ON group_invite_link (group_id, created_at DESC);

COMMENT ON TABLE group_invite_link IS
  'An invite link (T-1021, D-132): the hash of its token, its maker, an expiry, a use cap, the uses so far and its revocation. The token itself is never stored.';

-- Making one: the invite policy, and the contact sanction a direct invitation
-- answers to (T-240, T-1020).
CREATE FUNCTION refuse_invite_link_out_of_place() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT group_may_invite(NEW.group_id, NEW.created_by) THEN
    RAISE EXCEPTION 'this group''s invite policy does not let this member invite'
      USING ERRCODE = 'PL006', HINT = 'invite_policy';
  END IF;
  IF member_sanctioned(NEW.created_by, 'contact') THEN
    RAISE EXCEPTION 'a sanction stands against this member'
      USING ERRCODE = 'PL004', HINT = 'contact';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_invite_link_out_of_place() IS
  'Refuses an invite link its maker may not make: the group''s invite policy (PL006) or a contact sanction (PL004). T-1021.';

CREATE TRIGGER group_invite_link_guard
  BEFORE INSERT ON group_invite_link
  FOR EACH ROW EXECUTE FUNCTION refuse_invite_link_out_of_place();

-- What a link was made as never changes. Only its uses count up, one at a
-- time, and it is revoked once.
CREATE FUNCTION refuse_invite_link_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.max_uses IS DISTINCT FROM OLD.max_uses THEN
    RAISE EXCEPTION 'an invite link is never rewritten; revoke it and make another'
      USING ERRCODE = 'PL007';
  END IF;
  IF NEW.uses < OLD.uses OR NEW.uses > OLD.uses + 1 THEN
    RAISE EXCEPTION 'an invite link''s uses count up one at a time'
      USING ERRCODE = 'PL007';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'this invite link is already revoked'
      USING ERRCODE = 'PL007';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER group_invite_link_fixed
  BEFORE UPDATE ON group_invite_link
  FOR EACH ROW EXECUTE FUNCTION refuse_invite_link_rewrite();

-- The ceiling on making links, the same mechanism as every other (T-213,
-- D-103). Twenty an hour: a group owner shares a handful of links for an
-- occasion; twenty is far above that and far below a campaign.
INSERT INTO rate_limit (action, per_hour) VALUES ('group_invite_link', 20);

CREATE TRIGGER group_invite_link_volume_guard
  BEFORE INSERT ON group_invite_link
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('group_invite_link', 'created_by');

-- ---------------------------------------------------------------------------
-- Following a link
-- ---------------------------------------------------------------------------
-- One function, so the checks, the membership (or the join request) and the
-- use are one statement's work under one row lock: two people following the
-- last use at once cannot both get in.
--
-- Returns one row, or none when no link has that hash:
--   outcome   -- joined | requested | member | revoked | expired | exhausted | orphaned
--   group_id, visibility
-- `orphaned` is a link whose maker may no longer invite (they left, were
-- demoted, or the policy changed): the policy applies when the link is
-- followed, not only when it was made.
CREATE FUNCTION group_invite_link_follow(hash text, follower uuid)
RETURNS TABLE (outcome text, group_id uuid, visibility text)
LANGUAGE plpgsql AS $$
DECLARE
  link group_invite_link%ROWTYPE;
  how  text;
  made integer;
BEGIN
  SELECT * INTO link FROM group_invite_link l WHERE l.token_hash = hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT g.visibility INTO how FROM user_group g WHERE g.id = link.group_id;

  IF link.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, link.group_id, how; RETURN;
  END IF;
  IF link.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, link.group_id, how; RETURN;
  END IF;
  IF link.uses >= link.max_uses THEN
    RETURN QUERY SELECT 'exhausted'::text, link.group_id, how; RETURN;
  END IF;
  IF NOT group_may_invite(link.group_id, link.created_by) THEN
    RETURN QUERY SELECT 'orphaned'::text, link.group_id, how; RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM group_member m WHERE m.group_id = link.group_id AND m.user_id = follower
  ) THEN
    RETURN QUERY SELECT 'member'::text, link.group_id, how; RETURN;
  END IF;

  -- The gates a direct invitation answers to (T-240): a block between the
  -- maker and the follower, and the maker's contact sanction. Both say only
  -- "not available", never which.
  IF users_blocked(link.created_by, follower) OR member_sanctioned(link.created_by, 'contact') THEN
    RAISE EXCEPTION 'a block stands between these members'
      USING ERRCODE = 'PL003', HINT = 'an invite link is a way of reaching somebody';
  END IF;

  IF how = 'discoverable' THEN
    -- A discoverable group is joined by request (D-057), and a link does not
    -- change that: it files the request an owner or moderator answers. The
    -- request's own guards (sanction, ceiling) apply.
    INSERT INTO group_join_request (group_id, user_id)
    VALUES (link.group_id, follower)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS made = ROW_COUNT;
    IF made = 1 THEN
      UPDATE group_invite_link SET uses = uses + 1 WHERE id = link.id;
    END IF;
    RETURN QUERY SELECT 'requested'::text, link.group_id, how; RETURN;
  END IF;

  -- Public or invite-only: the link is the invitation. The membership's own
  -- guard refuses a `groups` sanction (PL004).
  INSERT INTO group_member (group_id, user_id) VALUES (link.group_id, follower);
  DELETE FROM group_invite i WHERE i.group_id = link.group_id AND i.invitee_id = follower;
  DELETE FROM group_join_request r WHERE r.group_id = link.group_id AND r.user_id = follower;
  UPDATE group_invite_link SET uses = uses + 1 WHERE id = link.id;
  RETURN QUERY SELECT 'joined'::text, link.group_id, how;
END
$$;

COMMENT ON FUNCTION group_invite_link_follow(text, uuid) IS
  'Follows an invite link by its token hash (T-1021): joins, files a join request for a discoverable group, or says why not (revoked, expired, exhausted, orphaned, member). A block or the maker''s contact sanction raises PL003; a groups sanction PL004.';

-- Down Migration

DROP FUNCTION IF EXISTS group_invite_link_follow(text, uuid);
DROP TRIGGER IF EXISTS group_invite_link_volume_guard ON group_invite_link;
DELETE FROM rate_window WHERE action = 'group_invite_link';
DELETE FROM rate_limit WHERE action = 'group_invite_link';
DROP TRIGGER IF EXISTS group_invite_link_fixed ON group_invite_link;
DROP FUNCTION IF EXISTS refuse_invite_link_rewrite();
DROP TRIGGER IF EXISTS group_invite_link_guard ON group_invite_link;
DROP FUNCTION IF EXISTS refuse_invite_link_out_of_place();
DROP TABLE IF EXISTS group_invite_link;
