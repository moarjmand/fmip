-- Up Migration
-- T-432 (Phase 5, D-070): a briefing is the same notification the inbox
-- already has, and the one place a notification leaves the building is the
-- delivery port (T-330). Two things change here.
--
-- **A `briefing` kind and a `briefing` subject.** The kind lists in
-- `notification` and `notification_preference` are two copies of the
-- contract's list, so both are widened, and the subject list gets the
-- briefing itself: `subject_id` is the `member_briefing` row, which is what
-- the inbox opens. The constraints keep their names so the schema spec that
-- compares them with the contract keeps reading the same ones.
--
-- **A row per delivery, written before the send.** `notification_delivery`
-- is the claim that a notification is being carried outward, keyed on the
-- notification so there is exactly one; the outcome on each channel is
-- written once, afterwards, and never changed. Deduplicating afterwards
-- from logs is how one retry becomes two e-mails (Phase 4, E33), so the
-- claim exists first and a second carrier finds it taken. A channel that is
-- absent is an outcome too: it says nothing carried the notification,
-- rather than leaving a gap that looks like "not yet".
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (
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
    'panel_reaction',
    -- The member's briefing was written (Phase 5, T-432).
    'briefing'
  )
);

ALTER TABLE notification_preference DROP CONSTRAINT notification_preference_kind_check;
ALTER TABLE notification_preference ADD CONSTRAINT notification_preference_kind_check CHECK (
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
    'panel_reaction',
    'briefing'
  )
);

ALTER TABLE notification DROP CONSTRAINT notification_subject_kind;
ALTER TABLE notification ADD CONSTRAINT notification_subject_kind CHECK (
  subject_type IN (
    'fixture',
    'member',
    'group',
    'conversation',
    'message',
    'panel_post',
    'prediction',
    'sanction',
    'briefing'
  )
);

CREATE TABLE notification_delivery (
  notification_id uuid PRIMARY KEY REFERENCES notification (id) ON DELETE CASCADE,
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  email           text,
  push            text,
  carried_at      timestamptz,
  CONSTRAINT notification_delivery_email_outcome
    CHECK (email IS NULL OR email IN ('absent', 'sent', 'failed')),
  CONSTRAINT notification_delivery_push_outcome
    CHECK (push IS NULL OR push IN ('absent', 'sent', 'failed')),
  -- The outcome is whole: both channels and the time, or none of them yet.
  CONSTRAINT notification_delivery_outcome_is_whole
    CHECK ((email IS NULL) = (push IS NULL) AND (email IS NULL) = (carried_at IS NULL)),
  CONSTRAINT notification_delivery_carried_after_claim
    CHECK (carried_at IS NULL OR carried_at >= claimed_at)
);

COMMENT ON TABLE notification_delivery IS
  'One notification being carried outward through the delivery port (T-330, T-432): the claim first, then what each channel did, written once. A missing row means it was not carried; an absent outcome means nothing could carry it.';

CREATE OR REPLACE FUNCTION refuse_second_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.carried_at IS NOT NULL THEN
    RAISE EXCEPTION 'a delivery outcome is written once; % was carried at %', OLD.notification_id, OLD.carried_at
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION refuse_second_outcome() IS
  'Trigger function for notification_delivery: a claim takes its outcome once, and a carried row never changes.';

CREATE TRIGGER notification_delivery_outcome_once
  BEFORE UPDATE ON notification_delivery FOR EACH ROW EXECUTE FUNCTION refuse_second_outcome();

-- Down Migration

DROP TRIGGER IF EXISTS notification_delivery_outcome_once ON notification_delivery;
DROP FUNCTION IF EXISTS refuse_second_outcome();
DROP TABLE notification_delivery;

ALTER TABLE notification DROP CONSTRAINT notification_subject_kind;
ALTER TABLE notification ADD CONSTRAINT notification_subject_kind CHECK (
  subject_type IN (
    'fixture', 'member', 'group', 'conversation', 'message', 'panel_post', 'prediction', 'sanction'
  )
);

ALTER TABLE notification_preference DROP CONSTRAINT notification_preference_kind_check;
ALTER TABLE notification_preference ADD CONSTRAINT notification_preference_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction'
  )
);

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (
  kind IN (
    'prediction_settled', 'rating_changed', 'career_points_awarded', 'friend_request',
    'friend_accepted', 'message_received', 'mentioned', 'group_invite', 'group_join_request',
    'moderation_decision', 'contributor_granted', 'contributor_grant_changed', 'panel_reaction'
  )
);
