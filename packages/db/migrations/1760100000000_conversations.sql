-- Up Migration

-- T-220: conversations (blueprint 8.3) — the message store, its ordering, and
-- every refusal that has to stand before the first message can be sent.
--
-- This is the surface D-053 put the whole moderation epic in front of. Nothing
-- here is new machinery for that: a block, a sanction and a ceiling already
-- exist, and this migration wires the same three into a new write path and
-- widens their lists to cover it, which is exactly what T-210 said each later
-- epic would do.
--
-- Four rules shape the schema.
--
-- **Order is a sequence, not a timestamp.** Blueprint 19 asks that messages
-- "arrive in real time and retain ordering", and `created_at` cannot carry
-- that: two messages in the same millisecond tie, and a clock that steps
-- backwards reorders a conversation retroactively. Each conversation has its own
-- counter, allocated under that conversation's row lock, so ordering is decided
-- once by the store. It is also what makes the realtime epic testable — a client
-- that reconnects asks "everything after 41", which is a question with one
-- answer.
--
-- **A message is never rewritten.** Blueprint 8.3 lists replies, reactions,
-- mentions and pins, and does **not** list editing. So there is no version
-- table here and no edit path: the only permitted UPDATE is the tombstone
-- below, and a trigger refuses every other change.
--
-- **Removal leaves a tombstone.** Moderation needs removal (10.4), and a
-- message that silently vanished would make the conversation around it
-- unreadable and the moderation record unverifiable. The row stays, the body
-- goes, and what remains says that it was removed and by whom.
--
-- **One direct conversation per pair**, stored as the ordered pair the same way
-- a friendship is (T-200), because two rows for one conversation is two
-- histories for one pair.

-- ---------------------------------------------------------------------------
-- conversation
-- ---------------------------------------------------------------------------
CREATE TABLE conversation (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- `group` joins this list in T-240, in the migration that builds groups.
  -- A kind nothing can create is a kind nothing should offer.
  kind       text NOT NULL,
  -- The pair, for a direct conversation. Ordered by CHECK like `friendship`.
  pair_low   uuid REFERENCES user_account (id) ON DELETE CASCADE,
  pair_high  uuid REFERENCES user_account (id) ON DELETE CASCADE,
  -- The next sequence number to hand out. Allocated under this row's lock, so
  -- two messages sent at the same instant cannot receive the same number.
  next_seq   bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_kind_check CHECK (kind IN ('direct')),
  CONSTRAINT conversation_direct_has_a_pair
    CHECK (
      (kind <> 'direct' AND pair_low IS NULL AND pair_high IS NULL)
      OR (kind = 'direct' AND pair_low IS NOT NULL AND pair_high IS NOT NULL
          AND pair_low < pair_high)
    ),
  CONSTRAINT conversation_next_seq_positive CHECK (next_seq >= 1)
);

-- Two conversations between the same two members is two histories for one pair.
CREATE UNIQUE INDEX conversation_one_per_pair
  ON conversation (pair_low, pair_high)
  WHERE kind = 'direct';

COMMENT ON TABLE conversation IS
  'One conversation and its sequence counter (blueprint 8.3, T-220). A direct one is the ordered pair, at most once.';

-- ---------------------------------------------------------------------------
-- conversation_participant
-- ---------------------------------------------------------------------------
-- Who is in it, whether they still are, and how far they have read.
CREATE TABLE conversation_participant (
  conversation_id uuid NOT NULL REFERENCES conversation (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  -- Every conversation can be left (blueprint 8.3). The row stays so the
  -- history stays readable to them and so rejoining is a fact rather than a
  -- guess; `left_at` is what stops them writing.
  left_at         timestamptz,
  muted_at        timestamptz,
  -- The highest sequence this member has seen. What an unread count is built
  -- from, and — in a direct conversation only — what a read receipt shows. In a
  -- two-hundred-person group it would be a surveillance feature nobody reads
  -- and everybody is subject to, so the product does not show it there.
  last_read_seq   bigint NOT NULL DEFAULT 0,
  CONSTRAINT conversation_participant_pkey PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_participant_read_not_negative CHECK (last_read_seq >= 0)
);

CREATE INDEX conversation_participant_user_idx
  ON conversation_participant (user_id, conversation_id);

COMMENT ON TABLE conversation_participant IS
  'One member in one conversation (T-220): when they joined, whether they left, whether it is muted, and how far they have read.';

-- ---------------------------------------------------------------------------
-- message
-- ---------------------------------------------------------------------------
CREATE TABLE message (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversation (id) ON DELETE CASCADE,
  -- Set by trigger from the conversation's counter. Never supplied by a caller:
  -- a sequence a client could choose is not a sequence.
  seq             bigint NOT NULL,
  author_id       uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  -- Null once removed. The tombstone below is the only way it becomes null.
  body            text,
  reply_to_id     uuid REFERENCES message (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  removed_by      uuid REFERENCES user_account (id) ON DELETE SET NULL,
  -- Who took it down. A reader can tell "the author thought better of it" from
  -- "a moderator took it down", and only one of those is a moderation record.
  removed_kind    text,
  CONSTRAINT message_seq_positive CHECK (seq >= 1),
  CONSTRAINT message_body_or_tombstone
    CHECK (
      (removed_at IS NULL AND body IS NOT NULL AND btrim(body) <> '')
      OR (removed_at IS NOT NULL AND body IS NULL)
    ),
  CONSTRAINT message_removal_is_whole
    CHECK (
      (removed_at IS NULL AND removed_by IS NULL AND removed_kind IS NULL)
      OR (removed_at IS NOT NULL AND removed_kind IN ('author', 'moderator'))
    ),
  CONSTRAINT message_seq_unique UNIQUE (conversation_id, seq)
);

-- "Everything after 41", which is the only question a reconnecting client asks.
CREATE INDEX message_conversation_seq_idx ON message (conversation_id, seq);
CREATE INDEX message_author_idx ON message (author_id, created_at DESC);

COMMENT ON TABLE message IS
  'One message (blueprint 8.3, T-220). Ordered by seq within its conversation, never edited, and removed by tombstone.';

-- ---------------------------------------------------------------------------
-- The refusals, in the order they fire
-- ---------------------------------------------------------------------------
-- Postgres runs BEFORE triggers in alphabetical order, so the names carry the
-- precedence: access < block < sanction < volume < write_sequence. A member who
-- is not in the conversation hears that first; a member who is both restricted
-- and over the ceiling hears about the restriction, which is the one they can
-- appeal; and the sequence number is allocated last, so a refused message never
-- spends one.

CREATE FUNCTION refuse_non_participant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participant
     WHERE conversation_id = NEW.conversation_id
       AND user_id = NEW.author_id
       AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not a participant in this conversation'
      USING ERRCODE = 'PL006', HINT = 'the author has left it or was never in it';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_non_participant() IS
  'Refuses a message from somebody who is not currently in the conversation (T-220). SQLSTATE PL006.';

CREATE TRIGGER message_access_guard
  BEFORE INSERT ON message
  FOR EACH ROW EXECUTE FUNCTION refuse_non_participant();

-- A block stops a pair reaching each other, and a direct conversation is
-- exactly a pair. `users_blocked` (T-200) is the one definition of that, asked
-- here rather than re-derived.
CREATE FUNCTION refuse_message_across_block() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  low  uuid;
  high uuid;
BEGIN
  SELECT pair_low, pair_high INTO low, high
    FROM conversation WHERE id = NEW.conversation_id AND kind = 'direct';

  IF low IS NOT NULL AND users_blocked(low, high) THEN
    RAISE EXCEPTION 'a block stands between these members'
      USING ERRCODE = 'PL003', HINT = 'one of them has blocked the other';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_message_across_block() IS
  'Refuses a message in a direct conversation when either member has blocked the other (T-220). SQLSTATE PL003.';

CREATE TRIGGER message_block_guard
  BEFORE INSERT ON message
  FOR EACH ROW EXECUTE FUNCTION refuse_message_across_block();

-- `messaging` joins the scopes a moderator may apply, in the migration that
-- builds the surface it restricts — which is what T-210 promised.
ALTER TABLE sanction DROP CONSTRAINT sanction_scope_kind;
ALTER TABLE sanction ADD CONSTRAINT sanction_scope_kind
  CHECK (scope IN ('contact', 'messaging'));

CREATE FUNCTION refuse_sanctioned_message() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF member_sanctioned(NEW.author_id, 'messaging') THEN
    RAISE EXCEPTION 'this member is under a messaging restriction'
      USING ERRCODE = 'PL004', HINT = 'a moderation sanction is in force';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_sanctioned_message() IS
  'Refuses a message from a member under an active messaging sanction (T-220). SQLSTATE PL004.';

CREATE TRIGGER message_sanction_guard
  BEFORE INSERT ON message
  FOR EACH ROW EXECUTE FUNCTION refuse_sanctioned_message();

-- The ceiling, from the generic counter of T-213. Two hundred an hour is a
-- conversation; it is not a script.
INSERT INTO rate_limit (action, per_hour) VALUES ('message', 200);

CREATE TRIGGER message_volume_guard
  BEFORE INSERT ON message
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('message', 'author_id');

-- Last, so nothing that was refused has spent a number.
CREATE FUNCTION allocate_message_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allocated bigint;
BEGIN
  UPDATE conversation
     SET next_seq = next_seq + 1
   WHERE id = NEW.conversation_id
  RETURNING next_seq - 1 INTO allocated;

  IF allocated IS NULL THEN
    RAISE EXCEPTION 'conversation % does not exist', NEW.conversation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.seq := allocated;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION allocate_message_sequence() IS
  'Takes the next sequence number under the conversation''s row lock (T-220). Ordering is the store''s, never a clock''s.';

CREATE TRIGGER message_write_sequence
  BEFORE INSERT ON message
  FOR EACH ROW EXECUTE FUNCTION allocate_message_sequence();

-- ---------------------------------------------------------------------------
-- A message is never rewritten
-- ---------------------------------------------------------------------------
-- The only permitted UPDATE is the tombstone. Editing is not in blueprint 8.3's
-- list of capabilities, and a message that can be changed after it was read is
-- a conversation nobody can quote.
CREATE FUNCTION refuse_message_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a message is removed by tombstone, never deleted'
      USING ERRCODE = 'PL007', HINT = 'set removed_at, removed_by and removed_kind';
  END IF;

  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'this message has already been removed'
      USING ERRCODE = 'PL007';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'a message may only be removed, not edited'
      USING ERRCODE = 'PL007', HINT = 'blueprint 8.3 has no edit';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_message_rewrite() IS
  'Allows only the tombstone UPDATE on a message, and no DELETE at all (T-220). SQLSTATE PL007.';

CREATE TRIGGER message_no_rewrite
  BEFORE UPDATE OR DELETE ON message
  FOR EACH ROW EXECUTE FUNCTION refuse_message_rewrite();

-- ---------------------------------------------------------------------------
-- A message becomes reportable
-- ---------------------------------------------------------------------------
-- Again in the migration that builds the surface, so the moderation team is
-- never offered a subject nothing can produce.
ALTER TABLE report DROP CONSTRAINT report_subject_kind;
ALTER TABLE report ADD CONSTRAINT report_subject_kind
  CHECK (subject_type IN ('member', 'message'));

ALTER TABLE moderation_decision DROP CONSTRAINT moderation_decision_subject_kind;
ALTER TABLE moderation_decision ADD CONSTRAINT moderation_decision_subject_kind
  CHECK (subject_type IN ('member', 'message'));

-- The self-report CHECK named `member` explicitly, so it still means what it
-- meant; this re-states it rather than leaving a reader to check.
COMMENT ON CONSTRAINT report_not_self ON report IS
  'Reporting your own account. A message of your own is reportable in principle and pointless in practice; the API refuses it.';

-- Down Migration

DROP TRIGGER IF EXISTS message_no_rewrite ON message;
DROP TRIGGER IF EXISTS message_write_sequence ON message;
DROP TRIGGER IF EXISTS message_volume_guard ON message;
DROP TRIGGER IF EXISTS message_sanction_guard ON message;
DROP TRIGGER IF EXISTS message_block_guard ON message;
DROP TRIGGER IF EXISTS message_access_guard ON message;
DROP FUNCTION IF EXISTS refuse_message_rewrite();
DROP FUNCTION IF EXISTS allocate_message_sequence();
DROP FUNCTION IF EXISTS refuse_sanctioned_message();
DROP FUNCTION IF EXISTS refuse_message_across_block();
DROP FUNCTION IF EXISTS refuse_non_participant();
DROP TABLE IF EXISTS message;
DROP TABLE IF EXISTS conversation_participant;
DROP TABLE IF EXISTS conversation;
DELETE FROM rate_limit WHERE action = 'message';
ALTER TABLE moderation_decision DROP CONSTRAINT moderation_decision_subject_kind;
ALTER TABLE moderation_decision ADD CONSTRAINT moderation_decision_subject_kind
  CHECK (subject_type IN ('member'));
ALTER TABLE report DROP CONSTRAINT report_subject_kind;
ALTER TABLE report ADD CONSTRAINT report_subject_kind CHECK (subject_type IN ('member'));
ALTER TABLE sanction DROP CONSTRAINT sanction_scope_kind;
ALTER TABLE sanction ADD CONSTRAINT sanction_scope_kind CHECK (scope IN ('contact'));
