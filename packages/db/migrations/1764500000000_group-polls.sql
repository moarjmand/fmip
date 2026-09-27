-- Up Migration

-- T-643 (D-091): group polls (blueprint 8.2, "shared fixtures, articles, polls
-- and prediction comparisons"). A member asks their group one question with
-- two to six answers; members answer once each, and may change their answer
-- until it closes. Additive: three new tables, no column on anything existing.
--
-- **Counts, never a roll call.** Who chose what is stored, because a vote has
-- to be changeable and counted once, but no read the product makes returns it:
-- a poll's results are a count per option. In a small group a name beside a
-- count is a roll call, and a poll that exposes a vote gets fewer honest
-- answers.
--
-- **The rules are the schema's, as for every other group surface (T-240).**
-- Only a member creates or votes (PL006, the same refusal a message from
-- outside a group gets); a closed or removed poll takes no vote (PL018); a
-- group holds at most three open polls (PL019); the question and the options
-- never change once written (PL007); a `groups` sanction stops creating one
-- (PL004); and creating is under the hourly ceiling like every other write
-- (PL005).

-- ---------------------------------------------------------------------------
-- group_poll
-- ---------------------------------------------------------------------------
CREATE TABLE group_poll (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES user_group (id) ON DELETE CASCADE,
  -- Provenance, like `user_group.created_by`: a creator's account going does
  -- not take the question from the group.
  created_by     uuid REFERENCES user_account (id) ON DELETE SET NULL,
  question       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- The poll's own clock. It is open while now() < closes_at and nobody has
  -- closed it; there is no job that flips a flag, so there is no flag to lag.
  closes_at      timestamptz NOT NULL,
  -- Closed early, by its creator or the group's owner.
  closed_at      timestamptz,
  closed_by      uuid REFERENCES user_account (id) ON DELETE SET NULL,
  -- Removed by the group's owner or a moderator, with a reason (rule 10: the
  -- audit_log row is written in the same transaction by the API).
  removed_at     timestamptz,
  removed_by     uuid REFERENCES user_account (id) ON DELETE SET NULL,
  removal_reason text,
  CONSTRAINT group_poll_question_length
    CHECK (char_length(btrim(question)) BETWEEN 1 AND 200),
  CONSTRAINT group_poll_window
    CHECK (closes_at >= created_at + interval '1 hour'
       AND closes_at <= created_at + interval '30 days'),
  CONSTRAINT group_poll_closed_after_created CHECK (closed_at IS NULL OR closed_at >= created_at),
  CONSTRAINT group_poll_removal_whole
    CHECK ((removed_at IS NULL) = (removal_reason IS NULL)),
  CONSTRAINT group_poll_removal_reason
    CHECK (removal_reason IS NULL OR char_length(btrim(removal_reason)) BETWEEN 1 AND 500)
);

CREATE INDEX group_poll_group_idx ON group_poll (group_id, created_at DESC);
-- The ceiling below asks this on every new poll.
CREATE INDEX group_poll_open_idx ON group_poll (group_id, closes_at)
  WHERE closed_at IS NULL AND removed_at IS NULL;

COMMENT ON TABLE group_poll IS
  'A member''s question to their group (blueprint 8.2, T-643, D-091). Open while now() < closes_at and not closed or removed. Question and options never change.';

-- ---------------------------------------------------------------------------
-- group_poll_option
-- ---------------------------------------------------------------------------
CREATE TABLE group_poll_option (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id  uuid NOT NULL REFERENCES group_poll (id) ON DELETE CASCADE,
  -- 1 to 6, the creator's order. Unique per poll, so six is also the most.
  position smallint NOT NULL,
  label    text NOT NULL,
  CONSTRAINT group_poll_option_position_range CHECK (position BETWEEN 1 AND 6),
  CONSTRAINT group_poll_option_label_length CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  CONSTRAINT group_poll_option_position_unique UNIQUE (poll_id, position),
  -- The target of the vote's composite key: a vote names an option of its own poll.
  CONSTRAINT group_poll_option_poll_unique UNIQUE (poll_id, id)
);

-- Two answers that read the same are one answer offered twice.
CREATE UNIQUE INDEX group_poll_option_label_unique
  ON group_poll_option (poll_id, lower(btrim(label)));

COMMENT ON TABLE group_poll_option IS
  'One answer a poll offers (T-643). Two to six per poll, written with the poll and never changed.';

-- ---------------------------------------------------------------------------
-- group_poll_vote
-- ---------------------------------------------------------------------------
-- One row per member per poll; changing an answer updates it.
CREATE TABLE group_poll_vote (
  poll_id   uuid NOT NULL REFERENCES group_poll (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  option_id uuid NOT NULL,
  voted_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_poll_vote_pkey PRIMARY KEY (poll_id, user_id),
  CONSTRAINT group_poll_vote_option_fkey FOREIGN KEY (poll_id, option_id)
    REFERENCES group_poll_option (poll_id, id) ON DELETE CASCADE
);

CREATE INDEX group_poll_vote_option_idx ON group_poll_vote (option_id);
CREATE INDEX group_poll_vote_user_idx ON group_poll_vote (user_id);

COMMENT ON TABLE group_poll_vote IS
  'One member''s answer to one poll (T-643). Changeable while the poll is open. Never returned by who cast it: the product reads counts only.';

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

-- A poll is written by a member of its group, and a group holds at most three
-- open polls. The group row is locked first, so two members creating the
-- fourth at the same moment are counted one after the other rather than both
-- seeing two.
CREATE FUNCTION refuse_poll_out_of_place() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  open_polls integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_member WHERE group_id = NEW.group_id AND user_id = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'not a member of this group'
      USING ERRCODE = 'PL006';
  END IF;

  PERFORM 1 FROM user_group WHERE id = NEW.group_id FOR NO KEY UPDATE;
  SELECT count(*) INTO open_polls
    FROM group_poll
   WHERE group_id = NEW.group_id
     AND closed_at IS NULL AND removed_at IS NULL AND closes_at > now();
  IF open_polls >= 3 THEN
    RAISE EXCEPTION 'this group already has % open polls', open_polls
      USING ERRCODE = 'PL019', HINT = 'close or remove one first';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_poll_out_of_place() IS
  'Refuses a poll from somebody outside the group (PL006) or a fourth open poll in one group (PL019). T-643.';

CREATE TRIGGER group_poll_guard
  BEFORE INSERT ON group_poll
  FOR EACH ROW EXECUTE FUNCTION refuse_poll_out_of_place();

-- Named after `group_poll_guard` so a sanctioned member who is also outside the
-- group hears the plainer refusal; the ceiling is last, as everywhere (T-213).
CREATE TRIGGER group_poll_sanction_guard
  BEFORE INSERT ON group_poll
  FOR EACH ROW EXECUTE FUNCTION refuse_sanctioned_group('created_by');

INSERT INTO rate_limit (action, per_hour) VALUES ('group_poll_create', 10);

CREATE TRIGGER group_poll_volume_guard
  BEFORE INSERT ON group_poll
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('group_poll_create', 'created_by');

-- What was asked stays what was asked. The only changes are closing it early
-- (once, while it is open) and removing it (once).
CREATE FUNCTION refuse_poll_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL
     OR NEW.question IS DISTINCT FROM OLD.question
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.closes_at IS DISTINCT FROM OLD.closes_at THEN
    RAISE EXCEPTION 'a poll''s question and window never change'
      USING ERRCODE = 'PL007';
  END IF;

  IF OLD.removed_at IS NOT NULL AND (
       NEW.removed_at IS DISTINCT FROM OLD.removed_at
       OR NEW.removal_reason IS DISTINCT FROM OLD.removal_reason
       OR NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
    RAISE EXCEPTION 'this poll has been removed'
      USING ERRCODE = 'PL007';
  END IF;
  IF OLD.removed_at IS NULL AND NEW.removed_at IS NULL
     AND NEW.removal_reason IS DISTINCT FROM OLD.removal_reason THEN
    RAISE EXCEPTION 'a removal reason comes with a removal'
      USING ERRCODE = 'PL007';
  END IF;

  IF NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    IF OLD.closed_at IS NOT NULL OR OLD.removed_at IS NOT NULL OR OLD.closes_at <= now() THEN
      RAISE EXCEPTION 'this poll is closed'
        USING ERRCODE = 'PL018';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_poll_rewrite() IS
  'Keeps a poll''s question and window fixed; allows closing it once while open (else PL018) and removing it once (else PL007). T-643.';

CREATE TRIGGER group_poll_rewrite_guard
  BEFORE UPDATE ON group_poll
  FOR EACH ROW EXECUTE FUNCTION refuse_poll_rewrite();

-- The options are written in the poll's own transaction and never after, so
-- nobody's vote can come to mean a different answer. `now()` is the
-- transaction's start, which is also the poll's `created_at` when both are
-- written together.
CREATE FUNCTION refuse_poll_option_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR NOT EXISTS (
    SELECT 1 FROM group_poll WHERE id = NEW.poll_id AND created_at = now()
  ) THEN
    RAISE EXCEPTION 'a poll''s options are written with it and never changed'
      USING ERRCODE = 'PL007';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER group_poll_option_guard
  BEFORE INSERT OR UPDATE ON group_poll_option
  FOR EACH ROW EXECUTE FUNCTION refuse_poll_option_change();

-- Two to six options, checked when the poll's transaction commits.
CREATE FUNCTION poll_must_have_options() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM group_poll WHERE id = NEW.id) THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO n FROM group_poll_option WHERE poll_id = NEW.id;
  IF n < 2 OR n > 6 THEN
    RAISE EXCEPTION 'a poll has two to six options, not %', n
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER group_poll_has_options
  AFTER INSERT ON group_poll
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION poll_must_have_options();

-- A vote is a current member's, on an open poll. Changing it keeps the row
-- and moves `voted_at`.
CREATE FUNCTION refuse_poll_vote_out_of_place() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  poll record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.poll_id IS DISTINCT FROM OLD.poll_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'a vote stays with its poll and its member'
      USING ERRCODE = 'PL007';
  END IF;

  SELECT group_id, closes_at, closed_at, removed_at INTO poll
    FROM group_poll WHERE id = NEW.poll_id;
  IF poll.closed_at IS NOT NULL OR poll.removed_at IS NOT NULL OR poll.closes_at <= now() THEN
    RAISE EXCEPTION 'this poll is closed'
      USING ERRCODE = 'PL018';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM group_member WHERE group_id = poll.group_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'not a member of this group'
      USING ERRCODE = 'PL006';
  END IF;

  NEW.voted_at := now();
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_poll_vote_out_of_place() IS
  'Refuses a vote on a closed or removed poll (PL018) or from somebody outside the group (PL006). T-643.';

CREATE TRIGGER group_poll_vote_guard
  BEFORE INSERT OR UPDATE ON group_poll_vote
  FOR EACH ROW EXECUTE FUNCTION refuse_poll_vote_out_of_place();

-- Down Migration

DROP TRIGGER IF EXISTS group_poll_vote_guard ON group_poll_vote;
DROP FUNCTION IF EXISTS refuse_poll_vote_out_of_place();
DROP TRIGGER IF EXISTS group_poll_has_options ON group_poll;
DROP FUNCTION IF EXISTS poll_must_have_options();
DROP TRIGGER IF EXISTS group_poll_option_guard ON group_poll_option;
DROP FUNCTION IF EXISTS refuse_poll_option_change();
DROP TRIGGER IF EXISTS group_poll_rewrite_guard ON group_poll;
DROP FUNCTION IF EXISTS refuse_poll_rewrite();
DROP TRIGGER IF EXISTS group_poll_volume_guard ON group_poll;
DELETE FROM rate_limit WHERE action = 'group_poll_create';
DROP TRIGGER IF EXISTS group_poll_sanction_guard ON group_poll;
DROP TRIGGER IF EXISTS group_poll_guard ON group_poll;
DROP FUNCTION IF EXISTS refuse_poll_out_of_place();
DROP TABLE IF EXISTS group_poll_vote;
DROP TABLE IF EXISTS group_poll_option;
DROP TABLE IF EXISTS group_poll;
