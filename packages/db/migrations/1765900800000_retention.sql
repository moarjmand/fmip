-- Up Migration
-- T-1715 (D-345): retention periods and a daily purge.
--
-- The purge (apps/api/src/modules/retention/) deletes expired sessions 30 days
-- after they expire and one-time e-mail tokens 7 days after they expire; both
-- tables are small (one row per sign-in, one per mailed link) and are read by
-- their expiry without an index.
--
-- `notification_delivery` is the large one: a row per notification carried,
-- tens of thousands on a Saturday. Its rows say whether one member's
-- notification left by e-mail and by push, so after 90 days they are reduced
-- to anonymous counts: each purged row is added to `notification_delivery_daily`
-- (the UTC day it was claimed, the notification's kind, and each channel's
-- outcome) and deleted, in one statement, so a count is never lost or counted
-- twice. Nulling the columns instead is not possible: the outcome is the
-- count, the key is what names the member, and a carried row is immutable
-- (`refuse_second_outcome`).
--
-- Deleting a delivery row does not make its notification due again: the claim
-- only considers notifications from the last day (`claimDue`).
--
-- The purge reads the oldest claims first, in batches; without an index on
-- `claimed_at` every batch would scan the whole table past the rows the
-- previous batches deleted. The index is appended to in claim order, so the
-- burst inserts pay little for it.

CREATE TABLE notification_delivery_daily (
  day    date NOT NULL,
  kind   text NOT NULL,
  -- A channel's outcome as `notification_delivery` recorded it, or
  -- `uncarried` for a claim whose outcome was never written.
  email  text NOT NULL,
  push   text NOT NULL,
  n      bigint NOT NULL,
  PRIMARY KEY (day, kind, email, push),
  CONSTRAINT notification_delivery_daily_email_outcome
    CHECK (email IN ('absent', 'sent', 'failed', 'skipped', 'uncarried')),
  CONSTRAINT notification_delivery_daily_push_outcome
    CHECK (push IN ('absent', 'sent', 'failed', 'skipped', 'uncarried')),
  CONSTRAINT notification_delivery_daily_n_positive CHECK (n > 0)
);

COMMENT ON TABLE notification_delivery_daily IS
  'Anonymous counts of notification_delivery rows older than 90 days (T-1715, D-345): per UTC claim day, kind and channel outcomes. No member, notification or subject is kept.';

CREATE INDEX notification_delivery_claimed_at_idx ON notification_delivery (claimed_at);

-- Down Migration

DROP INDEX IF EXISTS notification_delivery_claimed_at_idx;
DROP TABLE notification_delivery_daily;
