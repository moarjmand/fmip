-- Up Migration

-- T-213: rate limits, which are the only automation in this product's
-- moderation (D-054).
--
-- Blueprint 10.4 allows that automated filters "can assist with spam and
-- abusive language". The two halves of that sentence are not alike. A limit on
-- **volume** is a rule that works identically in every language, and it is
-- this. A classifier for abusive **language** is not built, and D-054 records
-- why: anything buildable here is an English keyword list shipping on a product
-- that speaks eight languages, under-moderating seven of them while the
-- administration page reports that filtering is on.
--
-- **In the database rather than in Redis.** Redis is in the stack, and a
-- counter with a TTL is the textbook tool for this. But Redis is optional at
-- run time here — it is only reached when `INGESTION_SCHEDULE=on` — and a
-- safety rule that stops working when an optional dependency is missing is not
-- a safety rule. The same argument as the block and the sanction: enforced
-- where no caller and no deployment can route around it.
--
-- **Reaching people is limited; reporting them is not.** There is no rate limit
-- on `report`, deliberately. The one-open-report-per-subject index (T-210)
-- already limits reporting, and it limits it by *target* rather than by clock,
-- which is the right shape: a member who has genuinely been harassed by twenty
-- accounts must be able to report twenty accounts. A clock-based limit there
-- would be the exit gated, which is the one thing this phase does not do.

-- ---------------------------------------------------------------------------
-- rate_limit
-- ---------------------------------------------------------------------------
-- The ceilings, as rows rather than as numbers inside a function body, so that
-- changing one is an UPDATE an administrator can make (blueprint 16 asks for
-- configurable thresholds) instead of a migration.
CREATE TABLE rate_limit (
  action     text PRIMARY KEY,
  per_hour   integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_positive CHECK (per_hour > 0)
);

COMMENT ON TABLE rate_limit IS
  'How many of an action one member may take per hour (T-213). A missing row means the action is not limited.';

CREATE TRIGGER rate_limit_set_updated_at
  BEFORE UPDATE ON rate_limit FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Twenty friend requests an hour is far more than a person sends and far fewer
-- than a script wants. It is a ceiling on a flood, not a judgement about
-- sociability.
INSERT INTO rate_limit (action, per_hour) VALUES ('friend_request', 20);

-- ---------------------------------------------------------------------------
-- rate_window
-- ---------------------------------------------------------------------------
-- One row per member per action per hour, counted up.
--
-- A fixed window rather than a sliding one, and the cost is stated rather than
-- hidden: somebody who spends their whole allowance at the end of one hour and
-- again at the start of the next gets twice the ceiling across that boundary. A
-- sliding window needs every event kept; this needs one row, and twice the
-- ceiling for one minute is still a ceiling.
CREATE TABLE rate_window (
  user_id      uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  action       text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  CONSTRAINT rate_window_pkey PRIMARY KEY (user_id, action, window_start)
);

-- Old windows are nobody's business; this index is what a cleanup job would use.
CREATE INDEX rate_window_start_idx ON rate_window (window_start);

COMMENT ON TABLE rate_window IS
  'One member''s count of one action within one hour (T-213). Fixed windows: old rows are disposable.';

-- ---------------------------------------------------------------------------
-- The limit, enforced
-- ---------------------------------------------------------------------------
CREATE FUNCTION refuse_over_rate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ceiling integer;
  taken   integer;
  actor   uuid;
  bucket  timestamptz := date_trunc('hour', now());
BEGIN
  SELECT per_hour INTO ceiling FROM rate_limit WHERE action = TG_ARGV[0];
  -- No row means the action is not limited. An absent ceiling is not zero.
  IF ceiling IS NULL THEN
    RETURN NEW;
  END IF;

  -- The actor's column is named by the trigger, so the next surface that needs
  -- a ceiling (a message, a group invitation) reuses this function instead of
  -- growing a near-copy of it.
  actor := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;

  INSERT INTO rate_window (user_id, action, window_start, count)
  VALUES (actor, TG_ARGV[0], bucket, 1)
  ON CONFLICT (user_id, action, window_start)
  DO UPDATE SET count = rate_window.count + 1
  RETURNING count INTO taken;

  IF taken > ceiling THEN
    RAISE EXCEPTION 'more than % of this an hour', ceiling
      USING ERRCODE = 'PL005', HINT = 'a rate limit is in force';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_over_rate() IS
  'Counts one member''s actions within the current hour and refuses the one past the ceiling (T-213). SQLSTATE PL005.';

-- Named so that it fires **last**. Postgres runs BEFORE triggers in
-- alphabetical order, and `block` < `sanction` < `volume` is the order these
-- should refuse in: a blocked member is not told about a rate limit, and a
-- member who is both restricted and over the ceiling is told about the
-- restriction, because that is the one they can appeal.
CREATE TRIGGER friend_request_volume_guard
  BEFORE INSERT ON friend_request
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('friend_request', 'requester_id');

-- Down Migration

DROP TRIGGER IF EXISTS friend_request_volume_guard ON friend_request;
DROP FUNCTION IF EXISTS refuse_over_rate();
DROP TABLE IF EXISTS rate_window;
DROP TRIGGER IF EXISTS rate_limit_set_updated_at ON rate_limit;
DROP TABLE IF EXISTS rate_limit;
