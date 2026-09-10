-- Up Migration

-- T-040: accounts. The identity boundary (02-architecture.md) owns users,
-- credentials, sessions and roles; profile, privacy and favourites are the
-- profile boundary's tables and arrive with T-041 and T-042.
--
-- Same conventions as every migration so far: UUID keys we generate, TEXT +
-- CHECK for enumerations (D-024), updated_at by trigger. Two identity-specific
-- rules:
--
--   - Secrets are never stored. A password is a scrypt hash; a session or
--     e-mail token is an HMAC of the random value the client holds. A copy of
--     this database logs nobody in.
--   - Sessions and one-time tokens are rows, not signed cookies, so that a
--     logout, a password reset or an administrator can revoke them at once.
--
-- The table is user_account, not user: "user" is a reserved word in SQL and
-- would need quoting in every statement for the life of the project.

-- ---------------------------------------------------------------------------
-- user_account
-- ---------------------------------------------------------------------------
-- username and email are unique because the product requires it (blueprint
-- 7.1: a unique username; sign-in by e-mail). Both are stored normalised to
-- lower case so that uniqueness means what a human expects.
CREATE TABLE user_account (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username           text NOT NULL,
  display_name       text NOT NULL,
  email              text NOT NULL,
  email_verified_at  timestamptz,
  country_id         uuid NOT NULL REFERENCES country (id) ON DELETE RESTRICT,
  -- BCP 47 tag: 'en', 'fa', 'pt-BR'.
  preferred_language text NOT NULL,
  -- IANA zone: 'Asia/Tehran'. Validated against the runtime's list on write.
  timezone           text NOT NULL,
  -- When the platform rules were accepted (blueprint 7.1). Required to register.
  accepted_rules_at  timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_account_username_format CHECK (username ~ '^[a-z0-9_]{3,20}$'),
  CONSTRAINT user_account_display_name_length
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 50),
  CONSTRAINT user_account_email_format
    CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT user_account_language_format
    CHECK (preferred_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CONSTRAINT user_account_timezone_not_blank CHECK (btrim(timezone) <> ''),
  CONSTRAINT user_account_status_check CHECK (status IN ('active', 'suspended', 'deleted')),
  CONSTRAINT user_account_username_unique UNIQUE (username),
  CONSTRAINT user_account_email_unique UNIQUE (email)
);

CREATE INDEX user_account_country_id_idx ON user_account (country_id);

COMMENT ON TABLE user_account IS
  'A registered member. username and email are unique and lower-cased. No secret lives here.';

-- ---------------------------------------------------------------------------
-- credential
-- ---------------------------------------------------------------------------
-- One row per (user, kind). Only passwords exist today; an identity-provider
-- login (blueprint 7.1, "approved sign-in method") is another kind, later.
CREATE TABLE credential (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  kind        text NOT NULL,
  -- For 'password': scrypt$N$r$p$<salt>$<hash>, all base64url. Never the password.
  secret_hash text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credential_kind_check CHECK (kind IN ('password')),
  CONSTRAINT credential_secret_not_blank CHECK (btrim(secret_hash) <> ''),
  CONSTRAINT credential_one_per_kind UNIQUE (user_id, kind)
);

COMMENT ON TABLE credential IS
  'How a user proves who they are. secret_hash is a scrypt hash for kind = password.';

-- ---------------------------------------------------------------------------
-- session
-- ---------------------------------------------------------------------------
-- The client holds a random token in an HttpOnly cookie; the row holds its
-- HMAC. A session ends when it expires, when it is revoked, or when the user
-- is deleted. A new login always creates a new row: no session is ever
-- promoted from anonymous to authenticated, which is the defence against
-- session fixation.
CREATE TABLE session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  -- Truncated User-Agent, for "your sessions" screens. No IP address is kept.
  user_agent   text,
  CONSTRAINT session_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT session_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX session_user_id_idx ON session (user_id);

COMMENT ON TABLE session IS
  'A login. token_hash is the HMAC of the cookie value. Ended by expires_at or revoked_at.';

-- ---------------------------------------------------------------------------
-- email_token
-- ---------------------------------------------------------------------------
-- One-time tokens sent by e-mail: verify an address, reset a password. The
-- row stores the HMAC; used_at makes it single-use in the database rather than
-- in application memory.
CREATE TABLE email_token (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_token_kind_check CHECK (kind IN ('verify_email', 'reset_password')),
  CONSTRAINT email_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT email_token_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX email_token_user_kind_idx ON email_token (user_id, kind);

COMMENT ON TABLE email_token IS
  'Single-use e-mailed tokens (verify_email, reset_password). token_hash is the HMAC of the mailed value.';

-- ---------------------------------------------------------------------------
-- user_role
-- ---------------------------------------------------------------------------
-- Granted roles. Every grant records who gave it and why (rule 10); a role is
-- removed by deleting the row, and the audit_log (T-070) will record that.
CREATE TABLE user_role (
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  role       text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES user_account (id) ON DELETE SET NULL,
  reason     text NOT NULL,
  CONSTRAINT user_role_role_check CHECK (role IN ('admin', 'founder', 'moderator')),
  CONSTRAINT user_role_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT user_role_pkey PRIMARY KEY (user_id, role)
);

COMMENT ON TABLE user_role IS
  'Granted roles with who and why. Ordinary members have no row.';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER user_account_set_updated_at
  BEFORE UPDATE ON user_account FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER credential_set_updated_at
  BEFORE UPDATE ON credential FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS user_role;
DROP TABLE IF EXISTS email_token;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS credential;
DROP TABLE IF EXISTS user_account;
