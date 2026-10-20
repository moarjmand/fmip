-- Up Migration
-- T-1430 (D-222): the public channel gets two more posts beside the day's
-- forecasts (T-525) -- the previous day's results against the statistical
-- model's last forecast before kick-off, and on Mondays the model's accuracy
-- over the ISO week just ended. Each is claimed exactly like the forecast
-- post, so `channel_post` gains a `kind` and the primary key becomes
-- (kind, day): "at most once" is now once per kind and day.
--
-- `day` is the day the post is about: the forecast post's own day, the match
-- day a results post recaps, and the Monday that starts the week a weekly
-- post reports. Every existing row is a forecast post.
--
-- `fixtures` and `forecasts` keep their meaning per kind: the matches listed
-- and how many of them carried the model's forecast (results: how many were
-- scored against a stored evaluation; weekly: the week's scored matches,
-- both columns). The CHECKs that make an empty post unrecordable stand.

ALTER TABLE channel_post
  ADD COLUMN kind text NOT NULL DEFAULT 'forecast'
    CHECK (kind IN ('forecast', 'results', 'weekly_accuracy'));

ALTER TABLE channel_post DROP CONSTRAINT channel_post_pkey;
ALTER TABLE channel_post ADD PRIMARY KEY (kind, day);

COMMENT ON TABLE channel_post IS
  'One public channel post per kind and UTC day, as sent: the day''s matches with the statistical model''s forecast (T-525), the previous day''s results against it and the week''s accuracy (T-1430).';

-- Down Migration

DELETE FROM channel_post WHERE kind <> 'forecast';
ALTER TABLE channel_post DROP CONSTRAINT channel_post_pkey;
ALTER TABLE channel_post ADD PRIMARY KEY (day);
ALTER TABLE channel_post DROP COLUMN kind;
COMMENT ON TABLE channel_post IS
  'One public channel post per UTC day: the day''s matches with the statistical model''s forecast, as sent (T-525).';
