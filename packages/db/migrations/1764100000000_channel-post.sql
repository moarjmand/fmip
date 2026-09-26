-- Up Migration
-- T-525: the daily post to a public channel -- the day's matches with the
-- statistical model's forecast. One row per day, and the primary key is the
-- whole of "at most once": whichever instance inserts the day posts it, and
-- every other tick that day, on this instance or another during a rolling
-- deploy, finds the row and stops. The row is written before anything is
-- sent, so a crash between the two leaves a claimed day, never a second post.
--
-- A day with no matches writes no row (the CHECKs make an empty post
-- unrecordable). `messages` is the text exactly as it was sent, in order,
-- and `delivered` how many of them the channel accepted -- the record of what
-- the product said in public, which is not recomputed later from forecasts
-- that may since have changed.
--
-- `refused` is the one state a later tick may take over: the channel answered
-- and posted nothing (a bot not yet made an administrator, a rate limit), so
-- trying again cannot repeat a message. Any other failure is `failed` and
-- final, because the outcome of a request that timed out is unknown.

CREATE TABLE channel_post (
  day date PRIMARY KEY,
  provider text NOT NULL,
  state text NOT NULL DEFAULT 'sending'
    CHECK (state IN ('sending', 'sent', 'refused', 'failed')),
  messages text[] NOT NULL CHECK (cardinality(messages) >= 1),
  delivered smallint NOT NULL DEFAULT 0
    CHECK (delivered >= 0 AND delivered <= cardinality(messages)),
  fixtures integer NOT NULL CHECK (fixtures >= 1),
  forecasts integer NOT NULL CHECK (forecasts >= 0 AND forecasts <= fixtures),
  model_versions text[] NOT NULL,
  attempts smallint NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  failure text,
  CONSTRAINT channel_post_finished CHECK ((state = 'sending') = (finished_at IS NULL)),
  CONSTRAINT channel_post_failure CHECK ((state IN ('refused', 'failed')) = (failure IS NOT NULL)),
  CONSTRAINT channel_post_sent_whole CHECK (state <> 'sent' OR delivered = cardinality(messages)),
  CONSTRAINT channel_post_refused_nothing CHECK (state <> 'refused' OR delivered = 0)
);

COMMENT ON TABLE channel_post IS
  'One public channel post per UTC day: the day''s matches with the statistical model''s forecast, as sent (T-525).';

-- Down Migration

DROP TABLE channel_post;
