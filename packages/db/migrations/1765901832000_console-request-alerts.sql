-- Up Migration

-- ---------------------------------------------------------------------------
-- New teammate requests by browser notification (T-1832, D-425).
--
-- A console person who switches «اعلان درخواست‌های تازه» on gets a Web Push
-- on each of their browsers already switched on for the calendar's reminders
-- (`console_push_device`, T-1788) whenever ANOTHER console person files a
-- request. One flag per person, off until they switch it on: a constant
-- default, so no row is rewritten and nothing is backfilled.
-- ---------------------------------------------------------------------------

ALTER TABLE console_user ADD COLUMN request_alerts boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN console_user.request_alerts IS
  'Whether this console person gets a browser notification when someone else files a teammate request (T-1832, D-425).';

-- Down Migration

ALTER TABLE console_user DROP COLUMN request_alerts;
