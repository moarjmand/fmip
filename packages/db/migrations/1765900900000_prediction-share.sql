-- Up Migration

-- T-1723 (D-351): a public link to one prediction's "called it" card, made
-- only when its owner presses Share.
--
-- A member's predictions are seen by whom their profile says (D-063). A card
-- shared into a chat is seen by whoever is in the chat, so it cannot follow
-- that setting; it follows the owner's explicit action instead. One row is one
-- prediction made public as a card, nothing more: not the member's history,
-- not their other predictions, not their profile. Without a live row nothing
-- is public, and the owner can revoke it at any time.
--
-- **The token is the row's key, stored as it is**, unlike an invite link's
-- (T-1021), which keeps only a hash. An invite link is a key to a group; this
-- one opens a picture its owner chose to publish, and the owner's page shows
-- the link again so it can be shared twice. 128 random bits, base64url
-- without padding: 22 characters, not something to guess.

CREATE TABLE prediction_share (
  token          text PRIMARY KEY,
  prediction_id  uuid NOT NULL REFERENCES user_prediction (id) ON DELETE CASCADE,
  -- The owner, so the ceiling below can count per member; the guard keeps it
  -- equal to the prediction's own member.
  user_id        uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  CONSTRAINT prediction_share_token_shape CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),
  CONSTRAINT prediction_share_revocation CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

-- At most one live link per prediction: pressing Share again shows the same link.
CREATE UNIQUE INDEX prediction_share_one_live ON prediction_share (prediction_id)
  WHERE revoked_at IS NULL;
CREATE INDEX prediction_share_user_idx ON prediction_share (user_id, created_at DESC);

COMMENT ON TABLE prediction_share IS
  'A public link to one prediction''s card (T-1723, D-351): made only by the prediction''s owner, revocable by them; the token is the link.';

-- Only the prediction's own member makes a link to it.
CREATE FUNCTION refuse_prediction_share_not_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_prediction p WHERE p.id = NEW.prediction_id AND p.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'only a prediction''s own member shares it'
      USING ERRCODE = 'PL006', HINT = 'owner';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER prediction_share_owner_guard
  BEFORE INSERT ON prediction_share
  FOR EACH ROW EXECUTE FUNCTION refuse_prediction_share_not_owner();

-- What a link was made as never changes; it is revoked once.
CREATE FUNCTION refuse_prediction_share_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token IS DISTINCT FROM OLD.token
     OR NEW.prediction_id IS DISTINCT FROM OLD.prediction_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a share link is never rewritten; revoke it and make another'
      USING ERRCODE = 'PL007';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'this share link is already revoked'
      USING ERRCODE = 'PL007';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER prediction_share_fixed
  BEFORE UPDATE ON prediction_share
  FOR EACH ROW EXECUTE FUNCTION refuse_prediction_share_rewrite();

-- The ceiling on making links, the same mechanism as every member write
-- (T-213, D-103). Thirty an hour: a weekend of correct picks is a handful;
-- thirty is far above that and far below a script.
INSERT INTO rate_limit (action, per_hour) VALUES ('prediction_share', 30);

CREATE TRIGGER prediction_share_volume_guard
  BEFORE INSERT ON prediction_share
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('prediction_share', 'user_id');

-- Down Migration

DROP TRIGGER IF EXISTS prediction_share_volume_guard ON prediction_share;
DELETE FROM rate_window WHERE action = 'prediction_share';
DELETE FROM rate_limit WHERE action = 'prediction_share';
DROP TRIGGER IF EXISTS prediction_share_fixed ON prediction_share;
DROP FUNCTION IF EXISTS refuse_prediction_share_rewrite();
DROP TRIGGER IF EXISTS prediction_share_owner_guard ON prediction_share;
DROP FUNCTION IF EXISTS refuse_prediction_share_not_owner();
DROP TABLE IF EXISTS prediction_share;
