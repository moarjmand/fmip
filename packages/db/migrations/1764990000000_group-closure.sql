-- Up Migration

-- T-1025 (D-135): administrators close a group, reopen it, and remove its
-- content, each as a moderation decision about the group.
--
-- **A closed group is read-only to its members.** Nothing new goes into it --
-- no message, reaction, pin, thread, poll, vote, member, invitation, request,
-- invite link or rules version -- and the guard is here, on the inserts, so
-- no caller can route around it. What stays open is the way out: leaving,
-- reading, and the owner's appeal. Updates and deletes are left alone on
-- purpose, because the ways out (leaving, handing ownership on when an
-- account is deleted, a moderator's tombstone) are updates and deletes.
--
-- **Why it is closed is on the group**, so every page that shows it can say.

ALTER TABLE user_group
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_reason text,
  ADD COLUMN closed_decision_id uuid REFERENCES moderation_decision (id) ON DELETE RESTRICT,
  ADD CONSTRAINT user_group_closure_is_whole
    CHECK ((closed_at IS NULL) = (closed_reason IS NULL)
       AND (closed_at IS NULL) = (closed_decision_id IS NULL)),
  ADD CONSTRAINT user_group_closed_reason_length
    CHECK (closed_reason IS NULL OR char_length(btrim(closed_reason)) BETWEEN 1 AND 500);

COMMENT ON COLUMN user_group.closed_at IS
  'When an administrator closed the group (T-1025, D-135); null while open. Its reason and decision go with it.';

-- Out of the directory and search: the same partial-index shape as the name
-- search, now excluding closed groups too.
DROP INDEX IF EXISTS user_group_name_search_idx;
CREATE INDEX user_group_name_search_idx
  ON user_group USING gin (search_key(name) gin_trgm_ops)
  WHERE visibility <> 'invite_only' AND closed_at IS NULL;

-- Two outcomes a decision about a group can have beyond the four it has.
-- `content_removed` already exists and is what removing a group's content is.
ALTER TABLE moderation_decision DROP CONSTRAINT moderation_decision_outcome_kind;
ALTER TABLE moderation_decision ADD CONSTRAINT moderation_decision_outcome_kind
  CHECK (outcome IN ('no_action', 'warned', 'content_removed', 'sanctioned',
                     'group_closed', 'group_reopened'));

-- The owner appeals a closure the way a member appeals a sanction (T-211):
-- with notes. A note belongs to a sanction or to a decision, exactly one.
ALTER TABLE appeal_note
  ALTER COLUMN sanction_id DROP NOT NULL,
  ADD COLUMN decision_id uuid REFERENCES moderation_decision (id) ON DELETE RESTRICT,
  ADD CONSTRAINT appeal_note_one_subject CHECK (num_nonnulls(sanction_id, decision_id) = 1);

CREATE INDEX appeal_note_decision_idx ON appeal_note (decision_id, created_at)
  WHERE decision_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The read-only guard
-- ---------------------------------------------------------------------------
CREATE FUNCTION group_is_closed(target uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM user_group WHERE id = target AND closed_at IS NOT NULL)
$$;

-- TG_ARGV[0] names the column; TG_ARGV[1] says what it points at: the group
-- itself, a conversation, a message or a poll.
CREATE FUNCTION refuse_write_in_closed_group() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ref    uuid;
  target uuid;
BEGIN
  ref := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF ref IS NULL THEN
    RETURN NEW;
  END IF;
  target := CASE TG_ARGV[1]
    WHEN 'group' THEN ref
    WHEN 'conversation' THEN (SELECT c.group_id FROM conversation c WHERE c.id = ref)
    WHEN 'message' THEN (SELECT c.group_id FROM message m
                           JOIN conversation c ON c.id = m.conversation_id WHERE m.id = ref)
    WHEN 'poll' THEN (SELECT p.group_id FROM group_poll p WHERE p.id = ref)
  END;
  IF target IS NOT NULL AND group_is_closed(target) THEN
    RAISE EXCEPTION 'this group is closed'
      USING ERRCODE = 'PL021', HINT = 'group_closed';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_write_in_closed_group() IS
  'Refuses anything new in a group an administrator closed (T-1025, D-135). SQLSTATE PL021, hint group_closed.';

CREATE TRIGGER group_member_closed_guard BEFORE INSERT ON group_member
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('group_id', 'group');
CREATE TRIGGER group_invite_closed_guard BEFORE INSERT ON group_invite
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('group_id', 'group');
CREATE TRIGGER group_join_request_closed_guard BEFORE INSERT ON group_join_request
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('group_id', 'group');
CREATE TRIGGER group_invite_link_closed_guard BEFORE INSERT ON group_invite_link
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('group_id', 'group');
CREATE TRIGGER group_rules_version_closed_guard BEFORE INSERT ON group_rules_version
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('group_id', 'group');
CREATE TRIGGER group_poll_closed_guard BEFORE INSERT ON group_poll
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('group_id', 'group');
CREATE TRIGGER group_poll_vote_closed_guard BEFORE INSERT OR UPDATE ON group_poll_vote
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('poll_id', 'poll');
CREATE TRIGGER conversation_closed_guard BEFORE INSERT ON conversation
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('group_id', 'group');
CREATE TRIGGER message_closed_guard BEFORE INSERT ON message
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('conversation_id', 'conversation');
CREATE TRIGGER message_reaction_closed_guard BEFORE INSERT ON message_reaction
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('message_id', 'message');
CREATE TRIGGER conversation_pin_closed_guard BEFORE INSERT ON conversation_pin
  FOR EACH ROW EXECUTE FUNCTION refuse_write_in_closed_group('conversation_id', 'conversation');

-- Down Migration

DROP TRIGGER IF EXISTS conversation_pin_closed_guard ON conversation_pin;
DROP TRIGGER IF EXISTS message_reaction_closed_guard ON message_reaction;
DROP TRIGGER IF EXISTS message_closed_guard ON message;
DROP TRIGGER IF EXISTS conversation_closed_guard ON conversation;
DROP TRIGGER IF EXISTS group_poll_vote_closed_guard ON group_poll_vote;
DROP TRIGGER IF EXISTS group_poll_closed_guard ON group_poll;
DROP TRIGGER IF EXISTS group_rules_version_closed_guard ON group_rules_version;
DROP TRIGGER IF EXISTS group_invite_link_closed_guard ON group_invite_link;
DROP TRIGGER IF EXISTS group_join_request_closed_guard ON group_join_request;
DROP TRIGGER IF EXISTS group_invite_closed_guard ON group_invite;
DROP TRIGGER IF EXISTS group_member_closed_guard ON group_member;
DROP FUNCTION IF EXISTS refuse_write_in_closed_group();
DROP FUNCTION IF EXISTS group_is_closed(uuid);

DROP INDEX IF EXISTS appeal_note_decision_idx;
ALTER TABLE appeal_note DISABLE TRIGGER appeal_note_immutable;
DELETE FROM appeal_note WHERE decision_id IS NOT NULL;
ALTER TABLE appeal_note ENABLE TRIGGER appeal_note_immutable;
ALTER TABLE appeal_note DROP CONSTRAINT IF EXISTS appeal_note_one_subject;
ALTER TABLE appeal_note DROP COLUMN IF EXISTS decision_id;
ALTER TABLE appeal_note ALTER COLUMN sanction_id SET NOT NULL;

ALTER TABLE moderation_decision DROP CONSTRAINT moderation_decision_outcome_kind;
ALTER TABLE moderation_decision ADD CONSTRAINT moderation_decision_outcome_kind
  CHECK (outcome IN ('no_action', 'warned', 'content_removed', 'sanctioned'));

DROP INDEX IF EXISTS user_group_name_search_idx;
CREATE INDEX user_group_name_search_idx
  ON user_group USING gin (search_key(name) gin_trgm_ops)
  WHERE visibility <> 'invite_only';

ALTER TABLE user_group DROP CONSTRAINT IF EXISTS user_group_closed_reason_length;
ALTER TABLE user_group DROP CONSTRAINT IF EXISTS user_group_closure_is_whole;
ALTER TABLE user_group DROP COLUMN IF EXISTS closed_decision_id;
ALTER TABLE user_group DROP COLUMN IF EXISTS closed_reason;
ALTER TABLE user_group DROP COLUMN IF EXISTS closed_at;
