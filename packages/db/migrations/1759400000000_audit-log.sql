-- Up Migration

-- The audit log (rule 10, T-070, D-046): one immutable row per high-impact
-- administrative action — who, when, what, on which record, why, and the
-- value before and after. Written in the same transaction as the change it
-- records, so there is never a change without its record.
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  -- 'user.status', 'coverage.set', …: a dotted noun.verb naming the action.
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  reason      text NOT NULL,
  previous    jsonb,
  next        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_format CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT audit_log_reason_not_blank CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE audit_log IS
  'Who did what to which record, why, and what it was before (CLAUDE.md rule 10). Immutable.';

CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id);

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TABLE audit_log;
