-- Up Migration

-- T-251: the public match discussion (blueprint 10.2).
--
-- **The first surface where something a member writes is shown to the public**,
-- and the gate is the whole feature. Everything before this carried one
-- member's words to people who had already agreed to hear them — a friend, a
-- conversation, a group. A panel post is addressed to nobody and read by
-- everybody, including people who never signed in.
--
-- So the write path asks three questions before a row exists, and the schema
-- asks them rather than the service:
--
-- 1. **Did a person approve you?** `member_may_contribute()` (T-250). Not "do
--    you qualify" — qualifying is arithmetic and approval is somebody's
--    decision, and only the second one lets anybody speak here.
-- 2. **Are you restricted from posting?** A `post` sanction, which this
--    migration adds to `sanction.scope` because this is the migration that
--    builds the surface it covers (T-210's rule: never offer the moderation
--    team a scope nothing enforces).
-- 3. **Are you over the ceiling?** The same `refuse_over_rate` every other
--    surface uses.
--
-- **The order they refuse in is the order of the trigger names**, because
-- Postgres runs BEFORE triggers alphabetically: `approval` < `sanction` <
-- `volume`.
--
-- Approval first is deliberate, and it is the opposite of the precedence the
-- messaging surface chose. There, a member who was both restricted and over the
-- ceiling heard about the restriction, because that is the one they can appeal.
-- Here, an unapproved member who is also sanctioned is told they are not
-- approved — because that is the refusal that still applies after the sanction
-- ends. Telling them about the restriction would invite an appeal they could
-- win and still not be able to post.

-- ---------------------------------------------------------------------------
-- panel_post
-- ---------------------------------------------------------------------------
-- Shaped like `message` (T-220) rather than reinvented: the same tombstone, the
-- same removal-is-whole rule, the same refusal to be edited. A public post that
-- could be changed after it was quoted is worse than a private one that could,
-- not better.
--
-- **No `seq`.** A conversation numbers its messages because a client
-- reconnecting asks "everything after 41". A panel has no such client: it is
-- read, not subscribed to, and `(created_at, id)` is a stable enough cursor for
-- paging. A counter nobody reads is a column that has to be kept correct for
-- nothing.
CREATE TABLE panel_post (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id   uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  -- Null once removed. The tombstone below is the only way it becomes null.
  body         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz,
  removed_by   uuid REFERENCES user_account (id) ON DELETE SET NULL,
  -- A reader can tell "the author thought better of it" from "a moderator took
  -- it down", and only one of those is a moderation record.
  removed_kind text,
  CONSTRAINT panel_post_body_or_tombstone
    CHECK (
      (removed_at IS NULL AND body IS NOT NULL AND btrim(body) <> '')
      OR (removed_at IS NOT NULL AND body IS NULL)
    ),
  -- `removed_kind IS NOT NULL` is not redundant beside the `IN` list, and the
  -- reason is the trap this constraint was written around. `NULL IN ('author',
  -- 'moderator')` evaluates to NULL, a CHECK only fails on FALSE, and so the
  -- obvious spelling of this rule **admits a removal with no kind at all** --
  -- a post with its body gone and nothing saying whether the author or a
  -- moderator took it down. The same spelling is in `message_removal_is_whole`
  -- (T-220); tightening that one is its own change, not a detour here.
  --
  -- `removed_by` is deliberately not required. It is `ON DELETE SET NULL`, so a
  -- removal by somebody who later deleted their account keeps the fact and the
  -- kind and loses only the name -- the same trade predictions make (blueprint
  -- 1.6: they "remain as records without your name on them"). Requiring it
  -- would turn that cascade into a constraint violation and block the deletion.
  CONSTRAINT panel_post_removal_is_whole
    CHECK (
      (removed_at IS NULL AND removed_by IS NULL AND removed_kind IS NULL)
      OR (removed_at IS NOT NULL
          AND removed_kind IS NOT NULL
          AND removed_kind IN ('author', 'moderator'))
    )
);

-- The panel's own query: one fixture, newest last, paged by the cursor above.
CREATE INDEX panel_post_fixture_idx ON panel_post (fixture_id, created_at, id);
CREATE INDEX panel_post_author_idx ON panel_post (author_id, created_at DESC);

COMMENT ON TABLE panel_post IS
  'One post on a public match panel (blueprint 10.2, T-251). Posting needs a live contributor grant; removed by tombstone, never edited.';

-- ---------------------------------------------------------------------------
-- The refusals, in the order they fire
-- ---------------------------------------------------------------------------
CREATE FUNCTION refuse_unapproved_post() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT member_may_contribute(NEW.author_id) THEN
    RAISE EXCEPTION 'posting on a match panel needs an approved contributor grant'
      USING ERRCODE = 'PL014', HINT = 'no live contributor grant';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_unapproved_post() IS
  'Refuses a panel post from a member without a live contributor grant (T-251). SQLSTATE PL014.';

CREATE TRIGGER panel_post_approval_guard
  BEFORE INSERT ON panel_post
  FOR EACH ROW EXECUTE FUNCTION refuse_unapproved_post();

-- `post` joins the scope list here, in the migration that builds the surface it
-- covers. A scope a moderator could choose and no code applied would tell the
-- moderation team a restriction was in force when it was not (T-210).
ALTER TABLE sanction DROP CONSTRAINT sanction_scope_kind;
ALTER TABLE sanction ADD CONSTRAINT sanction_scope_kind
  CHECK (scope IN ('contact', 'messaging', 'groups', 'post'));

CREATE FUNCTION refuse_sanctioned_post() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF member_sanctioned(NEW.author_id, 'post') THEN
    RAISE EXCEPTION 'this member is under a posting restriction'
      USING ERRCODE = 'PL004', HINT = 'post';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_sanctioned_post() IS
  'Refuses a panel post from a member under an active post sanction (T-251). SQLSTATE PL004.';

CREATE TRIGGER panel_post_sanction_guard
  BEFORE INSERT ON panel_post
  FOR EACH ROW EXECUTE FUNCTION refuse_sanctioned_post();

-- Thirty an hour: far more than a contributor writes about the matches of one
-- evening, far fewer than a compromised account wants. A ceiling on a flood,
-- not a judgement about how much anybody should say.
INSERT INTO rate_limit (action, per_hour) VALUES ('panel_post', 30);

CREATE TRIGGER panel_post_volume_guard
  BEFORE INSERT ON panel_post
  FOR EACH ROW EXECUTE FUNCTION refuse_over_rate('panel_post', 'author_id');

-- ---------------------------------------------------------------------------
-- The only permitted UPDATE is the tombstone
-- ---------------------------------------------------------------------------
CREATE FUNCTION refuse_panel_post_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a panel post is removed by tombstone, never deleted'
      USING ERRCODE = 'PL007', HINT = 'set removed_at, removed_by and removed_kind';
  END IF;

  IF OLD.removed_at IS NOT NULL THEN
    -- One UPDATE is allowed on an already-removed post, and it is not one
    -- anybody asks for: the `ON DELETE SET NULL` cascade blanking `removed_by`
    -- when that account is deleted. The cascade is an ordinary UPDATE as far as
    -- this trigger is concerned, so refusing it would make deleting an account
    -- fail for anybody who had ever removed a post -- a wall discovered by the
    -- first member exercising blueprint 1.6's "you can delete your account",
    -- and reported as a moderation error they could make no sense of.
    IF OLD.removed_by IS NOT NULL
       AND NEW.removed_by IS NULL
       AND NEW.id = OLD.id
       AND NEW.fixture_id = OLD.fixture_id
       AND NEW.author_id = OLD.author_id
       AND NEW.body IS NOT DISTINCT FROM OLD.body
       AND NEW.created_at = OLD.created_at
       AND NEW.removed_at = OLD.removed_at
       AND NEW.removed_kind = OLD.removed_kind THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'this panel post has already been removed'
      USING ERRCODE = 'PL007';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.fixture_id IS DISTINCT FROM OLD.fixture_id
     OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.removed_at IS NULL THEN
    -- Correcting a published opinion is a new post that says what changed, the
    -- same rule the contributor rules put on analysis: "Getting something wrong
    -- and correcting it costs you nothing here. Quietly editing it does."
    RAISE EXCEPTION 'a panel post may only be removed, not edited'
      USING ERRCODE = 'PL007', HINT = 'a correction is a new post';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_panel_post_rewrite() IS
  'Allows the tombstone UPDATE and the removed_by cascade on a panel post, no other UPDATE and no DELETE (T-251). SQLSTATE PL007.';

CREATE TRIGGER panel_post_no_rewrite
  BEFORE UPDATE OR DELETE ON panel_post
  FOR EACH ROW EXECUTE FUNCTION refuse_panel_post_rewrite();

-- ---------------------------------------------------------------------------
-- A panel post becomes reportable
-- ---------------------------------------------------------------------------
-- Again in the migration that builds the surface, so the moderation team is
-- never offered a subject nothing can produce. **Reporting one needs no grant**:
-- reaching the public is gated, and getting help about somebody who has is not.
ALTER TABLE report DROP CONSTRAINT report_subject_kind;
ALTER TABLE report ADD CONSTRAINT report_subject_kind
  CHECK (subject_type IN ('member', 'message', 'group', 'panel_post'));

ALTER TABLE moderation_decision DROP CONSTRAINT moderation_decision_subject_kind;
ALTER TABLE moderation_decision ADD CONSTRAINT moderation_decision_subject_kind
  CHECK (subject_type IN ('member', 'message', 'group', 'panel_post'));

-- Down Migration

ALTER TABLE moderation_decision DROP CONSTRAINT moderation_decision_subject_kind;
ALTER TABLE moderation_decision ADD CONSTRAINT moderation_decision_subject_kind
  CHECK (subject_type IN ('member', 'message', 'group'));

ALTER TABLE report DROP CONSTRAINT report_subject_kind;
ALTER TABLE report ADD CONSTRAINT report_subject_kind
  CHECK (subject_type IN ('member', 'message', 'group'));

DROP TRIGGER IF EXISTS panel_post_no_rewrite ON panel_post;
DROP FUNCTION IF EXISTS refuse_panel_post_rewrite();
DROP TRIGGER IF EXISTS panel_post_volume_guard ON panel_post;
DELETE FROM rate_limit WHERE action = 'panel_post';
DROP TRIGGER IF EXISTS panel_post_sanction_guard ON panel_post;
DROP FUNCTION IF EXISTS refuse_sanctioned_post();
DROP TRIGGER IF EXISTS panel_post_approval_guard ON panel_post;
DROP FUNCTION IF EXISTS refuse_unapproved_post();
DROP TABLE IF EXISTS panel_post;

-- Last, because the rows that could carry a `post` scope are gone by now.
DELETE FROM sanction WHERE scope = 'post';
ALTER TABLE sanction DROP CONSTRAINT sanction_scope_kind;
ALTER TABLE sanction ADD CONSTRAINT sanction_scope_kind
  CHECK (scope IN ('contact', 'messaging', 'groups'));
