-- Up Migration

-- T-1023 (D-133): a group's rules, written by its owner, versioned, and
-- accepted on joining.
--
-- **Versioned, never edited in place.** Each change is a new row with the
-- next number; the text a member accepted is the text they read, always.
--
-- **The rules are the group's words, not the platform's.** They sit beside
-- the platform rules (13-policy.md), never instead of them, and the page says
-- whose they are.
--
-- **Accepting is recorded, and joining without it is refused here.** A
-- member's row carries the version they accepted; a group with rules refuses
-- a membership that accepted none. Nobody is removed for not accepting a
-- newer version: `rules_seen_version` only records that a member has been
-- shown it, once.

CREATE TABLE group_rules_version (
  group_id   uuid NOT NULL REFERENCES user_group (id) ON DELETE CASCADE,
  version    integer NOT NULL,
  body       text NOT NULL,
  created_by uuid REFERENCES user_account (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_rules_version_pkey PRIMARY KEY (group_id, version),
  CONSTRAINT group_rules_version_positive CHECK (version >= 1),
  CONSTRAINT group_rules_version_body_length
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000)
);

COMMENT ON TABLE group_rules_version IS
  'A group''s own rules, one row per version (T-1023, D-133). Never edited: a change is the next version.';

-- Never rewritten. Deleting goes only with the group (the cascade). The one
-- change allowed is the author's account going (`ON DELETE SET NULL`): the
-- words stay, the name goes.
CREATE FUNCTION refuse_rules_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.group_id = OLD.group_id
     AND NEW.version = OLD.version
     AND NEW.body = OLD.body
     AND NEW.created_at = OLD.created_at
     AND NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a group''s rules are never edited; write the next version'
    USING ERRCODE = 'PL007';
END
$$;

CREATE TRIGGER group_rules_version_fixed
  BEFORE UPDATE ON group_rules_version
  FOR EACH ROW EXECUTE FUNCTION refuse_rules_rewrite();

-- The next number, whatever the caller sent, under the group's row lock, so
-- two owners' tabs cannot both write version 3.
CREATE FUNCTION number_rules_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM user_group WHERE id = NEW.group_id FOR UPDATE;
  SELECT COALESCE(max(version), 0) + 1 INTO NEW.version
    FROM group_rules_version WHERE group_id = NEW.group_id;
  RETURN NEW;
END
$$;

CREATE TRIGGER group_rules_version_number
  BEFORE INSERT ON group_rules_version
  FOR EACH ROW EXECUTE FUNCTION number_rules_version();

-- The group's current rules, or null.
CREATE FUNCTION group_rules_latest(target uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT max(version) FROM group_rules_version WHERE group_id = target
$$;

-- What each member accepted, and the newest version they have been shown.
ALTER TABLE group_member
  ADD COLUMN rules_version integer,
  ADD COLUMN rules_seen_version integer,
  ADD CONSTRAINT group_member_rules_version_fkey
    FOREIGN KEY (group_id, rules_version) REFERENCES group_rules_version (group_id, version),
  ADD CONSTRAINT group_member_rules_seen_fkey
    FOREIGN KEY (group_id, rules_seen_version) REFERENCES group_rules_version (group_id, version);

COMMENT ON COLUMN group_member.rules_version IS
  'The version of the group''s rules this member accepted on joining (T-1023). Null only for a member who joined before the group had rules.';
COMMENT ON COLUMN group_member.rules_seen_version IS
  'The newest version of the rules this member has been shown. A newer one is shown once (T-1023); nobody is removed for it.';

-- A request to a discoverable group carries the version its asker accepted,
-- so letting them in later records what they read.
ALTER TABLE group_join_request
  ADD COLUMN rules_version integer,
  ADD CONSTRAINT group_join_request_rules_version_fkey
    FOREIGN KEY (group_id, rules_version) REFERENCES group_rules_version (group_id, version);

-- **Joining a group with rules without accepting them is refused.** The
-- owner's own row at creation is exempt: a group has no rules until its
-- owner writes them. What was accepted is also what was shown.
CREATE FUNCTION refuse_join_without_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role <> 'owner'
     AND group_rules_latest(NEW.group_id) IS NOT NULL
     AND NEW.rules_version IS NULL THEN
    RAISE EXCEPTION 'this group has rules; a member accepts them to join'
      USING ERRCODE = 'PL006', HINT = 'rules';
  END IF;
  NEW.rules_seen_version := COALESCE(NEW.rules_seen_version, NEW.rules_version);
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_join_without_rules() IS
  'Refuses a membership in a group with rules that accepted no version (T-1023). SQLSTATE PL006, hint rules.';

CREATE TRIGGER group_member_terms_guard
  BEFORE INSERT ON group_member
  FOR EACH ROW EXECUTE FUNCTION refuse_join_without_rules();

CREATE FUNCTION refuse_request_without_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF group_rules_latest(NEW.group_id) IS NOT NULL AND NEW.rules_version IS NULL THEN
    RAISE EXCEPTION 'this group has rules; a member accepts them to ask to join'
      USING ERRCODE = 'PL006', HINT = 'rules';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER group_join_request_rules_guard
  BEFORE INSERT ON group_join_request
  FOR EACH ROW EXECUTE FUNCTION refuse_request_without_rules();

-- ---------------------------------------------------------------------------
-- Following an invite link (T-1021) carries the version accepted too.
-- ---------------------------------------------------------------------------
DROP FUNCTION group_invite_link_follow(text, uuid);

CREATE FUNCTION group_invite_link_follow(hash text, follower uuid, accepted integer)
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

  IF users_blocked(link.created_by, follower) OR member_sanctioned(link.created_by, 'contact') THEN
    RAISE EXCEPTION 'a block stands between these members'
      USING ERRCODE = 'PL003', HINT = 'an invite link is a way of reaching somebody';
  END IF;

  IF how = 'discoverable' THEN
    INSERT INTO group_join_request (group_id, user_id, rules_version)
    VALUES (link.group_id, follower, accepted)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS made = ROW_COUNT;
    IF made = 1 THEN
      UPDATE group_invite_link SET uses = uses + 1 WHERE id = link.id;
    END IF;
    RETURN QUERY SELECT 'requested'::text, link.group_id, how; RETURN;
  END IF;

  INSERT INTO group_member (group_id, user_id, rules_version)
  VALUES (link.group_id, follower, accepted);
  DELETE FROM group_invite i WHERE i.group_id = link.group_id AND i.invitee_id = follower;
  DELETE FROM group_join_request r WHERE r.group_id = link.group_id AND r.user_id = follower;
  UPDATE group_invite_link SET uses = uses + 1 WHERE id = link.id;
  RETURN QUERY SELECT 'joined'::text, link.group_id, how;
END
$$;

COMMENT ON FUNCTION group_invite_link_follow(text, uuid, integer) IS
  'Follows an invite link by its token hash (T-1021), with the version of the group''s rules the follower accepted (T-1023): joins, files a join request for a discoverable group, or says why not.';

-- Down Migration

DROP FUNCTION IF EXISTS group_invite_link_follow(text, uuid, integer);

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
  IF users_blocked(link.created_by, follower) OR member_sanctioned(link.created_by, 'contact') THEN
    RAISE EXCEPTION 'a block stands between these members'
      USING ERRCODE = 'PL003', HINT = 'an invite link is a way of reaching somebody';
  END IF;
  IF how = 'discoverable' THEN
    INSERT INTO group_join_request (group_id, user_id)
    VALUES (link.group_id, follower)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS made = ROW_COUNT;
    IF made = 1 THEN
      UPDATE group_invite_link SET uses = uses + 1 WHERE id = link.id;
    END IF;
    RETURN QUERY SELECT 'requested'::text, link.group_id, how; RETURN;
  END IF;
  INSERT INTO group_member (group_id, user_id) VALUES (link.group_id, follower);
  DELETE FROM group_invite i WHERE i.group_id = link.group_id AND i.invitee_id = follower;
  DELETE FROM group_join_request r WHERE r.group_id = link.group_id AND r.user_id = follower;
  UPDATE group_invite_link SET uses = uses + 1 WHERE id = link.id;
  RETURN QUERY SELECT 'joined'::text, link.group_id, how;
END
$$;

DROP TRIGGER IF EXISTS group_join_request_rules_guard ON group_join_request;
DROP FUNCTION IF EXISTS refuse_request_without_rules();
DROP TRIGGER IF EXISTS group_member_terms_guard ON group_member;
DROP FUNCTION IF EXISTS refuse_join_without_rules();
ALTER TABLE group_join_request DROP CONSTRAINT IF EXISTS group_join_request_rules_version_fkey;
ALTER TABLE group_join_request DROP COLUMN IF EXISTS rules_version;
ALTER TABLE group_member DROP CONSTRAINT IF EXISTS group_member_rules_seen_fkey;
ALTER TABLE group_member DROP CONSTRAINT IF EXISTS group_member_rules_version_fkey;
ALTER TABLE group_member DROP COLUMN IF EXISTS rules_seen_version;
ALTER TABLE group_member DROP COLUMN IF EXISTS rules_version;
DROP FUNCTION IF EXISTS group_rules_latest(uuid);
DROP TRIGGER IF EXISTS group_rules_version_number ON group_rules_version;
DROP FUNCTION IF EXISTS number_rules_version();
DROP TRIGGER IF EXISTS group_rules_version_fixed ON group_rules_version;
DROP FUNCTION IF EXISTS refuse_rules_rewrite();
DROP TABLE IF EXISTS group_rules_version;
