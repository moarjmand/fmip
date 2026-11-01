-- Up Migration

-- ---------------------------------------------------------------------------
-- The agents console (T-1696, D-340): `agents.traveltohormuz.ir`, for the
-- maintainer and the teammate, apart from the site's members.
--
-- Its people are not members: `console_user` has its own names and passwords,
-- opened only by a one-time invitation made on the server, and its own
-- sessions. What they do is in `console_audit`, immutable like `audit_log`
-- (rule 10), whose actor must be a member and so cannot be used here.
--
-- What the console shows comes from the maintainer's computer as one snapshot
-- at a time (`console_snapshot`); what is asked of the computer waits in
-- `console_command` until the computer takes it. The project board lives
-- here (`console_board_card`), moved once from its claude.ai page.
-- ---------------------------------------------------------------------------

CREATE TABLE console_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text NOT NULL,
  display_name   text NOT NULL,
  password_hash  text NOT NULL,
  failed_logins  integer NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  disabled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_user_username_format CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'),
  CONSTRAINT console_user_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT console_user_failed_logins_nonnegative CHECK (failed_logins >= 0)
);

CREATE UNIQUE INDEX console_user_username ON console_user (username);

-- A one-time invitation: the link carries the token, the table only its hash.
CREATE TABLE console_invite (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  used_by       uuid REFERENCES console_user (id) ON DELETE SET NULL,
  CONSTRAINT console_invite_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT console_invite_expires_after_creation CHECK (expires_at > created_at),
  CONSTRAINT console_invite_used_by_when_used CHECK (used_by IS NULL OR used_at IS NOT NULL)
);

CREATE TABLE console_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES console_user (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);

CREATE INDEX console_session_user ON console_session (user_id);

-- Who did what in the console. A failed sign-in has no actor, only the name
-- that was tried.
CREATE TABLE console_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  actor_name   text NOT NULL,
  action       text NOT NULL,
  target_type  text NOT NULL,
  target_id    text NOT NULL,
  reason       text NOT NULL,
  previous     jsonb,
  next         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_audit_action_format CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT console_audit_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE INDEX console_audit_created ON console_audit (created_at DESC);

CREATE TRIGGER console_audit_immutable
  BEFORE UPDATE OR DELETE ON console_audit FOR EACH ROW EXECUTE FUNCTION refuse_change();

COMMENT ON TABLE console_audit IS
  'Who did what in the agents console, why, and what it was before (rule 10, D-340). Immutable.';

-- One snapshot per publish from the maintainer's computer; the newest is shown.
CREATE TABLE console_snapshot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at  timestamptz NOT NULL,
  loaded_at     timestamptz NOT NULL DEFAULT now(),
  schema        integer NOT NULL,
  payload       jsonb NOT NULL,
  CONSTRAINT console_snapshot_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX console_snapshot_generated ON console_snapshot (generated_at DESC);

-- What a person asked of the computer, taken and answered by it.
CREATE TABLE console_command (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  target        text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued',
  requested_by  uuid NOT NULL REFERENCES console_user (id) ON DELETE RESTRICT,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  taken_at      timestamptz,
  finished_at   timestamptz,
  outcome       text,
  CONSTRAINT console_command_kind CHECK (
    kind IN ('agent.pause', 'agent.resume', 'agent.run', 'agent.model', 'agent.schedule', 'decision.answer')
  ),
  CONSTRAINT console_command_status CHECK (status IN ('queued', 'taken', 'done', 'failed', 'cancelled')),
  CONSTRAINT console_command_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT console_command_finished_has_outcome
    CHECK (status NOT IN ('done', 'failed') OR (finished_at IS NOT NULL AND outcome IS NOT NULL))
);

CREATE INDEX console_command_open ON console_command (requested_at) WHERE status IN ('queued', 'taken');

CREATE TABLE console_board_card (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  column_key   text NOT NULL,
  position     integer NOT NULL DEFAULT 0,
  labels       text[] NOT NULL DEFAULT '{}',
  assignee     text,
  due_on       date,
  source_ref   text UNIQUE,
  created_by   uuid REFERENCES console_user (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES console_user (id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CONSTRAINT console_board_card_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT console_board_card_column_format CHECK (column_key ~ '^[a-z][a-z0-9_-]{0,31}$')
);

CREATE INDEX console_board_card_column ON console_board_card (column_key, position) WHERE archived_at IS NULL;

-- Down Migration

DROP TABLE console_board_card;
DROP TABLE console_command;
DROP TABLE console_snapshot;
DROP TABLE console_audit;
DROP TABLE console_session;
DROP TABLE console_invite;
DROP TABLE console_user;
