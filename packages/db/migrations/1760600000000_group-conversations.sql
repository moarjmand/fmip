-- Up Migration

-- T-245: a group has a conversation, and its membership is the group's.
--
-- **The acceptance criterion is "membership changes take effect on the
-- conversation immediately", and there are two ways to get that.**
--
-- One mirrors `group_member` into `conversation_participant` with triggers:
-- join writes a participant row, leaving sets `left_at`, a removed member gets
-- the same treatment. Two records of who is in the room, kept in step by code
-- that has to be right every time, and "immediate" only for as long as the
-- mirror is.
--
-- The other lets `group_member` **be** the membership, and leaves
-- `conversation_participant` holding what it is actually for -- the read
-- position and the mute -- with no authority at all. Nothing to synchronise, so
-- nothing can drift, and the criterion holds by construction rather than by
-- vigilance.
--
-- This is the second. `refuse_non_participant()` is replaced by one that
-- branches on the conversation's kind, and a participant row for a group is
-- written the first time somebody reads or mutes rather than the moment they
-- join.
--
-- **A block does not keep two members out of one room.** The message block
-- guard was written direct-only in T-220 and stays that way. Two members who
-- have blocked each other can share a group; what a block stops there is
-- reaching *each other* -- which is why the mention guard of T-225 exists at
-- all, and why it has been waiting for this migration to become reachable.

-- ---------------------------------------------------------------------------
-- A conversation may belong to a group
-- ---------------------------------------------------------------------------
ALTER TABLE conversation ADD COLUMN group_id uuid REFERENCES user_group (id) ON DELETE CASCADE;

ALTER TABLE conversation DROP CONSTRAINT conversation_kind_check;
ALTER TABLE conversation ADD CONSTRAINT conversation_kind_check
  CHECK (kind IN ('direct', 'group'));

-- The same shape as the pair: whichever kind it is, the other kind's columns
-- are empty, so a row can never be half of each.
ALTER TABLE conversation ADD CONSTRAINT conversation_group_has_a_group
  CHECK (
    (kind <> 'group' AND group_id IS NULL)
    OR (kind = 'group' AND group_id IS NOT NULL AND pair_low IS NULL AND pair_high IS NULL)
  );

-- One conversation per group. A group with two would be a group whose members
-- are talking in two rooms and can see only one of them.
CREATE UNIQUE INDEX conversation_one_per_group ON conversation (group_id)
  WHERE group_id IS NOT NULL;

COMMENT ON COLUMN conversation.group_id IS
  'The group this conversation belongs to (T-245). Its membership is the group''s: `conversation_participant` holds the read position and the mute, and no authority.';

-- ---------------------------------------------------------------------------
-- Who may write here
-- ---------------------------------------------------------------------------
-- Replaces the T-220 function. A direct conversation still asks
-- `conversation_participant`, because there is nowhere else its membership
-- lives. A group conversation asks `group_member`, because that is where its
-- membership lives -- and asking the place the membership is kept is what makes
-- a change to it immediate.
CREATE OR REPLACE FUNCTION refuse_non_participant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  room_kind text;
  room_group uuid;
BEGIN
  SELECT kind, group_id INTO room_kind, room_group
    FROM conversation WHERE id = NEW.conversation_id;

  IF room_kind = 'group' THEN
    IF NOT EXISTS (
      SELECT 1 FROM group_member
       WHERE group_id = room_group AND user_id = NEW.author_id
    ) THEN
      RAISE EXCEPTION 'not a participant in this conversation'
        USING ERRCODE = 'PL006';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM conversation_participant
     WHERE conversation_id = NEW.conversation_id
       AND user_id = NEW.author_id
       AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not a participant in this conversation'
      USING ERRCODE = 'PL006';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_non_participant() IS
  'Refuses a message from somebody not in the conversation (T-220, widened for groups in T-245). A direct conversation asks conversation_participant; a group asks group_member, which is where a group''s membership actually lives. SQLSTATE PL006.';

-- ---------------------------------------------------------------------------
-- A group is a thing that can be reported, and its conversation is a place
-- ---------------------------------------------------------------------------
-- `messaging` already covers a group conversation: the sanction guard on
-- `message` (T-220) never asked which kind of conversation it was, so a member
-- restricted from messaging is restricted here too, with nothing to widen.

-- Down Migration

CREATE OR REPLACE FUNCTION refuse_non_participant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participant
     WHERE conversation_id = NEW.conversation_id
       AND user_id = NEW.author_id
       AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not a participant in this conversation'
      USING ERRCODE = 'PL006';
  END IF;
  RETURN NEW;
END
$$;

DROP INDEX IF EXISTS conversation_one_per_group;
ALTER TABLE conversation DROP CONSTRAINT IF EXISTS conversation_group_has_a_group;
ALTER TABLE conversation DROP CONSTRAINT conversation_kind_check;
ALTER TABLE conversation ADD CONSTRAINT conversation_kind_check CHECK (kind IN ('direct'));
ALTER TABLE conversation DROP COLUMN IF EXISTS group_id;
