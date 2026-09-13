-- Up Migration

-- T-200: the social graph (blueprint 8.1) — friend requests, friendships and
-- blocks. The first Phase 3 table, and the sequencing rule says schema and
-- contracts first.
--
-- Three rules shape all of it.
--
-- **A friendship is one row, not two.** Two directed rows can disagree — one
-- deleted, one not — and then "are A and B friends?" has two answers depending
-- on which way the query happened to be written. The row is the unordered pair
-- under a CHECK that refuses any other order, so there is exactly one row to
-- ask and no way to write a second.
--
-- **A block is enforced here, not in a query.** Blocking is a member's own exit
-- from another member, and an exit implemented as a filter in one SELECT is an
-- exit that leaks the first time somebody writes a second SELECT. So a block
-- ends the friendship and withdraws the open requests by trigger, and a request
-- across a block is refused with SQLSTATE PL003 — the same shape as the
-- kick-off lock of T-051 (PL001) and the analysis lock of T-130 (PL002). What
-- the API adds is a readable error, never the rule.
--
-- **A friend request is an open offer, not a history.** There is no `status`
-- column: accepting, declining, cancelling and blocking all remove the row.
-- Keeping declined requests would build a permanent record of one member having
-- turned another down, which neither of them asked the product to remember, and
-- it would have to be readable by somebody for it to be worth storing. Repeated
-- re-requesting is what blocking and the rate limits of T-213 are for.

-- ---------------------------------------------------------------------------
-- friendship
-- ---------------------------------------------------------------------------
-- The unordered pair. `low_id < high_id` is a CHECK rather than something the
-- application remembers, so a row in the wrong order cannot exist; callers
-- write LEAST($1, $2), GREATEST($1, $2) and the invariant is the database's.
CREATE TABLE friendship (
  low_id     uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  high_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendship_pkey PRIMARY KEY (low_id, high_id),
  CONSTRAINT friendship_ordered_pair CHECK (low_id < high_id)
);

-- The primary key serves lookups by low_id; a friend list has to work from
-- either side of the pair.
CREATE INDEX friendship_high_idx ON friendship (high_id);

COMMENT ON TABLE friendship IS
  'A mutual friendship as one unordered pair, low_id < high_id (T-200). One row, so the two directions cannot disagree.';

-- ---------------------------------------------------------------------------
-- friend_request
-- ---------------------------------------------------------------------------
-- An open offer from one member to another. One per direction: A may have asked
-- B while B has independently asked A, and accepting either makes them friends.
CREATE TABLE friend_request (
  requester_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_request_pkey PRIMARY KEY (requester_id, addressee_id),
  CONSTRAINT friend_request_not_self CHECK (requester_id <> addressee_id)
);

-- "My pending requests, newest first" is the query the account page makes
-- (blueprint 8.1: the account must show pending requests).
CREATE INDEX friend_request_addressee_idx ON friend_request (addressee_id, created_at DESC);

COMMENT ON TABLE friend_request IS
  'An open friend request (T-200). Accepting, declining, cancelling or blocking deletes the row; there is no history of refusals.';

-- ---------------------------------------------------------------------------
-- user_block
-- ---------------------------------------------------------------------------
-- Directional and deliberately not symmetrical: blocking B does not block A,
-- and B is not told. A notification saying "you were blocked" is a message, and
-- stopping messages was the point.
CREATE TABLE user_block (
  blocker_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_block_pkey PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_block_not_self CHECK (blocker_id <> blocked_id)
);

-- Every write path in Phase 3 asks "may this member reach that one?", which
-- reads the table from the blocked side as often as from the blocker's.
CREATE INDEX user_block_blocked_idx ON user_block (blocked_id);

COMMENT ON TABLE user_block IS
  'One member has blocked another (T-200). Directional, silent to the blocked member, and enforced by trigger rather than by a filter.';

-- ---------------------------------------------------------------------------
-- users_blocked(a, b)
-- ---------------------------------------------------------------------------
-- True when either member has blocked the other. One definition of "these two
-- must not reach each other", so that conversations (T-221), group invitations
-- (T-241) and notifications (T-271) cannot each grow their own slightly
-- different version of it.
CREATE FUNCTION users_blocked(a uuid, b uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_block
     WHERE (blocker_id = a AND blocked_id = b)
        OR (blocker_id = b AND blocked_id = a)
  )
$$;

COMMENT ON FUNCTION users_blocked(uuid, uuid) IS
  'Whether either member has blocked the other (T-200). The single definition of "these two must not reach each other".';

-- ---------------------------------------------------------------------------
-- The block, enforced
-- ---------------------------------------------------------------------------
CREATE FUNCTION refuse_across_block() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  first_id  uuid;
  second_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'friend_request' THEN
    first_id  := NEW.requester_id;
    second_id := NEW.addressee_id;
  ELSE
    first_id  := NEW.low_id;
    second_id := NEW.high_id;
  END IF;

  IF users_blocked(first_id, second_id) THEN
    RAISE EXCEPTION 'a block stands between these members'
      USING ERRCODE = 'PL003',
            HINT = 'one of them has blocked the other';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_across_block() IS
  'Refuses a friend request or a friendship when either member has blocked the other (T-200). SQLSTATE PL003.';

CREATE TRIGGER friend_request_block_guard
  BEFORE INSERT ON friend_request
  FOR EACH ROW EXECUTE FUNCTION refuse_across_block();

-- The same guard on the friendship, and not only for symmetry: a request that
-- predates the block is already a row, so accepting it is the realistic way a
-- friendship would otherwise be created across a block.
CREATE TRIGGER friendship_block_guard
  BEFORE INSERT ON friendship
  FOR EACH ROW EXECUTE FUNCTION refuse_across_block();

-- ---------------------------------------------------------------------------
-- The block, applied
-- ---------------------------------------------------------------------------
-- Blocking is retroactive: it ends the friendship and withdraws the open
-- requests in both directions. Doing it here rather than in the service means
-- there is no path — a script, a future endpoint, a migration — that creates a
-- block and leaves the friendship standing.
CREATE FUNCTION apply_block() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM friendship
   WHERE low_id  = LEAST(NEW.blocker_id, NEW.blocked_id)
     AND high_id = GREATEST(NEW.blocker_id, NEW.blocked_id);

  DELETE FROM friend_request
   WHERE (requester_id = NEW.blocker_id AND addressee_id = NEW.blocked_id)
      OR (requester_id = NEW.blocked_id AND addressee_id = NEW.blocker_id);

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION apply_block() IS
  'Ends the friendship and withdraws open requests between the pair when a block is created (T-200).';

CREATE TRIGGER user_block_applies
  AFTER INSERT ON user_block
  FOR EACH ROW EXECUTE FUNCTION apply_block();

-- Down Migration

DROP TRIGGER IF EXISTS user_block_applies ON user_block;
DROP TRIGGER IF EXISTS friendship_block_guard ON friendship;
DROP TRIGGER IF EXISTS friend_request_block_guard ON friend_request;
DROP FUNCTION IF EXISTS apply_block();
DROP FUNCTION IF EXISTS refuse_across_block();
DROP TABLE IF EXISTS user_block;
DROP TABLE IF EXISTS friend_request;
DROP TABLE IF EXISTS friendship;
DROP FUNCTION IF EXISTS users_blocked(uuid, uuid);
