-- Up Migration

-- T-210: the moderation spine (blueprint 10.4 and 16, D-053) — reports,
-- decisions, sanctions and appeal notes.
--
-- D-053 moved this epic from the end of Phase 3 to the front of it: every
-- surface after this one carries one member's words to another, and a reporting
-- queue that arrives two epics late arrives after the member who needed it. So
-- the machinery exists before the first message can be sent.
--
-- Three rules shape the schema, and the third is the one that would be easiest
-- to get wrong.
--
-- **A decision is immutable and names its actor.** Rule 10 in a table: who,
-- when, what, why. A moderation record that can be edited afterwards is not a
-- record, and the first time it matters is the first time somebody disputes it.
--
-- **Every sanction ends, or says out loud that it does not.** `permanent` is a
-- column and a CHECK, not a null nobody noticed: a restriction with no end is
-- one somebody has to remember to lift, and nobody does.
--
-- **Nothing is listed here that nothing can enforce.** A `scope` a moderator
-- can choose and no code applies is a promise to the moderation team that the
-- product does not keep — rule 3, aimed at an operator instead of a reader. So
-- `sanction.scope` allows exactly one value today, `contact`, because friend
-- requests are the only thing one member can currently aim at another; and
-- `report.subject_type` allows exactly one, `member`. Each later epic widens
-- its own CHECK in the same migration that builds the surface it protects
-- (messages in T-220, groups in T-240, public posting in T-251, analysis in
-- T-260).

-- ---------------------------------------------------------------------------
-- moderation_decision
-- ---------------------------------------------------------------------------
-- Immutable, like the audit log and for the same reason (rule 10).
--
-- **A decision answers reports; a report does not carry a decision's id the
-- other way round.** Three members reporting one person is three reports and
-- one judgement, so `report.decision_id` points here and several rows may point
-- at the same decision. A moderator who read all three and issued one sanction
-- has made one decision, and the table should not make them write it out three
-- times.
CREATE TABLE moderation_decision (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  subject_type text NOT NULL,
  subject_id   text NOT NULL,
  outcome      text NOT NULL,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_decision_subject_kind CHECK (subject_type IN ('member')),
  CONSTRAINT moderation_decision_outcome_kind
    CHECK (outcome IN ('no_action', 'warned', 'content_removed', 'sanctioned')),
  -- A decision with no reason is a decision nobody can review (rule 10).
  CONSTRAINT moderation_decision_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE INDEX moderation_decision_subject_idx ON moderation_decision (subject_type, subject_id);

COMMENT ON TABLE moderation_decision IS
  'One immutable moderation decision: who decided, about what, what they did and why (T-210).';

CREATE TRIGGER moderation_decision_immutable
  BEFORE UPDATE OR DELETE ON moderation_decision FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- ---------------------------------------------------------------------------
-- report
-- ---------------------------------------------------------------------------
CREATE TABLE report (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  -- `text` rather than a foreign key for the same reason `audit_log.target_id`
  -- is: the subject is one of several tables, chosen by `subject_type`.
  subject_type text NOT NULL,
  subject_id   text NOT NULL,
  reason       text NOT NULL,
  -- What the reporter wants the moderator to see. Required when the reason is
  -- `other`, because "other" on its own is a report nobody can act on.
  detail       text,
  -- The decision that answered it, and the only record of whether it is open.
  -- Not a `resolved_at` beside it: "open" is a fact about whether an answer
  -- exists, and two places to record one fact is one place too many.
  decision_id  uuid REFERENCES moderation_decision (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_subject_kind CHECK (subject_type IN ('member')),
  CONSTRAINT report_reason_kind
    CHECK (reason IN ('spam', 'abuse', 'impersonation', 'other')),
  CONSTRAINT report_detail_required
    CHECK (reason <> 'other' OR btrim(coalesce(detail, '')) <> ''),
  CONSTRAINT report_detail_not_blank CHECK (detail IS NULL OR btrim(detail) <> ''),
  -- Reporting yourself is not a thing the product has an answer for.
  CONSTRAINT report_not_self CHECK (NOT (subject_type = 'member' AND subject_id = reporter_id::text))
);

-- One open report per reporter per subject. Filing the same complaint fifty
-- times is not fifty complaints, and a queue full of them is a queue nobody
-- reads.
CREATE UNIQUE INDEX report_one_open_per_subject
  ON report (reporter_id, subject_type, subject_id)
  WHERE decision_id IS NULL;

-- The queue's own query: oldest first, because a report that waits longest is
-- the one that has waited longest.
CREATE INDEX report_open_idx ON report (created_at) WHERE decision_id IS NULL;
CREATE INDEX report_subject_idx ON report (subject_type, subject_id);

COMMENT ON TABLE report IS
  'A member reporting something to the moderation team (blueprint 10.4, T-210). Open exactly while decision_id is null; one decision may answer several.';

-- ---------------------------------------------------------------------------
-- sanction
-- ---------------------------------------------------------------------------
-- A restriction on one member, always descended from a decision — which is how
-- "every sanction has an actor and a reason" stops being a convention and
-- becomes a foreign key.
CREATE TABLE sanction (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  decision_id uuid NOT NULL REFERENCES moderation_decision (id) ON DELETE RESTRICT,
  scope       text NOT NULL,
  -- The group or conversation a scoped sanction applies to, when the scope has
  -- one. Null for a scope that is about the member everywhere.
  scope_id    text,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  -- Not derived from `ends_at IS NULL`: a moderator choosing "permanent" and a
  -- moderator forgetting to set an end must not look the same in the table.
  permanent   boolean NOT NULL,
  lifted_at   timestamptz,
  lifted_by   uuid REFERENCES user_account (id) ON DELETE RESTRICT,
  lift_reason text,
  CONSTRAINT sanction_scope_kind CHECK (scope IN ('contact')),
  CONSTRAINT sanction_ends_or_is_permanent
    CHECK ((permanent AND ends_at IS NULL) OR (NOT permanent AND ends_at IS NOT NULL)),
  CONSTRAINT sanction_ends_after_it_starts CHECK (ends_at IS NULL OR ends_at > starts_at),
  -- Lifting one early is an act with an actor and a reason, or it did not
  -- happen (rule 10).
  CONSTRAINT sanction_lift_is_whole
    CHECK (
      (lifted_at IS NULL AND lifted_by IS NULL AND lift_reason IS NULL)
      OR (lifted_at IS NOT NULL AND lifted_by IS NOT NULL AND btrim(coalesce(lift_reason, '')) <> '')
    )
);

CREATE INDEX sanction_user_idx ON sanction (user_id, scope);

COMMENT ON TABLE sanction IS
  'A restriction on one member, descended from a decision (T-210). Ends, or says permanent; lifting it early records who and why.';

-- ---------------------------------------------------------------------------
-- appeal_note
-- ---------------------------------------------------------------------------
-- Blueprint 10.4 asks for appeal notes. A row rather than somebody's inbox,
-- because a sanction whose appeal lives in an e-mail has no audit history.
CREATE TABLE appeal_note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sanction_id uuid NOT NULL REFERENCES sanction (id) ON DELETE RESTRICT,
  author_id   uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appeal_note_body_not_blank CHECK (btrim(body) <> '')
);

CREATE INDEX appeal_note_sanction_idx ON appeal_note (sanction_id, created_at);

COMMENT ON TABLE appeal_note IS
  'A note on the appeal of one sanction, from the member or a moderator (blueprint 10.4, T-210). Immutable.';

CREATE TRIGGER appeal_note_immutable
  BEFORE UPDATE OR DELETE ON appeal_note FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- ---------------------------------------------------------------------------
-- member_sanctioned(user_id, scope)
-- ---------------------------------------------------------------------------
-- The single definition of "this member is currently restricted from this",
-- written once here so that every surface Phase 3 adds asks the same question
-- rather than growing its own slightly different version of it — the same
-- reason `users_blocked` exists (T-200).
CREATE FUNCTION member_sanctioned(member uuid, restriction text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM sanction
     WHERE user_id = member
       AND scope = restriction
       AND lifted_at IS NULL
       AND starts_at <= now()
       AND (ends_at IS NULL OR ends_at > now())
  )
$$;

COMMENT ON FUNCTION member_sanctioned(uuid, text) IS
  'Whether a member is under an active sanction of this scope, by the database clock (T-210).';

-- ---------------------------------------------------------------------------
-- The sanction, enforced at the write path
-- ---------------------------------------------------------------------------
-- A restriction that only hid what a member wrote would not be a restriction:
-- the member would still believe they were being heard, the queue would keep
-- refilling, and nobody's behaviour would change. So the write is refused, and
-- the API turns PL004 into a sentence that says so and until when.
CREATE FUNCTION refuse_sanctioned_contact() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF member_sanctioned(NEW.requester_id, 'contact') THEN
    RAISE EXCEPTION 'this member is under a contact restriction'
      USING ERRCODE = 'PL004', HINT = 'a moderation sanction is in force';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_sanctioned_contact() IS
  'Refuses a friend request from a member under an active contact sanction (T-210). SQLSTATE PL004.';

CREATE TRIGGER friend_request_sanction_guard
  BEFORE INSERT ON friend_request
  FOR EACH ROW EXECUTE FUNCTION refuse_sanctioned_contact();

-- Down Migration

DROP TRIGGER IF EXISTS friend_request_sanction_guard ON friend_request;
DROP FUNCTION IF EXISTS refuse_sanctioned_contact();
DROP TRIGGER IF EXISTS appeal_note_immutable ON appeal_note;
DROP TABLE IF EXISTS appeal_note;
DROP TABLE IF EXISTS sanction;
DROP TABLE IF EXISTS report;
DROP TRIGGER IF EXISTS moderation_decision_immutable ON moderation_decision;
DROP TABLE IF EXISTS moderation_decision;
DROP FUNCTION IF EXISTS member_sanctioned(uuid, text);
