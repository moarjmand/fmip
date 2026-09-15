-- Up Migration

-- T-252: reacting to a panel post, and following a contributor (blueprint 10.2).
--
-- **The whole task is that neither of these becomes posting access**, and the
-- schema is where that is settled rather than remembered. Two members are in
-- the room now: the approved contributor who may speak, and everybody else, who
-- may not. Anything given to the second group has to be checked against one
-- question -- can it be used to say something? -- because a way to say something
-- on a panel you were not approved for is the gate failing, whatever it is
-- called.
--
-- **A reaction is a closed set of six.** Not "emoji", not a short string: six
-- named values and nothing else. An open field would be a small free-text box
-- attached to somebody else's words, which is exactly the thing the approval
-- gate exists to withhold. The same argument `message_reaction` makes (T-225),
-- and it matters more here because this surface is public.
--
-- **A follow carries no payload at all.** Two ids and a timestamp. There is
-- nowhere in it to put a word.
--
-- Neither table asks `member_may_contribute`, and that is deliberate: reacting
-- and following are open to any member. A gate on them would be a second,
-- quieter approval nobody had decided to create.

-- ---------------------------------------------------------------------------
-- panel_reaction
-- ---------------------------------------------------------------------------
CREATE TABLE panel_reaction (
  post_id    uuid NOT NULL REFERENCES panel_post (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  reaction   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One of each per member per post: reacting twice is reacting once.
  CONSTRAINT panel_reaction_pkey PRIMARY KEY (post_id, user_id, reaction),
  -- The same six as `message_reaction`, deliberately. A member who learned what
  -- they mean in a conversation should not meet a different vocabulary on a
  -- match panel.
  CONSTRAINT panel_reaction_kind
    CHECK (reaction IN ('agree', 'disagree', 'laugh', 'surprise', 'sad', 'celebrate'))
);

CREATE INDEX panel_reaction_post_idx ON panel_reaction (post_id);

COMMENT ON TABLE panel_reaction IS
  'One member''s reaction to one panel post (blueprint 10.2, T-252). Open to any member; a closed set of six, because an open field would be a way to post without approval.';

-- A tombstone has nothing to react to, and a reaction on one would be a comment
-- on words that were taken down.
CREATE FUNCTION refuse_reaction_to_removed_post() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM panel_post WHERE id = NEW.post_id AND removed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'that post has been removed'
      USING ERRCODE = 'PL007', HINT = 'nothing to react to';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_reaction_to_removed_post() IS
  'Refuses a reaction to a removed panel post (T-252). SQLSTATE PL007.';

CREATE TRIGGER panel_reaction_removed_guard
  BEFORE INSERT ON panel_reaction
  FOR EACH ROW EXECUTE FUNCTION refuse_reaction_to_removed_post();

-- And the reactions a post already had go with it when it is taken down. Left
-- behind they would be a count attached to nothing, and on a moderated post a
-- visible tally of how many people had agreed with something removed.
CREATE FUNCTION clear_removed_panel_post_marks() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
    DELETE FROM panel_reaction WHERE post_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION clear_removed_panel_post_marks() IS
  'Drops the reactions on a panel post when it is tombstoned (T-252).';

CREATE TRIGGER panel_post_clear_marks
  BEFORE UPDATE ON panel_post
  FOR EACH ROW EXECUTE FUNCTION clear_removed_panel_post_marks();

-- ---------------------------------------------------------------------------
-- member_follow
-- ---------------------------------------------------------------------------
-- Following a contributor (blueprint 10.2). **Not `followed_entity`**, which
-- holds teams, competitions and football people, and which carries no foreign
-- key on `entity_id` because none of those is ever deleted. A member account
-- can be, and a follow row pointing at a deleted account would be a name in
-- somebody's list that resolves to nothing.
--
-- **Not `friendship` either.** A friendship is a mutual pair that both sides
-- agreed to (T-200); following is one-directional and needs nobody's consent,
-- which is the right shape for a public contributor and the wrong one for a
-- private member. What it does share with a friend request is the block: the
-- one thing following must never become is a way to keep hold of somebody who
-- got away from you.
CREATE TABLE member_follow (
  follower_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  followed_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_follow_pkey PRIMARY KEY (follower_id, followed_id),
  CONSTRAINT member_follow_not_self CHECK (follower_id <> followed_id)
);

-- "Who follows this contributor", which is the count shown beside them.
CREATE INDEX member_follow_followed_idx ON member_follow (followed_id);

COMMENT ON TABLE member_follow IS
  'One member following another, one-directionally (blueprint 10.2, T-252). Carries no payload: there is nowhere in it to put a word.';

CREATE FUNCTION refuse_follow_across_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF users_blocked(NEW.follower_id, NEW.followed_id) THEN
    RAISE EXCEPTION 'these members cannot reach each other'
      USING ERRCODE = 'PL003', HINT = 'one of them has blocked the other';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_follow_across_block() IS
  'Refuses a follow across a block, in either direction (T-252). SQLSTATE PL003.';

CREATE TRIGGER member_follow_block_guard
  BEFORE INSERT ON member_follow
  FOR EACH ROW EXECUTE FUNCTION refuse_follow_across_block();

-- A block ends an existing follow, in both directions, the same way it ends a
-- friendship (T-200). A block that left the follow in place would leave the
-- blocked member still receiving somebody, which is most of what they were
-- trying to stop.
CREATE FUNCTION drop_follows_on_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM member_follow
   WHERE (follower_id = NEW.blocker_id AND followed_id = NEW.blocked_id)
      OR (follower_id = NEW.blocked_id AND followed_id = NEW.blocker_id);
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION drop_follows_on_block() IS
  'Ends a follow in both directions when a block is created (T-252).';

CREATE TRIGGER user_block_drops_follows
  AFTER INSERT ON user_block
  FOR EACH ROW EXECUTE FUNCTION drop_follows_on_block();

-- Down Migration

DROP TRIGGER IF EXISTS user_block_drops_follows ON user_block;
DROP FUNCTION IF EXISTS drop_follows_on_block();
DROP TRIGGER IF EXISTS member_follow_block_guard ON member_follow;
DROP FUNCTION IF EXISTS refuse_follow_across_block();
DROP TABLE IF EXISTS member_follow;
DROP TRIGGER IF EXISTS panel_post_clear_marks ON panel_post;
DROP FUNCTION IF EXISTS clear_removed_panel_post_marks();
DROP TRIGGER IF EXISTS panel_reaction_removed_guard ON panel_reaction;
DROP FUNCTION IF EXISTS refuse_reaction_to_removed_post();
DROP TABLE IF EXISTS panel_reaction;
