-- Up Migration

-- T-244: a match thread inside a group.
--
-- **"A thread is a conversation about a fixture, and says which."** The
-- acceptance criterion is two clauses and both of them are load-bearing.
--
-- *A conversation.* Not a new kind of place with its own membership, its own
-- read position, its own mute and its own delivery. A group's members are
-- already in the group's room (T-245, D-058) and a thread is another room they
-- are already in -- so it inherits everything: `group_member` is its membership,
-- `conversation_participant` holds the read position and the mute and no
-- authority, the socket delivers it (T-230), the search finds it (T-224), the
-- catch-up fills it (T-235) and a sanction on `messaging` silences it. None of
-- that is written here, which is the point of making it a conversation.
--
-- *About a fixture, and says which.* `fixture_id` is on the row, not in the
-- name. A thread whose subject lived in a title would be a thread the product
-- could not link to a match, could not list under one, and could not stop being
-- duplicated -- which is what the unique index below is for.
--
-- **The one-per-group index has to be narrowed, and forgetting that would have
-- been the whole bug.** `conversation_one_per_group` was written when a group
-- had exactly one conversation. Left alone it refuses a group its first thread,
-- and it refuses it at insert time with a duplicate-key error nobody would read
-- as "threads are not implemented". It now applies to the group's own room, and
-- threads get an index of their own.

-- ---------------------------------------------------------------------------
-- A conversation may be about a fixture
-- ---------------------------------------------------------------------------
-- RESTRICT, not CASCADE: a fixture with a thread is a fixture people have
-- written about, and deleting the match should not quietly delete what they
-- said. Fixtures are canonical (rule 1) and are not deleted in the ordinary
-- run of things; if one ever must be, the thread is a reason to look first.
ALTER TABLE conversation ADD COLUMN fixture_id uuid REFERENCES fixture (id) ON DELETE RESTRICT;

-- Who opened it. SET NULL rather than CASCADE, for the reason every other
-- authored row in this schema keeps: a member leaving does not un-say what was
-- said, and the thread belongs to the group rather than to whoever started it.
ALTER TABLE conversation ADD COLUMN opened_by uuid REFERENCES user_account (id) ON DELETE SET NULL;

ALTER TABLE conversation DROP CONSTRAINT conversation_kind_check;
ALTER TABLE conversation ADD CONSTRAINT conversation_kind_check
  CHECK (kind IN ('direct', 'group', 'group_thread'));

-- The same shape rule as before, with the third kind spelled out rather than
-- folded into the second: whichever kind a row is, every other kind's columns
-- are empty, so a row can never be half of two things.
ALTER TABLE conversation DROP CONSTRAINT conversation_group_has_a_group;
ALTER TABLE conversation ADD CONSTRAINT conversation_kind_has_its_columns
  CHECK (
    (kind = 'direct'
       AND group_id IS NULL AND fixture_id IS NULL AND opened_by IS NULL)
    OR (kind = 'group'
       AND group_id IS NOT NULL AND fixture_id IS NULL AND opened_by IS NULL
       AND pair_low IS NULL AND pair_high IS NULL)
    OR (kind = 'group_thread'
       AND group_id IS NOT NULL AND fixture_id IS NOT NULL
       AND pair_low IS NULL AND pair_high IS NULL)
  );

-- The group's own room stays one per group. Threads are not that room.
DROP INDEX conversation_one_per_group;
CREATE UNIQUE INDEX conversation_one_per_group ON conversation (group_id)
  WHERE kind = 'group';

-- One thread per fixture per group. Two threads about one match in one group
-- would split the conversation the group came to have, and whichever half a
-- member found first would look like all of it.
CREATE UNIQUE INDEX conversation_one_thread_per_fixture
  ON conversation (group_id, fixture_id)
  WHERE kind = 'group_thread';

CREATE INDEX conversation_threads_by_fixture ON conversation (fixture_id)
  WHERE kind = 'group_thread';

COMMENT ON COLUMN conversation.fixture_id IS
  'The fixture a group thread is about (T-244). On the row rather than in a title, so the thread can be listed under its match, linked to it, and kept unique per group.';
COMMENT ON COLUMN conversation.opened_by IS
  'Who opened a group thread (T-244). Null once that account is gone: the thread belongs to the group, not to whoever started it.';

-- ---------------------------------------------------------------------------
-- Who may write here
-- ---------------------------------------------------------------------------
-- The T-245 function, widened by one word. A thread's membership is the
-- group's, for the same reason the group's room's is: it is the same people in
-- the same place talking about one match, and a second record of who they are
-- is a second record that can drift.
CREATE OR REPLACE FUNCTION refuse_non_participant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  room_kind text;
  room_group uuid;
BEGIN
  SELECT kind, group_id INTO room_kind, room_group
    FROM conversation WHERE id = NEW.conversation_id;

  IF room_kind IN ('group', 'group_thread') THEN
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
  'Refuses a message from somebody not in the conversation (T-220, widened for groups in T-245 and for group threads in T-244). A direct conversation asks conversation_participant; a group and its threads ask group_member, which is where a group''s membership actually lives. SQLSTATE PL006.';

-- ---------------------------------------------------------------------------
-- Only a member opens a thread, and not without limit
-- ---------------------------------------------------------------------------
-- The membership half is not the API's to be trusted with: a thread opened in a
-- group the opener is not in would be a room they could then write in, because
-- the write guard above asks the group rather than the row.
CREATE OR REPLACE FUNCTION refuse_thread_from_outside() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Not a thread, or a thread with no group at all: the shape constraint is
  -- the one that should answer a malformed row, and a BEFORE trigger reaches
  -- it first. "Only a member can open a thread" is a true sentence about a row
  -- that names a group; about a row that names none it is a misdiagnosis.
  IF NEW.kind <> 'group_thread' OR NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- `opened_by` is nullable because an account can go and the thread stays with
  -- the group (ON DELETE SET NULL). At insert it is required, and nobody is not
  -- a member of anything.
  IF NOT EXISTS (
    SELECT 1 FROM group_member
     WHERE group_id = NEW.group_id AND user_id = NEW.opened_by
  ) THEN
    RAISE EXCEPTION 'only a member of this group can open a thread in it'
      USING ERRCODE = 'PL012';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_thread_from_outside() IS
  'Refuses a group thread opened by somebody outside the group (T-244). SQLSTATE PL012.';

CREATE TRIGGER conversation_thread_guard
  BEFORE INSERT ON conversation
  FOR EACH ROW EXECUTE FUNCTION refuse_thread_from_outside();

-- The same mechanism as every other ceiling (T-213), as a row an administrator
-- can change. Named `volume` so it fires after the guard above in alphabetical
-- order: somebody who is both outside the group and over the ceiling should
-- hear the first thing, which is the true one.
INSERT INTO rate_limit (action, per_hour) VALUES ('group_thread', 20);

-- The `opened_by IS NOT NULL` half is not belt and braces: a row with no opener
-- is one the guard above has already refused, or -- if it names no group either
-- -- one the shape constraint should refuse, and a ceiling counting a null
-- member would fail with a message about a column instead.
CREATE TRIGGER conversation_volume_guard
  BEFORE INSERT ON conversation
  FOR EACH ROW WHEN (NEW.kind = 'group_thread' AND NEW.opened_by IS NOT NULL)
  EXECUTE FUNCTION refuse_over_rate('group_thread', 'opened_by');

-- Down Migration

DROP TRIGGER IF EXISTS conversation_volume_guard ON conversation;
DELETE FROM rate_limit WHERE action = 'group_thread';
DROP TRIGGER IF EXISTS conversation_thread_guard ON conversation;
DROP FUNCTION IF EXISTS refuse_thread_from_outside();

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

DROP INDEX IF EXISTS conversation_threads_by_fixture;
DROP INDEX IF EXISTS conversation_one_thread_per_fixture;
DROP INDEX IF EXISTS conversation_one_per_group;
DELETE FROM conversation WHERE kind = 'group_thread';
CREATE UNIQUE INDEX conversation_one_per_group ON conversation (group_id)
  WHERE group_id IS NOT NULL;

ALTER TABLE conversation DROP CONSTRAINT IF EXISTS conversation_kind_has_its_columns;
ALTER TABLE conversation ADD CONSTRAINT conversation_group_has_a_group
  CHECK (
    (kind <> 'group' AND group_id IS NULL)
    OR (kind = 'group' AND group_id IS NOT NULL AND pair_low IS NULL AND pair_high IS NULL)
  );

ALTER TABLE conversation DROP CONSTRAINT conversation_kind_check;
ALTER TABLE conversation ADD CONSTRAINT conversation_kind_check
  CHECK (kind IN ('direct', 'group'));

ALTER TABLE conversation DROP COLUMN IF EXISTS opened_by;
ALTER TABLE conversation DROP COLUMN IF EXISTS fixture_id;
