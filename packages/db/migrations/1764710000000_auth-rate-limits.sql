-- Up Migration

-- T-810: rate limits on signing in, signing up, the forgotten-password e-mail
-- and the two e-mailed links (D-026 deferred this; the numbers are D-093).
--
-- **The same ceilings, a different counter.** The ceilings are rows in
-- `rate_limit`, like every other one (T-213), so an administrator changes one
-- with an UPDATE. The counter cannot be `rate_window`: that is keyed by a
-- member's id, and the people these limits are for have no member id yet --
-- somebody signing in is, as far as the limit may know, an identifier and an
-- address. `auth_rate_window` is the same fixed hourly window keyed by an
-- opaque subject instead.
--
-- **The subject is a keyed hash, never the value.** What is counted is an
-- HMAC (keyed with SESSION_SECRET, like every token at rest, D-026) of "the
-- network address" or "the identifier typed", so this table holds neither an
-- IP address nor an e-mail address, and a copy of it does not say who tried
-- to sign in as whom. Rotating the secret starts every window afresh, which is
-- harmless.
--
-- **Counted by what was typed, not by the account it names.** The per-account
-- ceiling counts the identifier as submitted, whether or not an account has
-- it, so a refusal looks the same for an account that exists and for one that
-- does not: the limit itself must not become the way to find out.
--
-- **Enforced in the API rather than by a trigger.** The other limits refuse an
-- INSERT the member makes. A failed login inserts nothing, and a refused
-- request must be refused *before* the password is checked, so the check is a
-- query the identity service makes; the ceiling is still this table's.

CREATE TABLE auth_rate_window (
  subject      text NOT NULL,
  action       text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  CONSTRAINT auth_rate_window_pkey PRIMARY KEY (subject, action, window_start),
  CONSTRAINT auth_rate_window_count CHECK (count >= 0)
);

CREATE INDEX auth_rate_window_start_idx ON auth_rate_window (window_start);

COMMENT ON TABLE auth_rate_window IS
  'Attempts at one signed-out action by one subject (an HMAC of an address or of an identifier) within one hour (T-810). Old rows are disposable.';

-- The ceilings (D-093). `_ip` is per network address, from Cloudflare's
-- CF-Connecting-IP as the web app forwards it; `_account` is per identifier or
-- e-mail address typed. Addresses are shared -- a household, an office, a
-- mobile carrier's NAT -- so the per-address ceilings on sign-in count only
-- failures and sit well above what one person does, and the tight ceilings are
-- per account.
INSERT INTO rate_limit (action, per_hour) VALUES
  -- Failed sign-ins: ten wrong passwords an hour for one identifier, fifty
  -- from one address. A success is not counted.
  ('login_failure_account', 10),
  ('login_failure_ip', 50),
  -- Accounts created: twenty an hour from one address; five attempts an hour
  -- on one e-mail address.
  ('register_ip', 20),
  ('register_account', 5),
  -- Reset e-mails asked for: three an hour to one address (a mailbox is not a
  -- target), twenty an hour from one network address.
  ('password_forgot_account', 3),
  ('password_forgot_ip', 20),
  -- The two e-mailed links (verify, reset): sixty uses an hour from one
  -- address. The tokens are 256 random bits, so this is a ceiling on a flood,
  -- not on guessing.
  ('email_token_ip', 60);

COMMENT ON TABLE rate_limit IS
  'How many of an action one member (T-213), or one network address or identifier before signing in (T-810), may take per hour. A missing row means the action is not limited.';

-- Down Migration

COMMENT ON TABLE rate_limit IS
  'How many of an action one member may take per hour (T-213). A missing row means the action is not limited.';
DELETE FROM rate_limit
 WHERE action IN ('login_failure_account', 'login_failure_ip', 'register_ip',
                  'register_account', 'password_forgot_account', 'password_forgot_ip',
                  'email_token_ip');
DROP TABLE IF EXISTS auth_rate_window;
