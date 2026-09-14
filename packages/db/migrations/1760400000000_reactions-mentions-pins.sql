-- Up Migration

-- T-225: reactions, mentions and pinned messages (blueprint 8.3).
--
-- The blueprint's sentence is "Replies, reactions, mentions and pinned
-- messages". `reply_to_id` was a column in T-220; these are the other three,
-- and each is a row of its own rather than a field on the message — because a
-- message is never rewritten (T-220) and all three of these change after it was
-- sent.
--
-- **A closed set of reactions.** An open `emoji text` column is a small
-- free-text field attached to somebody else's words, which is a place abuse
-- goes when the big field is moderated and the small one is not. Six is enough
-- to agree, disagree, laugh and commiserate, which is what a football
-- conversation does with them.
--
-- **A mention is stored, not parsed at read time.** Who was mentioned is a fact
-- about the moment the message was written: resolving `@name` again later would
-- change who a two-year-old message mentioned every time somebody renames
-- themselves.
--
-- **A pin is a row, not a column on the message.** `message` allows exactly one
-- UPDATE, the tombstone (T-220, PL007), and pinning is not it. Keeping the pin
-- outside means that rule stays absolute.

-- ---------------------------------------------------------------------------
-- message_reaction
-- ---------------------------------------------------------------------------
CREATE TABLE message_reaction (
  message_id uuid NOT NULL REFERENCES message (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  reaction   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One of each per member per message: reacting twice is reacting once.
  CONSTRAINT message_reaction_pkey PRIMARY KEY (message_id, user_id, reaction),
  CONSTRAINT message_reaction_kind
    CHECK (reaction IN ('agree', 'disagree', 'laugh', 'surprise', 'sad', 'celebrate'))
);

CREATE INDEX message_reaction_message_idx ON message_reaction (message_id);

COMMENT ON TABLE message_reaction IS
  'One member''s reaction to one message (blueprint 8.3, T-225). A closed set: an open emoji field is a small free-text box attached to somebody else''s words.';

-- ---------------------------------------------------------------------------
-- message_mention
-- ---------------------------------------------------------------------------
-- Who a message named, as it was written. The API resolves `@name` once, on
-- write, against the people already in the conversation.
CREATE TABLE message_mention (
  message_id uuid NOT NULL REFERENCES message (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  CONSTRAINT message_mention_pkey PRIMARY KEY (message_id, user_id)
);

CREATE INDEX message_mention_user_idx ON message_mention (user_id);

COMMENT ON TABLE message_mention IS
  'Who a message named (T-225), resolved once when it was written so a later rename cannot change who a past message mentioned.';

-- ---------------------------------------------------------------------------
-- conversation_pin
-- ---------------------------------------------------------------------------
-- Outside `message` so that its one-permitted-UPDATE rule stays absolute.
CREATE TABLE conversation_pin (
  conversation_id uuid NOT NULL REFERENCES conversation (id) ON DELETE CASCADE,
  -- One pin per message; a message belongs to one conversation, so the pair is
  -- checked rather than assumed.
  message_id      uuid PRIMARY KEY REFERENCES message (id) ON DELETE CASCADE,
  pinned_by       uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  pinned_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversation_pin_conversation_idx ON conversation_pin (conversation_id, pinned_at DESC);

COMMENT ON TABLE conversation_pin IS
  'A message pinned in its conversation (blueprint 8.2 and 8.3, T-225). A row rather than a column, because a message takes exactly one UPDATE and it is the tombstone.';

-- ---------------------------------------------------------------------------
-- Who may react, mention and pin
-- ---------------------------------------------------------------------------
-- The same three questions the message itself had to answer (T-220), asked
-- again because these are writes of their own: are you in this conversation,
-- is there a block, and does this message still stand.
CREATE FUNCTION refuse_reaction_from_outside() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  room    uuid;
  removed timestamptz;
  low     uuid;
  high    uuid;
BEGIN
  SELECT m.conversation_id, m.removed_at INTO room, removed
    FROM message m WHERE m.id = NEW.message_id;

  IF removed IS NOT NULL THEN
    -- A tombstone has nothing to react to, and a reaction on one would be a
    -- comment on words that were taken down.
    RAISE EXCEPTION 'that message has been removed'
      USING ERRCODE = 'PL007';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM conversation_participant
     WHERE conversation_id = room AND user_id = NEW.user_id AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not a participant in this conversation'
      USING ERRCODE = 'PL006';
  END IF;

  SELECT pair_low, pair_high INTO low, high
    FROM conversation WHERE id = room AND kind = 'direct';
  IF low IS NOT NULL AND users_blocked(low, high) THEN
    RAISE EXCEPTION 'a block stands between these members'
      USING ERRCODE = 'PL003';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_reaction_from_outside() IS
  'Refuses a reaction from a non-participant, across a block, or on a removed message (T-225).';

CREATE TRIGGER message_reaction_guard
  BEFORE INSERT ON message_reaction
  FOR EACH ROW EXECUTE FUNCTION refuse_reaction_from_outside();

-- **A mention never reaches somebody who blocked the mentioner.** Today a block
-- already refuses the message itself in a direct conversation, so this cannot
-- be triggered; it exists for the groups of T-240, where two members who have
-- blocked each other can share a room and one of them must not be able to put
-- the other's name in front of them.
CREATE FUNCTION refuse_mention_across_block() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  author uuid;
BEGIN
  SELECT m.author_id INTO author FROM message m WHERE m.id = NEW.message_id;

  IF author IS NOT NULL AND users_blocked(author, NEW.user_id) THEN
    RAISE EXCEPTION 'a block stands between these members'
      USING ERRCODE = 'PL003', HINT = 'a mention is a way of reaching somebody';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_mention_across_block() IS
  'Refuses a mention of somebody who has blocked the author, or whom the author has blocked (T-225). SQLSTATE PL003.';

CREATE TRIGGER message_mention_guard
  BEFORE INSERT ON message_mention
  FOR EACH ROW EXECUTE FUNCTION refuse_mention_across_block();

CREATE FUNCTION refuse_pin_from_outside() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  room    uuid;
  removed timestamptz;
BEGIN
  SELECT m.conversation_id, m.removed_at INTO room, removed
    FROM message m WHERE m.id = NEW.message_id;

  -- The pin names its conversation as well as its message; if the two disagree
  -- the caller has built a pin that points somewhere it does not belong.
  IF room IS DISTINCT FROM NEW.conversation_id THEN
    RAISE EXCEPTION 'that message is not in this conversation'
      USING ERRCODE = 'PL006';
  END IF;

  IF removed IS NOT NULL THEN
    RAISE EXCEPTION 'that message has been removed' USING ERRCODE = 'PL007';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM conversation_participant
     WHERE conversation_id = room AND user_id = NEW.pinned_by AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not a participant in this conversation'
      USING ERRCODE = 'PL006';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_pin_from_outside() IS
  'Refuses a pin from a non-participant, on a removed message, or naming the wrong conversation (T-225).';

CREATE TRIGGER conversation_pin_guard
  BEFORE INSERT ON conversation_pin
  FOR EACH ROW EXECUTE FUNCTION refuse_pin_from_outside();

-- ---------------------------------------------------------------------------
-- Removing a message takes its reactions and its pin with it
-- ---------------------------------------------------------------------------
-- The tombstone already drops the body and the card (T-220, T-222). Leaving
-- reactions and a pin behind would leave a highlighted, applauded outline of
-- something that was taken down.
CREATE FUNCTION clear_removed_message_marks() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
    DELETE FROM message_reaction WHERE message_id = NEW.id;
    DELETE FROM conversation_pin WHERE message_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION clear_removed_message_marks() IS
  'Drops the reactions and the pin when a message is tombstoned (T-225): a removed message leaves no applauded outline.';

CREATE TRIGGER message_removal_clears_marks
  AFTER UPDATE ON message
  FOR EACH ROW EXECUTE FUNCTION clear_removed_message_marks();

-- Down Migration

DROP TRIGGER IF EXISTS message_removal_clears_marks ON message;
DROP FUNCTION IF EXISTS clear_removed_message_marks();
DROP TRIGGER IF EXISTS conversation_pin_guard ON conversation_pin;
DROP FUNCTION IF EXISTS refuse_pin_from_outside();
DROP TRIGGER IF EXISTS message_mention_guard ON message_mention;
DROP FUNCTION IF EXISTS refuse_mention_across_block();
DROP TRIGGER IF EXISTS message_reaction_guard ON message_reaction;
DROP FUNCTION IF EXISTS refuse_reaction_from_outside();
DROP TABLE IF EXISTS conversation_pin;
DROP TABLE IF EXISTS message_mention;
DROP TABLE IF EXISTS message_reaction;
