-- Up Migration
-- A ceiling on the agents console's test message (T-1880; D-103's inventory).
--
-- `POST /console/calendar/push/test` was exempt: it reaches the caller's own
-- browsers only. But each call is a request from the API to a push service
-- for every browser the person switched on, and nothing held how often.
--
-- Six an hour per console account: switching a browser on and checking that
-- it works takes one or two. Counted by the API from the person's own
-- `calendar.push_test` rows in `console_audit` in the clock hour, before
-- anything is sent; each allowed ask writes that row. A row an administrator
-- changes with an UPDATE; a missing row means "not limited".
INSERT INTO rate_limit (action, per_hour) VALUES ('console_push_test', 6)
ON CONFLICT (action) DO NOTHING;

-- Down Migration

DELETE FROM rate_limit WHERE action = 'console_push_test';
