-- Up Migration

-- T-222: shared football cards (blueprint 8.3).
--
-- "Match cards shared in chat remain live. The score and status update without
-- replacing the original discussion context."
--
-- **So a card is a reference, never a copy.** The message stores a kind and a
-- UUID and nothing else — no team name, no score, no kick-off time — and the
-- card is resolved when the conversation is read, carrying its own
-- `last_updated_at` like every other live surface (rules 1 and 4). A
-- denormalised score inside a message would be a stale number displayed as a
-- current one, permanently, in a place nobody would ever think to go and fix.
--
-- One card per message. Blueprint 8.3 says "sharing a match, article, team,
-- player or prediction as a structured card", one thing at a time, and a
-- message carrying three cards is a post rather than a message.

ALTER TABLE message
  ADD COLUMN card_kind text,
  ADD COLUMN card_id   uuid;

-- `article` joins this list when E14 builds news, in the migration that builds
-- it — the same rule as every other list in this phase. A kind nothing can
-- produce is a kind nothing should offer.
ALTER TABLE message ADD CONSTRAINT message_card_kind_check
  CHECK (card_kind IS NULL OR card_kind IN ('fixture', 'team', 'person', 'prediction'));

ALTER TABLE message ADD CONSTRAINT message_card_is_whole
  CHECK ((card_kind IS NULL AND card_id IS NULL) OR (card_kind IS NOT NULL AND card_id IS NOT NULL));

-- **A message may now be a card with nothing said.** Sharing a match without a
-- comment is a real thing to do, so the body becomes optional when a card is
-- present — but a message that is neither is nothing at all.
ALTER TABLE message DROP CONSTRAINT message_body_or_tombstone;
ALTER TABLE message ADD CONSTRAINT message_body_or_tombstone
  CHECK (
    (removed_at IS NULL
      AND ((body IS NOT NULL AND btrim(body) <> '') OR card_kind IS NOT NULL))
    OR (removed_at IS NOT NULL AND body IS NULL)
  );

-- A removed message loses its card too. Leaving the reference would let a
-- removed message keep pointing at a match, which is a fragment of what was
-- said surviving the decision to take it down.
ALTER TABLE message ADD CONSTRAINT message_tombstone_drops_the_card
  CHECK (removed_at IS NULL OR (card_kind IS NULL AND card_id IS NULL));

-- The rewrite guard has to know about the two new columns, or they would be the
-- one part of a message anybody could change afterwards.
CREATE OR REPLACE FUNCTION refuse_message_rewrite() RETURNS trigger
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

  -- The card may only go, never change: a card swapped after the fact would
  -- rewrite what somebody shared while the words above it stayed the same.
  IF NEW.removed_at IS NOT NULL AND OLD.card_kind IS NOT NULL AND NEW.card_kind IS NOT NULL THEN
    RAISE EXCEPTION 'a removed message keeps no card'
      USING ERRCODE = 'PL007';
  END IF;

  RETURN NEW;
END
$$;

-- A card is the one part of a message that points at the rest of the product,
-- and a conversation full of them should not make deleting a fixture
-- impossible. There is no foreign key on purpose: `card_id` names one of four
-- tables by `card_kind`, exactly as `audit_log.target_id` and
-- `report.subject_id` do, and the API checks the row exists on write.
COMMENT ON COLUMN message.card_kind IS
  'Which table card_id names (T-222). No foreign key: one of four, chosen by this column.';
COMMENT ON COLUMN message.card_id IS
  'The shared entity, by internal UUID only (rule 1). Resolved when the conversation is read, never copied.';

-- Down Migration

CREATE OR REPLACE FUNCTION refuse_message_rewrite() RETURNS trigger
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

ALTER TABLE message DROP CONSTRAINT message_tombstone_drops_the_card;
ALTER TABLE message DROP CONSTRAINT message_body_or_tombstone;
ALTER TABLE message ADD CONSTRAINT message_body_or_tombstone
  CHECK (
    (removed_at IS NULL AND body IS NOT NULL AND btrim(body) <> '')
    OR (removed_at IS NOT NULL AND body IS NULL)
  );
ALTER TABLE message DROP CONSTRAINT message_card_is_whole;
ALTER TABLE message DROP CONSTRAINT message_card_kind_check;
ALTER TABLE message DROP COLUMN card_id;
ALTER TABLE message DROP COLUMN card_kind;
