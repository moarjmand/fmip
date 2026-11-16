-- Up Migration

-- ---------------------------------------------------------------------------
-- Posts to X and Instagram (T-1834, D-427): the `social-publishing` module's
-- tables. Nothing here publishes; the store, the service and the publisher
-- come in T-1838 and T-1837.
--
-- `social_post` is one row per (fixture, kind, network). What it publishes is
-- frozen at drafting -- the text, the card's payload, the inputs read, the
-- gates as checked, the template's version, the forecast and model version
-- where the kind has one -- and a trigger refuses any later change to them:
-- an edit is a new row (`edited_from`). The same trigger holds the state
-- machine and ties every other column to the transition that may write it,
-- so a post is claimed once, published once, and a final row never changes.
--
-- The database, not the code, keeps:
--   * one live row per (fixture, kind, network) (a partial unique index);
--   * at most five posts a network's day (`slot` 1-5, unique per network and
--     Europe/London day, the day being the claim's; it resets at midnight there);
--   * that the job (`automation`) approves or claims a post only of a kind
--     that is `automatic`, only while the kill switch is off, and never a
--     sensitive post, an LLM's text or an edited one;
--   * that nothing is claimed for publishing while the kill switch is on;
--   * one prediction product per post (rule 6): forecast and verdict carry
--     the model's forecast (of the same fixture) and version, the result none;
--   * that only the console owner changes a kind's level, raising it only
--     from a clean run of 14 and only while publishing runs; the job only
--     lowers it.
--
-- Every person's action and every lowering by the job is a `console_audit`
-- row written in the same transaction (rule 10; actions `social.*`), so no
-- audit table of its own. `console_user.owner` marks the maintainer (at most
-- one), set by the console's command line, never by a route.
-- ---------------------------------------------------------------------------

ALTER TABLE console_user ADD COLUMN owner boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX console_user_one_owner ON console_user (owner) WHERE owner;

COMMENT ON COLUMN console_user.owner IS
  'The maintainer: the only console person who changes a social post kind''s automation level (D-427). At most one; set by the console CLI.';

-- Each kind's automation level and its run of clean posts (approved with no
-- edit and published with no error). 14 in a row make it eligible; only the
-- owner raises it; an error or the kill switch lowers it (`automation`).
CREATE TABLE social_automation (
  kind                    text PRIMARY KEY,
  level                   text NOT NULL DEFAULT 'approval',
  clean_run               integer NOT NULL DEFAULT 0,
  level_changed_at        timestamptz,
  level_changed_by        uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  level_changed_by_name   text,
  level_reason            text,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_automation_kind CHECK (kind IN ('forecast_pre_match', 'model_verdict', 'result')),
  CONSTRAINT social_automation_level CHECK (level IN ('approval', 'automatic')),
  CONSTRAINT social_automation_run_nonnegative CHECK (clean_run >= 0),
  -- An automatic kind was raised by a person. The run of 14 is checked when it is raised
  -- (the trigger): a rejection or an edit afterwards resets the run and leaves the level.
  CONSTRAINT social_automation_raised_by_person CHECK (level = 'approval' OR level_changed_by IS NOT NULL),
  CONSTRAINT social_automation_change_named CHECK (
    (level_changed_at IS NULL AND level_changed_by IS NULL AND level_changed_by_name IS NULL AND level_reason IS NULL)
    OR (level_changed_at IS NOT NULL AND level_changed_by_name IS NOT NULL
        AND level_reason IS NOT NULL AND btrim(level_reason) <> ''
        AND ((level_changed_by IS NOT NULL AND level_changed_by_name <> 'automation')
             OR (level_changed_by IS NULL AND level_changed_by_name = 'automation')))
  )
);

INSERT INTO social_automation (kind) VALUES ('forecast_pre_match'), ('model_verdict'), ('result');

COMMENT ON TABLE social_automation IS
  'Each social post kind''s automation level and clean run (D-427). All start at approval; only the console owner raises one, from 14 clean posts in a row.';

-- The kill switch: one row. While on, nothing is claimed for publishing and the job approves nothing;
-- the queue is kept. Either console person stops or resumes publishing, with a reason.
CREATE TABLE social_switch (
  id               boolean PRIMARY KEY DEFAULT true,
  stopped          boolean NOT NULL DEFAULT false,
  changed_at       timestamptz,
  changed_by       uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  changed_by_name  text,
  reason           text,
  CONSTRAINT social_switch_one_row CHECK (id),
  CONSTRAINT social_switch_change_named CHECK (
    (changed_at IS NULL AND changed_by IS NULL AND changed_by_name IS NULL AND reason IS NULL)
    OR (changed_at IS NOT NULL AND changed_by IS NOT NULL AND changed_by_name IS NOT NULL
        AND reason IS NOT NULL AND btrim(reason) <> '')
  )
);

INSERT INTO social_switch (id) VALUES (true);

COMMENT ON TABLE social_switch IS
  'The social posts'' kill switch, one row (D-427). Either console person stops or resumes publishing, with a reason.';

CREATE TABLE social_post (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id        uuid NOT NULL REFERENCES fixture (id) ON DELETE RESTRICT,
  kind              text NOT NULL,
  network           text NOT NULL,
  state             text NOT NULL DEFAULT 'pending_approval',
  origin            text NOT NULL DEFAULT 'template',
  template_version  text NOT NULL,
  body              text NOT NULL,
  payload           jsonb NOT NULL,
  inputs            jsonb NOT NULL,
  gates             jsonb NOT NULL,
  forecast_id       uuid REFERENCES forecast (id) ON DELETE RESTRICT,
  model_version     text,
  sensitive         boolean NOT NULL DEFAULT false,
  sensitive_reason  text,
  edited_from       uuid REFERENCES social_post (id) ON DELETE RESTRICT,
  expires_at        timestamptz NOT NULL,
  approved_by       uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  approved_by_name  text,
  approved_at       timestamptz,
  decided_by        uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  decided_by_name   text,
  decided_at        timestamptz,
  decided_reason    text,
  post_day          date,
  slot              smallint,
  claimed_at        timestamptz,
  provider_ref      text UNIQUE,
  published_at      timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_post_kind CHECK (kind IN ('forecast_pre_match', 'model_verdict', 'result')),
  CONSTRAINT social_post_network CHECK (network IN ('x', 'instagram')),
  CONSTRAINT social_post_state CHECK (state IN (
    'pending_approval', 'approved', 'publishing', 'published', 'refused', 'unknown',
    'rejected', 'expired', 'superseded'
  )),
  CONSTRAINT social_post_origin CHECK (origin IN ('template', 'llm')),
  CONSTRAINT social_post_template_version CHECK (template_version ~ '^[a-z_]+@[1-9][0-9]*$'),
  CONSTRAINT social_post_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT social_post_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT social_post_inputs_object CHECK (jsonb_typeof(inputs) = 'object'),
  CONSTRAINT social_post_gates_object CHECK (jsonb_typeof(gates) = 'object'),
  -- No image of any kind: no key naming one and no address or inline data as a value.
  -- A card is drawn from the payload, never from a crest, logo or photo.
  CONSTRAINT social_post_payload_no_image CHECK (
    payload::text !~* '"[a-z_]*(image|img|crest|logo|photo|picture|url|src)[a-z_]*"\s*:'
    AND payload::text !~* '"\s*(https?:|data:|//)'
  ),
  -- Rule 6: one product a post. The model's kinds carry its forecast and version; the result none.
  CONSTRAINT social_post_one_product CHECK (
    CASE kind
      WHEN 'result' THEN forecast_id IS NULL AND model_version IS NULL
      ELSE forecast_id IS NOT NULL AND model_version IS NOT NULL AND btrim(model_version) <> ''
    END
  ),
  CONSTRAINT social_post_sensitive_reason CHECK (
    (sensitive AND sensitive_reason IN ('politics', 'accident', 'death', 'racism', 'violence', 'betting', 'headlines_unreadable'))
    OR (NOT sensitive AND sensitive_reason IS NULL)
  ),
  -- An approval names who gave it; the job approves as `automation`, with no id.
  CONSTRAINT social_post_approval_named CHECK (
    (approved_at IS NULL AND approved_by IS NULL AND approved_by_name IS NULL)
    OR (approved_at IS NOT NULL AND approved_by_name IS NOT NULL
        AND ((approved_by IS NOT NULL AND approved_by_name <> 'automation')
             OR (approved_by IS NULL AND approved_by_name = 'automation')))
  ),
  -- The job never approves what must wait for a person (D-427 points 5, 6, 12).
  CONSTRAINT social_post_automation_only_clean CHECK (
    approved_by_name IS DISTINCT FROM 'automation'
    OR (NOT sensitive AND origin = 'template' AND edited_from IS NULL)
  ),
  -- Waiting means no approval; approved, publishing, published, refused and unknown mean one.
  CONSTRAINT social_post_approved_states CHECK (
    (state = 'pending_approval' AND approved_at IS NULL)
    OR state IN ('rejected', 'expired', 'superseded')
    OR (state NOT IN ('pending_approval', 'rejected', 'expired', 'superseded') AND approved_at IS NOT NULL)
  ),
  -- A person's decision (a rejection, a settlement of an unknown post) names the person and when.
  CONSTRAINT social_post_decision_named CHECK (
    (decided_at IS NULL AND decided_by IS NULL AND decided_by_name IS NULL AND decided_reason IS NULL)
    OR (decided_at IS NOT NULL AND decided_by IS NOT NULL AND decided_by_name IS NOT NULL)
  ),
  CONSTRAINT social_post_rejection_reason CHECK (
    state <> 'rejected'
    OR (decided_at IS NOT NULL AND decided_reason IS NOT NULL AND btrim(decided_reason) <> '')
  ),
  -- The cap: a slot 1-5 of the network's Europe/London day, held while publishing, published or unknown.
  CONSTRAINT social_post_slot_range CHECK (slot IS NULL OR slot BETWEEN 1 AND 5),
  CONSTRAINT social_post_slot_held CHECK (
    CASE WHEN state IN ('publishing', 'published', 'unknown')
      THEN slot IS NOT NULL AND post_day IS NOT NULL AND claimed_at IS NOT NULL
      ELSE slot IS NULL AND post_day IS NULL AND claimed_at IS NULL
    END
  ),
  -- The slot's day is the London day of the claim.
  CONSTRAINT social_post_day_of_claim CHECK (
    post_day IS NULL OR post_day = (claimed_at AT TIME ZONE 'Europe/London')::date
  ),
  CONSTRAINT social_post_published_ref CHECK (
    CASE WHEN state = 'published'
      THEN provider_ref IS NOT NULL AND published_at IS NOT NULL
      ELSE provider_ref IS NULL AND published_at IS NULL
    END
  )
);

-- One live row per (fixture, kind, network); a rejected, expired or superseded one makes room for a new draft.
CREATE UNIQUE INDEX social_post_one_live
  ON social_post (fixture_id, kind, network)
  WHERE state NOT IN ('rejected', 'expired', 'superseded');
-- Five a day per network: two posts never share a slot of the same day.
CREATE UNIQUE INDEX social_post_daily_slot
  ON social_post (network, post_day, slot)
  WHERE slot IS NOT NULL;
CREATE INDEX social_post_queue ON social_post (state, expires_at)
  WHERE state IN ('pending_approval', 'approved', 'refused', 'unknown');
CREATE INDEX social_post_kind_recent ON social_post (kind, created_at DESC);

-- What the job may do for a kind: it is automatic and publishing runs.
CREATE OR REPLACE FUNCTION social_automation_may_act(post_kind text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM social_automation a WHERE a.kind = post_kind AND a.level = 'automatic') THEN
    RAISE EXCEPTION 'automation acts only for an automatic kind; % is not (D-427)', post_kind;
  END IF;
  IF EXISTS (SELECT 1 FROM social_switch s WHERE s.stopped) THEN
    RAISE EXCEPTION 'automation does not act while publishing is stopped (D-427)';
  END IF;
END;
$$;

-- The state machine, the frozen columns, and which transition may write which column.
CREATE OR REPLACE FUNCTION social_post_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  moved boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'social_post rows are never deleted (D-427)';
  END IF;

  IF NEW.forecast_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM forecast f WHERE f.id = NEW.forecast_id AND f.fixture_id = NEW.fixture_id
  ) THEN
    RAISE EXCEPTION 'a social post''s forecast is of its own fixture (D-427)';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('pending_approval', 'approved') THEN
      RAISE EXCEPTION 'a social post is drafted waiting or approved, not %, (D-427)', NEW.state;
    END IF;
    IF NEW.approved_by_name = 'automation' THEN
      PERFORM social_automation_may_act(NEW.kind);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE.
  IF OLD.state IN ('published', 'rejected', 'expired', 'superseded') THEN
    RAISE EXCEPTION 'a % social post never changes (D-427)', OLD.state;
  END IF;
  IF NEW.fixture_id IS DISTINCT FROM OLD.fixture_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.network IS DISTINCT FROM OLD.network
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.inputs IS DISTINCT FROM OLD.inputs
     OR NEW.gates IS DISTINCT FROM OLD.gates
     OR NEW.forecast_id IS DISTINCT FROM OLD.forecast_id
     OR NEW.model_version IS DISTINCT FROM OLD.model_version
     OR NEW.edited_from IS DISTINCT FROM OLD.edited_from
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a social post is frozen once drafted; an edit is a new row (D-427)';
  END IF;

  moved := NEW.state <> OLD.state;
  IF moved AND NOT (
       (OLD.state = 'pending_approval' AND NEW.state IN ('approved', 'rejected', 'expired', 'superseded'))
    OR (OLD.state = 'approved' AND NEW.state IN ('publishing', 'pending_approval', 'rejected', 'expired', 'superseded'))
    OR (OLD.state = 'publishing' AND NEW.state IN ('published', 'refused', 'unknown'))
    OR (OLD.state = 'refused' AND NEW.state IN ('publishing', 'pending_approval', 'rejected', 'expired', 'superseded'))
    OR (OLD.state = 'unknown' AND NEW.state IN ('published', 'refused'))
  ) THEN
    RAISE EXCEPTION 'social post: % -> % is not a transition (D-427)', OLD.state, NEW.state;
  END IF;
  -- A claim happens once: a post already publishing is not claimed again.
  IF NOT moved AND NEW.state = 'publishing' THEN
    RAISE EXCEPTION 'a publishing social post is not claimed again (D-427)';
  END IF;

  -- The approval: given on approved, withdrawn going back to a person, never rewritten.
  IF moved AND NEW.state = 'approved' THEN
    IF NEW.approved_by_name = 'automation' THEN
      PERFORM social_automation_may_act(NEW.kind);
    END IF;
  ELSIF moved AND NEW.state = 'pending_approval' THEN
    IF NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.approved_by_name IS NOT NULL THEN
      RAISE EXCEPTION 'a social post sent back to a person carries no approval (D-427)';
    END IF;
  ELSIF (NEW.approved_by, NEW.approved_by_name, NEW.approved_at)
        IS DISTINCT FROM (OLD.approved_by, OLD.approved_by_name, OLD.approved_at) THEN
    RAISE EXCEPTION 'a social post''s approval is not rewritten (D-427)';
  END IF;

  -- The slot: taken by a claim, given back by a refusal, otherwise unchanged.
  IF moved AND NEW.state = 'publishing' THEN
    IF EXISTS (SELECT 1 FROM social_switch s WHERE s.stopped) THEN
      RAISE EXCEPTION 'nothing is claimed for publishing while publishing is stopped (D-427)';
    END IF;
    IF NEW.approved_by_name = 'automation' THEN
      PERFORM social_automation_may_act(NEW.kind);
    END IF;
  ELSIF NOT (moved AND NEW.state = 'refused')
        AND (NEW.slot, NEW.post_day, NEW.claimed_at) IS DISTINCT FROM (OLD.slot, OLD.post_day, OLD.claimed_at) THEN
    RAISE EXCEPTION 'a social post''s slot changes only by a claim or a refusal (D-427)';
  END IF;

  -- The publication: written once, on published.
  IF NOT (moved AND NEW.state = 'published')
     AND (NEW.provider_ref, NEW.published_at) IS DISTINCT FROM (OLD.provider_ref, OLD.published_at) THEN
    RAISE EXCEPTION 'a social post''s publication is written only when it is published (D-427)';
  END IF;

  -- A person's decision: a rejection, or the settlement of an unknown post.
  IF NOT (moved AND (NEW.state = 'rejected' OR OLD.state = 'unknown'))
     AND (NEW.decided_by, NEW.decided_by_name, NEW.decided_at, NEW.decided_reason)
         IS DISTINCT FROM (OLD.decided_by, OLD.decided_by_name, OLD.decided_at, OLD.decided_reason) THEN
    RAISE EXCEPTION 'a social post''s decision is written only by a rejection or a settlement (D-427)';
  END IF;

  -- Sensitivity found later: only ever to sensitive, only before publishing.
  IF (NEW.sensitive, NEW.sensitive_reason) IS DISTINCT FROM (OLD.sensitive, OLD.sensitive_reason)
     AND (OLD.sensitive OR OLD.state NOT IN ('pending_approval', 'approved', 'refused')) THEN
    RAISE EXCEPTION 'a social post''s sensitivity is only found, before publishing, never undone (D-427)';
  END IF;

  IF NOT moved AND NEW.last_error IS DISTINCT FROM OLD.last_error THEN
    RAISE EXCEPTION 'a social post''s error is written with its state (D-427)';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_post_guard
  BEFORE INSERT OR UPDATE OR DELETE ON social_post FOR EACH ROW EXECUTE FUNCTION social_post_guard();

COMMENT ON TABLE social_post IS
  'One post to X or Instagram per (fixture, kind, network), frozen at drafting, behind an approval queue (T-1834, D-427).';
COMMENT ON COLUMN social_post.inputs IS
  'What the post was built from, as read at drafting (fixture status, score, coverage, last_updated_at, forecast id and version, evaluation).';
COMMENT ON COLUMN social_post.slot IS
  'The post''s slot 1-5 of its network''s Europe/London day (post_day, the claim''s day): the daily cap of five, kept by a unique index.';

-- Who changes a kind's level, and when.
CREATE OR REPLACE FUNCTION social_automation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'social_automation rows are never deleted (D-427)';
  END IF;
  IF NEW.level <> OLD.level THEN
    -- Every change of level is a new change, recorded by whoever makes it.
    IF NEW.level_changed_at IS NOT DISTINCT FROM OLD.level_changed_at THEN
      RAISE EXCEPTION 'a change of level records its own time, person and reason (D-427)';
    END IF;
    IF NEW.level = 'automatic' THEN
      IF NEW.clean_run < 14 THEN
        RAISE EXCEPTION 'a social post kind becomes automatic only after 14 clean posts in a row (D-427)';
      END IF;
      IF EXISTS (SELECT 1 FROM social_switch s WHERE s.stopped) THEN
        RAISE EXCEPTION 'no kind is made automatic while publishing is stopped (D-427)';
      END IF;
    END IF;
    -- Raising is the owner's only; lowering the owner's or the job's.
    IF NOT (
      (NEW.level_changed_by IS NOT NULL AND EXISTS (
        SELECT 1 FROM console_user u
        WHERE u.id = NEW.level_changed_by AND u.owner AND u.disabled_at IS NULL
      ))
      OR (NEW.level = 'approval' AND NEW.level_changed_by IS NULL AND NEW.level_changed_by_name = 'automation')
    ) THEN
      RAISE EXCEPTION 'only the console owner changes a social post kind''s level (D-427)';
    END IF;
  ELSIF (NEW.level_changed_at, NEW.level_changed_by, NEW.level_changed_by_name, NEW.level_reason)
        IS DISTINCT FROM (OLD.level_changed_at, OLD.level_changed_by, OLD.level_changed_by_name, OLD.level_reason) THEN
    RAISE EXCEPTION 'a level''s change is recorded only with a change of level (D-427)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_automation_guard
  BEFORE UPDATE OR DELETE ON social_automation FOR EACH ROW EXECUTE FUNCTION social_automation_guard();

-- The publisher's key, encrypted (AES-256-GCM, key derived by HKDF from
-- SESSION_SECRET; the provider and row id as associated data). Never returned
-- by a route; the console shows only who set it and when.
CREATE TABLE social_credential (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL UNIQUE,
  ciphertext   bytea NOT NULL,
  iv           bytea NOT NULL,
  tag          bytea NOT NULL,
  set_at       timestamptz NOT NULL DEFAULT now(),
  set_by       uuid NOT NULL REFERENCES console_user (id) ON DELETE RESTRICT,
  set_by_name  text NOT NULL,
  CONSTRAINT social_credential_provider CHECK (provider IN ('buffer')),
  CONSTRAINT social_credential_iv_length CHECK (octet_length(iv) = 12),
  CONSTRAINT social_credential_tag_length CHECK (octet_length(tag) = 16),
  CONSTRAINT social_credential_ciphertext_present CHECK (octet_length(ciphertext) > 0)
);

COMMENT ON TABLE social_credential IS
  'The social publisher''s key, encrypted at rest (D-427). Never read back by any route.';

-- Down Migration

DROP TABLE social_credential;
DROP TRIGGER social_automation_guard ON social_automation;
DROP FUNCTION social_automation_guard();
DROP TRIGGER social_post_guard ON social_post;
DROP TABLE social_post;
DROP FUNCTION social_post_guard();
DROP FUNCTION social_automation_may_act(text);
DROP TABLE social_switch;
DROP TABLE social_automation;
DROP INDEX console_user_one_owner;
ALTER TABLE console_user DROP COLUMN owner;
