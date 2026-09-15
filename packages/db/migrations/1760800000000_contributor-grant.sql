-- Up Migration

-- T-250: who may post on a public panel (blueprint 9.4 and 10.2, D-059).
--
-- Blueprint 10.2 lists four measurable requirements and then a fifth that is a
-- person's decision. So there are two halves here and the whole task is
-- keeping them apart: the system says who **qualifies**, and a named human
-- **grants**. Nothing in this file can turn the first into the second.
--
-- **Eligibility is a view, and the view carries no verdict.** A view has no
-- INSERT path, so "eligibility never grants" is a property of the shape rather
-- than a rule somebody has to remember. And it stops at the facts -- rating,
-- sample, verified contact, conduct -- because the thresholds are configuration
-- (`13-policy.md` section 1) and already live in `ELIGIBILITY_V1`. A copy of
-- `70` in SQL would be a second place to change a number, and the day the two
-- disagreed the member and the moderator would be reading different answers.
--
-- **A grant is a row with a lifecycle, never a flag.** It names its approver,
-- its reason and the contributor rules the member accepted, with the version
-- (`13-policy.md` section 3). Pausing and withdrawing are rows of their own, so
-- "who approved this, and when did it stop" has an answer -- which a boolean
-- column could not give and an UPDATE would have destroyed.
--
-- **A grant does not consult eligibility again, ever.** `member_may_contribute`
-- asks only whether a live grant exists. A rating that dips to 69 must not
-- quietly undo a decision a person made and signed: eligibility does not
-- grant, and it does not revoke either. Withdrawal is somebody's act, with a
-- reason, exactly as the approval was.

-- ---------------------------------------------------------------------------
-- member_under_sanction(user_id)
-- ---------------------------------------------------------------------------
-- "Is this member under any restriction at all", which is a different question
-- from `member_sanctioned(user, scope)` and deliberately not spelled with one.
--
-- Conduct is one of the four requirements, and a version of it that named its
-- scopes would go stale the moment a scope was added: T-251 adds `post`, and an
-- eligibility check written as `member_sanctioned(m, 'contact')` would have
-- gone on reporting a clean record for a member restricted from the very thing
-- they were being considered for. A guard that lists its subjects stops
-- covering the ones added after it.
CREATE FUNCTION member_under_sanction(member uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM sanction
     WHERE user_id = member
       AND lifted_at IS NULL
       AND starts_at <= now()
       AND (ends_at IS NULL OR ends_at > now())
  )
$$;

COMMENT ON FUNCTION member_under_sanction(uuid) IS
  'Whether a member is under an active sanction of any scope, by the database clock (T-250). Not member_sanctioned(user, scope), which asks about one restriction.';

-- ---------------------------------------------------------------------------
-- contributor_eligibility_input
-- ---------------------------------------------------------------------------
-- The facts the four requirements are judged from, and not the judgement. The
-- name says so on purpose: somebody reading a query that selected from
-- `contributor_eligibility` would reasonably assume the answer was in it.
--
-- One row per member, including members with no rating yet -- `LEFT JOIN
-- LATERAL` rather than a join that would have dropped them. "Has settled
-- nothing" and "is not a member" are different answers and the caller needs
-- both (rule 3).
CREATE VIEW contributor_eligibility_input AS
SELECT u.id                              AS user_id,
       u.username,
       (u.email_verified_at IS NOT NULL) AS email_verified,
       r.rating,
       r.settled_count,
       member_under_sanction(u.id)       AS under_sanction,
       -- The conduct window's input, not the window itself: ninety days is
       -- configuration (`13-policy.md` section 1) and is applied where the
       -- other three thresholds are.
       (SELECT max(d.created_at)
          FROM moderation_decision d
         WHERE d.subject_type = 'member'
           AND d.subject_id = u.id::text
           AND d.outcome = 'sanctioned')  AS last_sanctioned_at
  FROM user_account u
  LEFT JOIN LATERAL (
    SELECT s.rating, s.settled_count
      FROM rating_snapshot s
     WHERE s.user_id = u.id
     ORDER BY s.computed_at DESC, s.id DESC
     LIMIT 1
  ) r ON true;

COMMENT ON VIEW contributor_eligibility_input IS
  'Per member: the facts the contributor requirements are judged from (T-250). Carries no verdict and no threshold; a view, so that eligibility has no way to grant anything.';

-- ---------------------------------------------------------------------------
-- contributor_grant
-- ---------------------------------------------------------------------------
-- The granting act. Immutable, like every other record of somebody's decision
-- in this schema (rule 10): what happens to a grant afterwards happens in
-- `contributor_grant_event`.
--
-- **`granted_by = user_id` is not refused**, and that is a decision rather than
-- an oversight. An administrator approving themselves is visible -- the row
-- names them twice -- and at launch the founder may well be the only person who
-- can grant anything. Refusing it would invent a rule the blueprint does not
-- have, and it would be discovered as a wall on the first day.
CREATE TABLE contributor_grant (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  granted_by    uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  reason        text NOT NULL,
  -- Which contributor rules were accepted, and when. Acceptance is recorded
  -- against a version because changing what is allowed means a new version and
  -- a new acceptance (`13-policy.md`), and a grant that stored only a boolean
  -- could not say which words the member agreed to.
  rules_version text NOT NULL,
  accepted_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contributor_grant_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT contributor_grant_rules_format
    CHECK (rules_version ~ '^[a-z0-9-]+@[0-9]+\.[0-9]+\.[0-9]+$')
);

CREATE INDEX contributor_grant_user_idx ON contributor_grant (user_id, created_at DESC);

COMMENT ON TABLE contributor_grant IS
  'One approval to post on a public panel: who granted it, why, and which contributor rules the member accepted (blueprint 9.4, T-250). Immutable; its lifecycle is in contributor_grant_event.';

CREATE TRIGGER contributor_grant_immutable
  BEFORE UPDATE OR DELETE ON contributor_grant FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- ---------------------------------------------------------------------------
-- contributor_grant_event
-- ---------------------------------------------------------------------------
-- Everything that happens to a grant after it is given: paused, resumed,
-- withdrawn. Each names an actor and a reason, each is immutable, and the
-- grant's standing is read from them rather than stored beside them.
CREATE TABLE contributor_grant_event (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic within the table, and the tie-break the standing below needs:
  -- two events written in one transaction share `now()` exactly, and a uuid
  -- tie-break would have settled pause-then-resume by coin toss.
  seq        bigserial NOT NULL,
  grant_id   uuid NOT NULL REFERENCES contributor_grant (id) ON DELETE RESTRICT,
  kind       text NOT NULL,
  actor_id   uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contributor_grant_event_kind CHECK (kind IN ('paused', 'resumed', 'withdrawn')),
  CONSTRAINT contributor_grant_event_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE INDEX contributor_grant_event_grant_idx
  ON contributor_grant_event (grant_id, created_at DESC, seq DESC);

COMMENT ON TABLE contributor_grant_event IS
  'A pause, resume or withdrawal of one contributor grant (blueprint 9.4, T-250). Immutable, names its actor and reason; the grant standing is derived from the newest one.';

CREATE TRIGGER contributor_grant_event_immutable
  BEFORE UPDATE OR DELETE ON contributor_grant_event FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- ---------------------------------------------------------------------------
-- contributor_grant_standing(grant_id)
-- ---------------------------------------------------------------------------
-- The single definition of what a grant currently is, written once here so that
-- no surface grows its own -- the same reason `users_blocked` and
-- `member_sanctioned` exist.
-- The parameter is `approval` rather than the obvious `grant`, which is a
-- reserved word, and rather than `grant_id`, which would have been ambiguous
-- with the column of that name inside the body.
CREATE FUNCTION contributor_grant_standing(approval uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT CASE e.kind WHEN 'resumed' THEN 'active' ELSE e.kind END
       FROM contributor_grant_event e
      WHERE e.grant_id = approval
      ORDER BY e.created_at DESC, e.seq DESC
      LIMIT 1),
    -- No events is the ordinary case: a grant nobody has touched since it was
    -- given.
    'active')
$$;

COMMENT ON FUNCTION contributor_grant_standing(uuid) IS
  'active, paused or withdrawn, from the newest event on the grant (T-250).';

-- ---------------------------------------------------------------------------
-- member_may_contribute(user_id)
-- ---------------------------------------------------------------------------
-- What T-251 asks before letting a member post, and the only question it should
-- ask about approval. It does **not** re-check eligibility: see the header.
CREATE FUNCTION member_may_contribute(member uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM contributor_grant g
     WHERE g.user_id = member
       AND contributor_grant_standing(g.id) = 'active'
  )
$$;

COMMENT ON FUNCTION member_may_contribute(uuid) IS
  'Whether a member holds a live contributor grant (T-250). Approval only; a sanction is a separate question, asked by its own guard.';

-- ---------------------------------------------------------------------------
-- The transitions that are not possible
-- ---------------------------------------------------------------------------
-- Refused at the write path rather than filtered at the read path, for the
-- reason T-210 gives: a withdrawal that silently did nothing would leave a
-- moderator believing they had acted.
--
-- This is a guard against mistakes, not a lock. Two moderators pausing the same
-- grant in the same instant can both be admitted, and the result is two pause
-- rows and a paused grant. That is the right failure: the trail shows both
-- people, and neither of them is told something untrue.
CREATE FUNCTION refuse_impossible_grant_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE standing text;
BEGIN
  standing := contributor_grant_standing(NEW.grant_id);
  IF standing = 'withdrawn' THEN
    RAISE EXCEPTION 'this grant was withdrawn; a new approval is a new grant'
      USING ERRCODE = 'PL013', HINT = 'withdrawn';
  END IF;
  IF NEW.kind = 'paused' AND standing = 'paused' THEN
    RAISE EXCEPTION 'this grant is already paused'
      USING ERRCODE = 'PL013', HINT = 'paused';
  END IF;
  IF NEW.kind = 'resumed' AND standing <> 'paused' THEN
    RAISE EXCEPTION 'this grant is not paused'
      USING ERRCODE = 'PL013', HINT = 'active';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_impossible_grant_event() IS
  'Refuses an event on a withdrawn grant, a second pause, or a resume of something not paused (T-250). SQLSTATE PL013.';

CREATE TRIGGER contributor_grant_event_transition_guard
  BEFORE INSERT ON contributor_grant_event
  FOR EACH ROW EXECUTE FUNCTION refuse_impossible_grant_event();

-- A member holds at most one grant that has not been withdrawn. Two live grants
-- would make "when did it stop" ambiguous, which is the one question this table
-- exists to answer.
CREATE FUNCTION refuse_second_live_grant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM contributor_grant g
     WHERE g.user_id = NEW.user_id
       AND contributor_grant_standing(g.id) <> 'withdrawn'
  ) THEN
    RAISE EXCEPTION 'this member already holds a contributor grant'
      USING ERRCODE = 'PL013', HINT = 'already granted';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_second_live_grant() IS
  'Refuses a second grant to a member whose existing one has not been withdrawn (T-250). SQLSTATE PL013.';

CREATE TRIGGER contributor_grant_one_live_guard
  BEFORE INSERT ON contributor_grant
  FOR EACH ROW EXECUTE FUNCTION refuse_second_live_grant();

-- Down Migration

DROP TRIGGER IF EXISTS contributor_grant_one_live_guard ON contributor_grant;
DROP FUNCTION IF EXISTS refuse_second_live_grant();
DROP TRIGGER IF EXISTS contributor_grant_event_transition_guard ON contributor_grant_event;
DROP FUNCTION IF EXISTS refuse_impossible_grant_event();
DROP FUNCTION IF EXISTS member_may_contribute(uuid);
DROP TRIGGER IF EXISTS contributor_grant_event_immutable ON contributor_grant_event;
DROP TABLE IF EXISTS contributor_grant_event;
DROP FUNCTION IF EXISTS contributor_grant_standing(uuid);
DROP TRIGGER IF EXISTS contributor_grant_immutable ON contributor_grant;
DROP TABLE IF EXISTS contributor_grant;
DROP VIEW IF EXISTS contributor_eligibility_input;
DROP FUNCTION IF EXISTS member_under_sanction(uuid);
