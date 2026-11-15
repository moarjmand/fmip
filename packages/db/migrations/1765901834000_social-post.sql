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
-- machine, so a published post can never be published again.
--
-- The database, not the code, keeps:
--   * one live row per (fixture, kind, network) (a partial unique index);
--   * at most five posts a network's day (`slot` 1-5, unique per network and
--     Europe/London day; the day resets at midnight there);
--   * that the job (`automation`) never approves a sensitive post, an LLM's
--     text or an edited one (a CHECK);
--   * one prediction product per post (rule 6): forecast and verdict carry
--     the model's forecast and version, the result carries none;
--   * that only the console owner raises a kind to `automatic`, and only once
--     its clean run reached 14 (a CHECK and a trigger).
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
  -- No image address of any kind: a card is drawn from the payload, never from a crest or photo.
  CONSTRAINT social_post_payload_no_image CHECK (payload::text !~* '"(image|img|crest|logo|photo|url)[a-z_]*"\s*:'),
  -- Rule 6: one product a post. The model's kinds carry its forecast and version; the result none.
  CONSTRAINT social_post_one_product CHECK (
    CASE kind
      WHEN 'result' THEN forecast_id IS NULL AND model_version IS NULL
      ELSE forecast_id IS NOT NULL AND model_version IS NOT NULL AND btrim(model_version) <> ''
    END
  ),
  CONSTRAINT social_post_sensitive_reason CHECK (
    (sensitive AND sensitive_reason IN ('politics', 'accident', 'death', 'racism', 'betting', 'headlines_unreadable'))
    OR (NOT sensitive AND sensitive_reason IS NULL)
  ),
  -- An approval names who gave it; the job approves as `automation`, with no id.
  CONSTRAINT social_post_approval_named CHECK (
    (approved_at IS NULL AND approved_by IS NULL AND approved_by_name IS NULL)
    OR (approved_at IS NOT NULL AND approved_by_name IS NOT NULL
        AND (approved_by IS NOT NULL OR approved_by_name = 'automation'))
  ),
  -- The job never approves what must wait for a person (D-427 points 5, 6, 12).
  CONSTRAINT social_post_automation_only_clean CHECK (
    approved_by_name IS DISTINCT FROM 'automation'
    OR (approved_by IS NULL AND NOT sensitive AND origin = 'template' AND edited_from IS NULL)
  ),
  CONSTRAINT social_post_approved_states CHECK (
    state IN ('pending_approval', 'rejected', 'expired', 'superseded') OR approved_at IS NOT NULL
  ),
  CONSTRAINT social_post_rejection_reason CHECK (
    state <> 'rejected'
    OR (decided_reason IS NOT NULL AND btrim(decided_reason) <> '' AND decided_by_name IS NOT NULL)
  ),
  -- The cap: a slot 1-5 of the network's Europe/London day, held while publishing, published or unknown.
  CONSTRAINT social_post_slot_range CHECK (slot IS NULL OR slot BETWEEN 1 AND 5),
  CONSTRAINT social_post_slot_held CHECK (
    CASE WHEN state IN ('publishing', 'published', 'unknown')
      THEN slot IS NOT NULL AND post_day IS NOT NULL AND claimed_at IS NOT NULL
      ELSE slot IS NULL AND post_day IS NULL
    END
  ),
  CONSTRAINT social_post_published_ref CHECK (
    state <> 'published' OR (provider_ref IS NOT NULL AND published_at IS NOT NULL)
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

-- The state machine and the frozen columns.
CREATE OR REPLACE FUNCTION social_post_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'social_post rows are never deleted (D-427)';
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
  -- Sensitivity found later only ever sends a post to a person, never back.
  IF OLD.sensitive AND NOT NEW.sensitive THEN
    RAISE EXCEPTION 'a sensitive social post stays sensitive (D-427)';
  END IF;
  IF OLD.provider_ref IS NOT NULL AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref THEN
    RAISE EXCEPTION 'a social post''s provider reference is never changed (D-427)';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'pending_approval' AND NEW.state IN ('approved', 'rejected', 'expired', 'superseded'))
    OR (OLD.state = 'approved' AND NEW.state IN ('publishing', 'pending_approval', 'expired', 'superseded'))
    OR (OLD.state = 'publishing' AND NEW.state IN ('published', 'refused', 'unknown'))
    OR (OLD.state = 'refused' AND NEW.state IN ('publishing', 'expired', 'superseded'))
    OR (OLD.state = 'unknown' AND NEW.state IN ('published', 'refused'))
  ) THEN
    RAISE EXCEPTION 'social post: % -> % is not a transition (D-427)', OLD.state, NEW.state;
  END IF;
  -- Back to a person: the approval is withdrawn with it.
  IF OLD.state = 'approved' AND NEW.state = 'pending_approval'
     AND (NEW.approved_at IS NOT NULL OR NEW.approved_by_name IS NOT NULL) THEN
    RAISE EXCEPTION 'a social post sent back to a person carries no approval (D-427)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_post_guard
  BEFORE UPDATE OR DELETE ON social_post FOR EACH ROW EXECUTE FUNCTION social_post_guard();

COMMENT ON TABLE social_post IS
  'One post to X or Instagram per (fixture, kind, network), frozen at drafting, behind an approval queue (T-1834, D-427).';
COMMENT ON COLUMN social_post.inputs IS
  'What the post was built from, as read at drafting (fixture status, score, coverage, last_updated_at, forecast id and version, evaluation).';
COMMENT ON COLUMN social_post.slot IS
  'The post''s slot 1-5 of its network''s Europe/London day (post_day): the daily cap of five, kept by a unique index.';

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
  -- An automatic kind must have earned it, and been raised by a person.
  CONSTRAINT social_automation_earned CHECK (
    level = 'approval' OR (clean_run >= 14 AND level_changed_by IS NOT NULL)
  ),
  CONSTRAINT social_automation_change_named CHECK (
    (level_changed_at IS NULL AND level_changed_by_name IS NULL AND level_reason IS NULL)
    OR (level_changed_at IS NOT NULL AND level_changed_by_name IS NOT NULL
        AND level_reason IS NOT NULL AND btrim(level_reason) <> ''
        AND (level_changed_by IS NOT NULL OR level_changed_by_name = 'automation'))
  )
);

CREATE OR REPLACE FUNCTION social_automation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'social_automation rows are never deleted (D-427)';
  END IF;
  IF NEW.level = 'automatic' AND OLD.level = 'approval' THEN
    IF NOT EXISTS (
      SELECT 1 FROM console_user u
      WHERE u.id = NEW.level_changed_by AND u.owner AND u.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'only the console owner makes a social post kind automatic (D-427)';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_automation_guard
  BEFORE UPDATE OR DELETE ON social_automation FOR EACH ROW EXECUTE FUNCTION social_automation_guard();

INSERT INTO social_automation (kind) VALUES ('forecast_pre_match'), ('model_verdict'), ('result');

COMMENT ON TABLE social_automation IS
  'Each social post kind''s automation level and clean run (D-427). All start at approval; only the console owner raises one, from 14 clean posts in a row.';

-- The kill switch: one row. While on, nothing is published and the job approves nothing; the queue is kept.
-- Either console person turns it on or off, with a reason.
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
DROP TABLE social_switch;
DROP TRIGGER social_automation_guard ON social_automation;
DROP TABLE social_automation;
DROP FUNCTION social_automation_guard();
DROP TRIGGER social_post_guard ON social_post;
DROP TABLE social_post;
DROP FUNCTION social_post_guard();
DROP INDEX console_user_one_owner;
ALTER TABLE console_user DROP COLUMN owner;
