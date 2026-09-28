-- Up Migration

-- T-838 (D-104): the ceilings on `GET /ask`, the gap D-103 recorded. Every question
-- there is a call to the language model, from the plan the briefing, the
-- moderation assistant and the match summaries share, and the route is public:
-- a guest pressing Search in a loop could spend the whole product's allowance.
--
-- Both are enforced in the API before the model is called, and neither needs
-- a new table:
--
-- - `ask`, per member, counted in `rate_window` like `briefing` (D-103).
-- - `ask_ip`, per network address for a signed-out reader, counted in
--   `auth_rate_window` under an HMAC of the address, like the account forms'
--   (D-093). The address is Cloudflare's, forwarded by the web app as
--   `X-Fmip-Client-IP`; without it (local development, tests) a guest is not
--   limited, never put in one bucket with everybody.
--
-- Refusals are counted per ceiling per day in `rate_refusal` (T-811). The
-- search page, refused, searches the question as keywords -- which calls no
-- model -- and says why, so a reader behind a shared address is never left
-- without a search.

INSERT INTO rate_limit (action, per_hour) VALUES
  -- Sixty an hour: one question a minute, sustained for an hour, is far past
  -- what a person searching does, and ten times the briefing's six, because a
  -- question is a short call (at most 300 tokens back) and a search is how the
  -- site is navigated.
  ('ask', 60),
  -- A hundred and twenty an hour per address: addresses are shared -- a
  -- household, an office, a mobile carrier's NAT, common where this
  -- product's readers are (D-093) -- so the per-address number is twice a
  -- member's, and a refusal still leaves the keyword search.
  ('ask_ip', 120)
ON CONFLICT (action) DO NOTHING;

-- Down Migration

DELETE FROM rate_limit WHERE action IN ('ask', 'ask_ip');
