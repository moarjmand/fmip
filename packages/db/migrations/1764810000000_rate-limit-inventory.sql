-- Up Migration

-- T-811: the rate-limit inventory (D-103). Every write the API takes is
-- listed in `apps/api/src/modules/rate-limits/inventory.ts` with its ceiling
-- or the reason it has none, and the list found two writes that needed one:
--
-- - `POST /me/briefing` asks the language model for a briefing every time it
--   is called. The model's plan is shared by the briefing, "ask", the
--   moderation assistant and the match summaries, so one member pressing the
--   button in a loop could spend the whole product's allowance.
-- - `POST /me/push-subscriptions` stores an https endpoint the member names,
--   and every notification of theirs is then POSTed to each one. Without a
--   ceiling a member can register any number of addresses and have the server
--   send to all of them.
--
-- (A third, the password check of `POST /auth/account/delete`, reuses the
-- sign-in ceilings of D-093 and needs no row.)
--
-- **Enforced in the API rather than by a trigger.** The briefing's cost is the
-- model call, which happens before anything is inserted, so a trigger on the
-- insert would refuse it only after it had been paid for; and the push
-- registration is an upsert that the API is the only writer of. Both count in
-- `rate_window` against these rows, exactly as the triggers do.

INSERT INTO rate_limit (action, per_hour) VALUES
  -- Six an hour: a member asks for a briefing a few times a day at most, and a
  -- briefing covers a day of their feed; six an hour is far above that and
  -- far below what spends a model allowance.
  ('briefing', 6),
  -- Ten an hour: one per browser a member turns push on in, with room for
  -- turning it off and on again.
  ('push_subscription', 10);

-- ---------------------------------------------------------------------------
-- rate_refusal
-- ---------------------------------------------------------------------------
-- How many requests each ceiling refused, per UTC day, for the System page
-- (T-811 on T-804). A count per ceiling per day and nothing else: not the
-- member, not the address, not the identifier. A refusal by a trigger rolls
-- its own transaction back, so it cannot be counted there; the API counts it
-- when it answers 429 (T-811, `RateLimitsService`), and the sign-in limiter
-- counts its own in the statement that refuses. Days older than thirty are
-- deleted by the API as it records.
CREATE TABLE rate_refusal (
  action text NOT NULL,
  day    date NOT NULL,
  count  integer NOT NULL DEFAULT 0,
  CONSTRAINT rate_refusal_pkey PRIMARY KEY (action, day),
  CONSTRAINT rate_refusal_count CHECK (count >= 0)
);

COMMENT ON TABLE rate_refusal IS
  'Requests refused by each rate_limit ceiling per UTC day (T-811). Counts only; kept for 30 days.';

-- Down Migration

DROP TABLE IF EXISTS rate_refusal;
DELETE FROM rate_limit WHERE action IN ('briefing', 'push_subscription');
