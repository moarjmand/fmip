-- Up Migration
-- T-802 (D-096): the watchdog's alerts delivered to administrators.
--
-- **A `system_alert` kind and a `watchdog_event` subject.** The kind lists in
-- `notification` and `notification_preference` are two copies of the
-- contract's list, so both are widened; the subject is the `watchdog_event`
-- row (its id as text), which the inbox reads its headline from. The
-- constraints keep their names so the schema spec keeps reading them.
--
-- **One cursor, one row.** `watchdog_alert_cursor` holds the id of the newest
-- alert event every administrator has been written a notification for. It
-- moves forward only, inside a transaction holding an advisory lock, after
-- the notifications for every event up to it exist; each notification carries
-- `watchdog_event:<id>` as its dedupe key, so a delivery interrupted between
-- writing and moving the cursor writes nothing twice when it runs again.
--
-- The cursor starts at the newest event already logged: alerts raised before
-- this delivery existed were never promised to anyone, and replaying a
-- week of them into every administrator's inbox on the first tick would be
-- a flood about the past. Additive: no backfill.

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction',
    'briefing', 'campaign', 'system_alert'
  )
);
ALTER TABLE notification_preference DROP CONSTRAINT notification_preference_kind_check;
ALTER TABLE notification_preference ADD CONSTRAINT notification_preference_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction',
    'briefing', 'campaign', 'system_alert'
  )
);
ALTER TABLE notification DROP CONSTRAINT notification_subject_kind;
ALTER TABLE notification ADD CONSTRAINT notification_subject_kind CHECK (
  subject_type IN (
    'fixture', 'member', 'group', 'conversation', 'message', 'panel_post', 'prediction',
    'sanction', 'briefing', 'campaign', 'watchdog_event'
  )
);

CREATE TABLE watchdog_alert_cursor (
  id            smallint PRIMARY KEY DEFAULT 1,
  last_event_id bigint NOT NULL,
  advanced_at   timestamptz,
  CONSTRAINT watchdog_alert_cursor_one_row CHECK (id = 1),
  CONSTRAINT watchdog_alert_cursor_not_negative CHECK (last_event_id >= 0)
);

COMMENT ON TABLE watchdog_alert_cursor IS
  'The newest watchdog alert event delivered to every administrator (T-802, D-096). One row; moves forward only, under an advisory lock.';

INSERT INTO watchdog_alert_cursor (id, last_event_id)
SELECT 1, coalesce(max(id), 0) FROM watchdog_event;

-- Down Migration

DROP TABLE watchdog_alert_cursor;
-- The narrower checks cannot hold rows of the kind they no longer name.
DELETE FROM notification WHERE kind = 'system_alert';
DELETE FROM notification_preference WHERE kind = 'system_alert';

ALTER TABLE notification DROP CONSTRAINT notification_subject_kind;
ALTER TABLE notification ADD CONSTRAINT notification_subject_kind CHECK (
  subject_type IN (
    'fixture', 'member', 'group', 'conversation', 'message', 'panel_post', 'prediction',
    'sanction', 'briefing', 'campaign'
  )
);
ALTER TABLE notification_preference DROP CONSTRAINT notification_preference_kind_check;
ALTER TABLE notification_preference ADD CONSTRAINT notification_preference_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction',
    'briefing', 'campaign'
  )
);
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction',
    'briefing', 'campaign'
  )
);
