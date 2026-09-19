-- Up Migration
-- T-330 (D-074): a member's devices for Web Push, and a fourth delivery
-- outcome.
--
-- `push_subscription` is one browser's registration: the endpoint the
-- browser's push service handed out (unique -- a browser hands it to one
-- member, and registering again refreshes the keys rather than doubling
-- the device) and the two keys that encrypt a message for it. Rows are
-- removed by the member from the settings page, or by the channel when the
-- service answers that the device is gone (404, 410).
--
-- `skipped` on `notification_delivery`: the channel exists and this member
-- has nowhere to receive it -- no device -- which is neither an absence of
-- the channel nor a failure of it, and saying either would be a lie about
-- what happened (rule 3).
CREATE TABLE push_subscription (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  endpoint     text NOT NULL,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT push_subscription_endpoint_unique UNIQUE (endpoint),
  CONSTRAINT push_subscription_endpoint_is_https CHECK (endpoint LIKE 'https://%'),
  CONSTRAINT push_subscription_keys_present CHECK (btrim(p256dh) <> '' AND btrim(auth) <> '')
);

CREATE INDEX push_subscription_user_idx ON push_subscription (user_id);

COMMENT ON TABLE push_subscription IS
  'One browser''s Web Push registration for one member (T-330, D-074): the endpoint its push service handed out and the keys a message is encrypted with.';

CREATE TRIGGER push_subscription_set_updated_at
  BEFORE UPDATE ON push_subscription FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE notification_delivery DROP CONSTRAINT notification_delivery_email_outcome;
ALTER TABLE notification_delivery ADD CONSTRAINT notification_delivery_email_outcome
  CHECK (email IS NULL OR email IN ('absent', 'sent', 'failed', 'skipped'));
ALTER TABLE notification_delivery DROP CONSTRAINT notification_delivery_push_outcome;
ALTER TABLE notification_delivery ADD CONSTRAINT notification_delivery_push_outcome
  CHECK (push IS NULL OR push IN ('absent', 'sent', 'failed', 'skipped'));

-- Down Migration

ALTER TABLE notification_delivery DROP CONSTRAINT notification_delivery_push_outcome;
ALTER TABLE notification_delivery ADD CONSTRAINT notification_delivery_push_outcome
  CHECK (push IS NULL OR push IN ('absent', 'sent', 'failed'));
ALTER TABLE notification_delivery DROP CONSTRAINT notification_delivery_email_outcome;
ALTER TABLE notification_delivery ADD CONSTRAINT notification_delivery_email_outcome
  CHECK (email IS NULL OR email IN ('absent', 'sent', 'failed'));
DROP TRIGGER IF EXISTS push_subscription_set_updated_at ON push_subscription;
DROP TABLE push_subscription;
