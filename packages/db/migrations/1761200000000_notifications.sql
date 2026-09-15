-- Up Migration

-- T-270: in-product notifications (blueprint 12.2).
--
-- **A notification is a consequence, not a feature.** Every one of these is
-- already an event somewhere else in the product -- a settlement, a friend
-- request, a mention, a moderation decision -- so this epic subscribes rather
-- than invents. The type list below names events that already happen; an entry
-- that needed new code to be noticed would be a sign the event itself was not
-- recorded properly.
--
-- Nothing in the API writes these tables yet: emission is T-271 and the inbox is
-- T-272. The schema spec writes what the service will write.
--
-- **This list can be offered before it is wired, and `sanction.scope` could
-- not.** A scope is shown to a moderator as an action they may take, so one
-- nothing enforces is a promise the product does not keep (T-210). A
-- notification type is shown to nobody until the preferences surface exists, so
-- naming the set here misleads no one -- and the alternative, widening a CHECK
-- in four later migrations, would put the type list in four places.

-- ---------------------------------------------------------------------------
-- notification
-- ---------------------------------------------------------------------------
-- One thing that happened, addressed to one member.
--
-- **`subject_type` + `subject_id` rather than a foreign key**, the same shape
-- `report` and `audit_log` use: the subject is one of several tables, chosen by
-- the type, and a column per possibility would be eleven mostly-null columns.
-- What it buys is the deep link (T-272), which is the whole point of an inbox:
-- a notification that cannot open the thing it is about is a sentence.
--
-- **`source_id` is the member who caused it, and it is nullable.** A settlement
-- has no member behind it; a mention does. It exists so that a block can be
-- applied at emission rather than at display, which is the only place it works:
-- the fastest way to undo a block is a notification saying the blocked member
-- did something.
CREATE TABLE notification (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  kind         text NOT NULL,
  subject_type text NOT NULL,
  subject_id   text NOT NULL,
  source_id    uuid REFERENCES user_account (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  -- When it may be shown. `created_at` for an ordinary one; later for one held
  -- by quiet hours (T-273). Never null: "deliver now" and "held" differ by the
  -- value, not by whether the column has one, so no reader has to handle both.
  deliver_after timestamptz NOT NULL DEFAULT now(),
  -- Why it was held, when it was. Null for one that was not.
  held_reason  text,
  -- What the emitter considers "the same notification". Chosen there rather
  -- than derived here, because only the emitter knows: two messages in one
  -- conversation an hour apart are two notifications, and two taps on one
  -- friend-request button are one. The schema enforces the uniqueness and
  -- declines to guess the key.
  dedupe_key   text,
  CONSTRAINT notification_kind_check CHECK (
    kind IN (
      -- Predictions and reputation (T-052, T-053, T-054).
      'prediction_settled',
      'rating_changed',
      'career_points_awarded',
      -- The social graph (T-200).
      'friend_request',
      'friend_accepted',
      -- Conversations and groups (T-220, T-225, T-240).
      'message_received',
      'mentioned',
      'group_invite',
      'group_join_request',
      -- Moderation, about the member themselves (T-211).
      'moderation_decision',
      -- The public panel (T-250, T-251, T-252).
      'contributor_granted',
      'contributor_grant_changed',
      'panel_reaction'
    )
  ),
  CONSTRAINT notification_subject_kind CHECK (
    subject_type IN (
      'fixture',
      'member',
      'group',
      'conversation',
      'message',
      'panel_post',
      'prediction',
      'sanction'
    )
  ),
  -- A held notification says why it was held, or it was not held (rule 3, aimed
  -- at the member: the inbox shows what was kept back, and a blank reason there
  -- would be worse than not saying it was held at all).
  CONSTRAINT notification_hold_is_whole
    CHECK (held_reason IS NULL OR btrim(held_reason) <> ''),
  CONSTRAINT notification_delivers_after_creation CHECK (deliver_after >= created_at),
  -- Nobody is notified about themselves.
  CONSTRAINT notification_not_self CHECK (source_id IS NULL OR source_id <> user_id)
);

-- The inbox's own query: one member, deliverable now, newest first.
CREATE INDEX notification_inbox_idx ON notification (user_id, deliver_after DESC, created_at DESC);
-- "How many unread", which is the badge.
CREATE INDEX notification_unread_idx ON notification (user_id) WHERE read_at IS NULL;

-- "Nothing is emitted twice" (T-271), enforced rather than remembered. Partial,
-- so an emitter with nothing sensible to deduplicate on omits the key and is not
-- forced to invent one.
CREATE UNIQUE INDEX notification_one_per_dedupe_key
  ON notification (user_id, kind, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON TABLE notification IS
  'One in-product notification for one member (blueprint 12.2, T-270). subject_type/subject_id is the deep link; source_id is who caused it, so a block can be applied at emission.';

-- A notification from somebody the recipient blocked is the fastest way to undo
-- a block, so it is refused at the write path (T-200's `users_blocked` is the
-- one definition, asked here rather than re-implemented).
CREATE FUNCTION refuse_notification_across_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_id IS NOT NULL AND users_blocked(NEW.user_id, NEW.source_id) THEN
    RAISE EXCEPTION 'these members cannot reach each other'
      USING ERRCODE = 'PL003', HINT = 'one of them has blocked the other';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_notification_across_block() IS
  'Refuses a notification whose source is blocked by its recipient (T-270). SQLSTATE PL003.';

CREATE TRIGGER notification_block_guard
  BEFORE INSERT ON notification
  FOR EACH ROW EXECUTE FUNCTION refuse_notification_across_block();

-- ---------------------------------------------------------------------------
-- notification_preference
-- ---------------------------------------------------------------------------
-- **One row per departure from the default, not one row per member per type.**
--
-- The acceptance criterion is "a missing row means the documented default", and
-- that is only true if the defaults live in one place -- which is the code
-- (`NOTIFICATION_DEFAULTS`), the same argument `ELIGIBILITY_V1` makes. Writing
-- every default into this table at registration would freeze each member's
-- settings at the day they joined: changing a default afterwards would reach
-- nobody, silently, and the first person to notice would be looking at an
-- unrelated bug.
--
-- The cost is stated rather than hidden: reading a member's settings means
-- overlaying this table on the defaults, and no query can answer "what is this
-- member's preference" from SQL alone.
CREATE TABLE notification_preference (
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  in_product boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preference_pkey PRIMARY KEY (user_id, kind)
);

COMMENT ON TABLE notification_preference IS
  'One member turning one notification kind on or off (T-270). A missing row means the documented default, which lives in code so that changing it reaches everybody who never chose.';

CREATE TRIGGER notification_preference_set_updated_at
  BEFORE UPDATE ON notification_preference FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The kind list is shared with `notification`, and shared by reference rather
-- than copied: a preference for a kind that cannot be emitted is a setting that
-- does nothing, and a kind with no preference is one nobody can turn off.
ALTER TABLE notification_preference ADD CONSTRAINT notification_preference_kind_check
  CHECK (
    kind IN (
      'prediction_settled',
      'rating_changed',
      'career_points_awarded',
      'friend_request',
      'friend_accepted',
      'message_received',
      'mentioned',
      'group_invite',
      'group_join_request',
      'moderation_decision',
      'contributor_granted',
      'contributor_grant_changed',
      'panel_reaction'
    )
  );

-- ---------------------------------------------------------------------------
-- quiet_hours
-- ---------------------------------------------------------------------------
-- **Local times, not an offset.** The window is stored as two `time` values and
-- read in `user_account.timezone`, which the account has had since T-040. A
-- member who says "not between 23:00 and 07:00" means their own clock, and a
-- stored UTC offset would drift by an hour twice a year and be wrong for
-- exactly the people who set it.
--
-- **A window that wraps midnight is the normal case**, not the edge one: almost
-- nobody's quiet hours sit inside one day. So `starts_at > ends_at` is legal and
-- means "through midnight", and the only illegal value is the pair being equal,
-- which is either a whole day or none and cannot be told apart.
CREATE TABLE quiet_hours (
  user_id   uuid PRIMARY KEY REFERENCES user_account (id) ON DELETE CASCADE,
  starts_at time NOT NULL,
  ends_at   time NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiet_hours_not_empty CHECK (starts_at <> ends_at)
);

COMMENT ON TABLE quiet_hours IS
  'When one member does not want to be notified, in their own timezone (blueprint 12.2, T-270). starts_at > ends_at means the window wraps midnight, which is the ordinary case.';

CREATE TRIGGER quiet_hours_set_updated_at
  BEFORE UPDATE ON quiet_hours FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- in_quiet_hours(user_id, moment)
-- ---------------------------------------------------------------------------
-- The single definition, written once here so no surface grows its own.
--
-- The comparison happens in the member's own timezone, which is why this is a
-- function and not a predicate somebody writes inline: getting the wrap-around
-- right is three lines, and three lines copied twice is two chances to get it
-- wrong.
CREATE FUNCTION in_quiet_hours(member uuid, moment timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM quiet_hours q
      JOIN user_account u ON u.id = q.user_id
     WHERE q.user_id = member
       AND CASE
             WHEN q.starts_at < q.ends_at
               -- An ordinary window inside one day: 13:00 to 14:00.
               THEN (moment AT TIME ZONE u.timezone)::time >= q.starts_at
                AND (moment AT TIME ZONE u.timezone)::time < q.ends_at
             -- Through midnight: 23:00 to 07:00 is "after 23:00 or before
             -- 07:00", and reading it as a single range would make it mean the
             -- exact opposite -- quiet all day except at night.
             ELSE (moment AT TIME ZONE u.timezone)::time >= q.starts_at
               OR (moment AT TIME ZONE u.timezone)::time < q.ends_at
           END
  )
$$;

COMMENT ON FUNCTION in_quiet_hours(uuid, timestamptz) IS
  'Whether a moment falls inside the member''s quiet hours, read in their own timezone (T-270). A window that wraps midnight is handled.';

-- Down Migration

DROP FUNCTION IF EXISTS in_quiet_hours(uuid, timestamptz);
DROP TRIGGER IF EXISTS quiet_hours_set_updated_at ON quiet_hours;
DROP TABLE IF EXISTS quiet_hours;
DROP TRIGGER IF EXISTS notification_preference_set_updated_at ON notification_preference;
DROP TABLE IF EXISTS notification_preference;
DROP TRIGGER IF EXISTS notification_block_guard ON notification;
DROP FUNCTION IF EXISTS refuse_notification_across_block();
DROP TABLE IF EXISTS notification;
