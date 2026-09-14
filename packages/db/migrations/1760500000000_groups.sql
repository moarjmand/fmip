-- Up Migration

-- T-240: groups (blueprint 8.2, and the exclusive groups of 10.1).
--
-- **Three visibilities, and the middle one is why there are three.** A boolean
-- would give public and private and lose the case the blueprint asked for:
-- discoverable-private, a group that can be *found* but not *read*. That is what
-- makes joining possible without making membership public, and it is the whole
-- reason this column is not `is_public boolean`.
--
-- **The exclusive groups of 10.1 are not a second mechanism.** They are
-- invite-only groups whose invitations are issued under a privilege the founder
-- grants. A separate table would duplicate every membership rule here and
-- guarantee the two copies drift.
--
-- **How you join follows from the visibility, deliberately.** Public: you join.
-- Discoverable: you ask, and an owner or moderator answers. Invite-only: you are
-- invited, and there is nothing to ask for -- which is what invite-only means.
-- The alternative was a second column, a join policy, crossed with visibility:
-- nine combinations of which several mean nothing ("invite-only but anyone may
-- join"). If a group ever needs to be readable by everyone and still approve its
-- members, that column is the extension point, and it should arrive with the
-- case that needs it rather than ahead of it.

-- ---------------------------------------------------------------------------
-- user_group
-- ---------------------------------------------------------------------------
-- Named `user_group` because `group` is a reserved word; the same shape as
-- `user_account`, `user_block` and `user_prediction` beside it.
CREATE TABLE user_group (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The handle in a URL, the way `username` is. Lower-case and narrow, so it
  -- can never need escaping or normalising to be compared.
  slug        text NOT NULL,
  -- What a reader sees. Changeable, unlike the slug.
  name        text NOT NULL,
  description text,
  visibility  text NOT NULL,
  -- Who made it. Provenance, not authority: authority lives in `group_member`,
  -- and a creator who left years ago should neither block their own account
  -- deletion nor take the group with them.
  created_by  uuid REFERENCES user_account (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_group_slug_unique UNIQUE (slug),
  CONSTRAINT user_group_slug_shape CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  CONSTRAINT user_group_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  CONSTRAINT user_group_description_length CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT user_group_visibility_kind
    CHECK (visibility IN ('public', 'discoverable', 'invite_only'))
);

COMMENT ON TABLE user_group IS
  'A group (blueprint 8.2, T-240). Three visibilities, because discoverable-private -- found but not read -- is the case a boolean would lose.';

COMMENT ON COLUMN user_group.slug IS
  'The handle in a URL. Never changes: a group link is shared into conversations, and a renamed slug would break every share silently (T-240).';

CREATE TRIGGER user_group_updated_at
  BEFORE UPDATE ON user_group
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A renamed slug breaks every link already shared. The display name is what
-- changes; this is what a link points at.
CREATE FUNCTION refuse_slug_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'a group slug never changes'
      USING ERRCODE = 'PL008', HINT = 'change the name instead';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_slug_change() IS
  'Refuses a change to user_group.slug (T-240). SQLSTATE PL008: a link already shared would break silently.';

CREATE TRIGGER user_group_slug_is_fixed
  BEFORE UPDATE ON user_group
  FOR EACH ROW EXECUTE FUNCTION refuse_slug_change();

-- The directory search (T-242), over the same normalisation the rest of the
-- product uses (T-038, T-152). Partial: an invite-only group is not findable,
-- so it has no business in the index a search reads.
CREATE INDEX user_group_name_search_idx
  ON user_group USING gin (search_key(name) gin_trgm_ops)
  WHERE visibility <> 'invite_only';

-- ---------------------------------------------------------------------------
-- group_member
-- ---------------------------------------------------------------------------
CREATE TABLE group_member (
  group_id  uuid NOT NULL REFERENCES user_group (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_member_pkey PRIMARY KEY (group_id, user_id),
  CONSTRAINT group_member_role_kind CHECK (role IN ('owner', 'moderator', 'member'))
);

CREATE INDEX group_member_user_idx ON group_member (user_id, group_id);

COMMENT ON TABLE group_member IS
  'Who is in a group and in what role (T-240). Exactly one owner, enforced by a unique index and a deferred constraint trigger.';

-- **At most one owner**, as an index rather than a rule somebody has to
-- remember.
CREATE UNIQUE INDEX group_member_one_owner
  ON group_member (group_id)
  WHERE role = 'owner';

-- **At least one owner**, checked at commit rather than per statement.
--
-- Deferred on purpose: handing ownership over is demote-then-promote, and a
-- per-statement check would refuse the moment in between and make the safe
-- operation impossible. The transaction as a whole is what has to be true.
CREATE FUNCTION group_must_have_one_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  -- The column naming the group, taken through `to_jsonb` because this one
  -- function guards two tables whose records have different shapes: `id` on
  -- `user_group`, `group_id` on `group_member`.
  IF TG_OP = 'INSERT' THEN
    target := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  ELSE
    target := (to_jsonb(OLD) ->> TG_ARGV[0])::uuid;
  END IF;

  -- The group itself is gone (a cascade), so there is nothing to own.
  IF NOT EXISTS (SELECT 1 FROM user_group WHERE id = target) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_member WHERE group_id = target AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'a group must have an owner'
      USING ERRCODE = 'PL009',
            HINT = 'hand ownership to somebody else in the same transaction, or delete the group';
  END IF;

  RETURN NULL;
END
$$;

COMMENT ON FUNCTION group_must_have_one_owner() IS
  'Refuses a transaction that would leave a group with no owner (T-240). SQLSTATE PL009. Deferred, so handing ownership over -- demote then promote -- is one legal transaction.';

CREATE CONSTRAINT TRIGGER user_group_has_an_owner
  AFTER INSERT ON user_group
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION group_must_have_one_owner('id');

CREATE CONSTRAINT TRIGGER group_member_leaves_an_owner
  AFTER UPDATE OR DELETE ON group_member
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION group_must_have_one_owner('group_id');

-- ---------------------------------------------------------------------------
-- group_invite
-- ---------------------------------------------------------------------------
-- An open offer, with no history of refusals -- the same shape as
-- `friend_request` (T-200). Accept, decline and withdraw all delete the row,
-- because a table of declined invitations is a record of who said no to whom
-- and nothing in the product needs it.
CREATE TABLE group_invite (
  group_id   uuid NOT NULL REFERENCES user_group (id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_invite_pkey PRIMARY KEY (group_id, invitee_id),
  CONSTRAINT group_invite_not_self CHECK (invitee_id <> invited_by)
);

CREATE INDEX group_invite_invitee_idx ON group_invite (invitee_id, created_at DESC);

COMMENT ON TABLE group_invite IS
  'An open invitation to a group (T-240). No status column: accept, decline and withdraw all delete the row.';

-- ---------------------------------------------------------------------------
-- group_join_request
-- ---------------------------------------------------------------------------
CREATE TABLE group_join_request (
  group_id   uuid NOT NULL REFERENCES user_group (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_join_request_pkey PRIMARY KEY (group_id, user_id),
  CONSTRAINT group_join_request_note_length CHECK (note IS NULL OR char_length(note) <= 300)
);

CREATE INDEX group_join_request_group_idx ON group_join_request (group_id, created_at);

COMMENT ON TABLE group_join_request IS
  'Somebody asking to join a discoverable group (T-240). One open request per member per group, so a refused asker cannot fill a queue.';

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------
-- The moderation lists widen here, in the migration that builds the surface
-- they cover -- never ahead of it, because a scope nothing enforces tells the
-- moderation team a restriction is in force when it is not (T-210).
ALTER TABLE sanction DROP CONSTRAINT sanction_scope_kind;
ALTER TABLE sanction ADD CONSTRAINT sanction_scope_kind
  CHECK (scope IN ('contact', 'messaging', 'groups'));

ALTER TABLE report DROP CONSTRAINT report_subject_kind;
ALTER TABLE report ADD CONSTRAINT report_subject_kind
  CHECK (subject_type IN ('member', 'message', 'group'));

ALTER TABLE moderation_decision DROP CONSTRAINT moderation_decision_subject_kind;
ALTER TABLE moderation_decision ADD CONSTRAINT moderation_decision_subject_kind
  CHECK (subject_type IN ('member', 'message', 'group'));

-- A `groups` sanction stops the two outward moves: making a group, and joining
-- one. It does not stop reading or leaving, for the same reason a `contact`
-- sanction never stopped anybody blocking or reporting -- the way out of a
-- place is not a privilege.
CREATE FUNCTION refuse_sanctioned_group() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid;
BEGIN
  actor := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;

  IF member_sanctioned(actor, 'groups') THEN
    RAISE EXCEPTION 'a sanction stands against this member'
      USING ERRCODE = 'PL004', HINT = 'groups';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_sanctioned_group() IS
  'Refuses creating or joining a group under an active groups sanction (T-240). SQLSTATE PL004.';

CREATE TRIGGER user_group_sanction_guard
  BEFORE INSERT ON user_group
  FOR EACH ROW EXECUTE FUNCTION refuse_sanctioned_group('created_by');

CREATE TRIGGER group_member_sanction_guard
  BEFORE INSERT ON group_member
  FOR EACH ROW EXECUTE FUNCTION refuse_sanctioned_group('user_id');

-- An invitation is a way of reaching somebody, so it answers the same two
-- questions a friend request does (T-200, T-210): is there a block, and is the
-- inviter under a contact sanction.
CREATE FUNCTION refuse_invite_across_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF users_blocked(NEW.invited_by, NEW.invitee_id) THEN
    RAISE EXCEPTION 'a block stands between these members'
      USING ERRCODE = 'PL003', HINT = 'an invitation is a way of reaching somebody';
  END IF;

  IF member_sanctioned(NEW.invited_by, 'contact') THEN
    RAISE EXCEPTION 'a sanction stands against this member'
      USING ERRCODE = 'PL004', HINT = 'contact';
  END IF;

  -- Inviting somebody who is already in the group is not an offer, it is noise
  -- in their inbox.
  IF EXISTS (
    SELECT 1 FROM group_member
     WHERE group_id = NEW.group_id AND user_id = NEW.invitee_id
  ) THEN
    RAISE EXCEPTION 'that member is already in this group'
      USING ERRCODE = 'PL010';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_invite_across_block() IS
  'Refuses a group invitation across a block (PL003), under a contact sanction (PL004), or to somebody already a member (PL010). T-240.';

CREATE TRIGGER group_invite_guard
  BEFORE INSERT ON group_invite
  FOR EACH ROW EXECUTE FUNCTION refuse_invite_across_block();

-- **An invite-only group is not joinable, and a public one is not askable.**
-- The join route follows from the visibility, and asking down the wrong route
-- is refused here rather than filtered in a query somewhere.
CREATE FUNCTION refuse_join_request_out_of_place() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  how text;
BEGIN
  SELECT visibility INTO how FROM user_group WHERE id = NEW.group_id;

  IF how = 'invite_only' THEN
    RAISE EXCEPTION 'this group is joined by invitation'
      USING ERRCODE = 'PL011';
  END IF;

  IF how = 'public' THEN
    RAISE EXCEPTION 'this group is open; join it rather than asking'
      USING ERRCODE = 'PL011';
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_member WHERE group_id = NEW.group_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'that member is already in this group'
      USING ERRCODE = 'PL010';
  END IF;

  IF member_sanctioned(NEW.user_id, 'groups') THEN
    RAISE EXCEPTION 'a sanction stands against this member'
      USING ERRCODE = 'PL004', HINT = 'groups';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_join_request_out_of_place() IS
  'Refuses a join request to an invite-only or public group (PL011), from an existing member (PL010), or under a groups sanction (PL004). T-240.';

CREATE TRIGGER group_join_request_guard
  BEFORE INSERT ON group_join_request
  FOR EACH ROW EXECUTE FUNCTION refuse_join_request_out_of_place();

-- ---------------------------------------------------------------------------
-- Ceilings
-- ---------------------------------------------------------------------------
-- The same mechanism as every other ceiling (T-213), as rows an administrator
-- can change rather than numbers compiled in. Named so they fire after the
-- guards above -- alphabetical order, and `volume` is late in it -- because a
-- member who is both sanctioned and over the ceiling should hear about the
-- sanction, which is the one they can appeal.
INSERT INTO rate_limit (action, per_hour) VALUES
  ('group_create', 5),
  ('group_invite', 50),
  ('group_join_request', 20);

CREATE TRIGGER user_group_volume_guard
  BEFORE INSERT ON user_group
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('group_create', 'created_by');

CREATE TRIGGER group_invite_volume_guard
  BEFORE INSERT ON group_invite
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('group_invite', 'invited_by');

CREATE TRIGGER group_join_request_volume_guard
  BEFORE INSERT ON group_join_request
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('group_join_request', 'user_id');

-- Down Migration

DROP TRIGGER IF EXISTS group_join_request_volume_guard ON group_join_request;
DROP TRIGGER IF EXISTS group_invite_volume_guard ON group_invite;
DROP TRIGGER IF EXISTS user_group_volume_guard ON user_group;
DELETE FROM rate_limit WHERE action IN ('group_create', 'group_invite', 'group_join_request');

DROP TRIGGER IF EXISTS group_join_request_guard ON group_join_request;
DROP FUNCTION IF EXISTS refuse_join_request_out_of_place();
DROP TRIGGER IF EXISTS group_invite_guard ON group_invite;
DROP FUNCTION IF EXISTS refuse_invite_across_block();
DROP TRIGGER IF EXISTS group_member_sanction_guard ON group_member;
DROP TRIGGER IF EXISTS user_group_sanction_guard ON user_group;
DROP FUNCTION IF EXISTS refuse_sanctioned_group();

ALTER TABLE moderation_decision DROP CONSTRAINT moderation_decision_subject_kind;
ALTER TABLE moderation_decision ADD CONSTRAINT moderation_decision_subject_kind
  CHECK (subject_type IN ('member', 'message'));
ALTER TABLE report DROP CONSTRAINT report_subject_kind;
ALTER TABLE report ADD CONSTRAINT report_subject_kind
  CHECK (subject_type IN ('member', 'message'));
ALTER TABLE sanction DROP CONSTRAINT sanction_scope_kind;
ALTER TABLE sanction ADD CONSTRAINT sanction_scope_kind
  CHECK (scope IN ('contact', 'messaging'));

DROP TABLE IF EXISTS group_join_request;
DROP TABLE IF EXISTS group_invite;
DROP TRIGGER IF EXISTS group_member_leaves_an_owner ON group_member;
DROP TRIGGER IF EXISTS user_group_has_an_owner ON user_group;
DROP FUNCTION IF EXISTS group_must_have_one_owner();
DROP TABLE IF EXISTS group_member;
DROP TRIGGER IF EXISTS user_group_slug_is_fixed ON user_group;
DROP FUNCTION IF EXISTS refuse_slug_change();
DROP TABLE IF EXISTS user_group;
