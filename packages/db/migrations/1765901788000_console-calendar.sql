-- Up Migration

-- ---------------------------------------------------------------------------
-- The agents console's calendar and reminders (T-1788, D-391), moved from the
-- team board's claude.ai page, where only a page left open could show a
-- reminder.
--
-- `console_event`: a note or reminder on the shared calendar. Its day and
-- time are the team's wall clock (Asia/Tehran); a monthly or yearly repeat
-- counts months in the calendar `basis` names (j: Solar Hijri, g:
-- Gregorian). A removed event keeps its row (`deleted_at`) so the audit
-- trail's target still exists; nothing reads it again.
--
-- `console_subscription`: the services the project depends on and their
-- renewals, written only by the computer (`import-calendar`), read by the
-- console.
--
-- `console_push_device`: a console person's browser that switched reminders
-- on (Web Push, the site's own VAPID keys), apart from the members' devices.
--
-- `console_reminder_sent`: one row per event and day the reminder went out,
-- claimed before sending, so two runs never send one twice.
--
-- New tables only; nothing to backfill.
-- ---------------------------------------------------------------------------

CREATE TABLE console_subscription (
  key           text PRIMARY KEY,
  position      integer NOT NULL DEFAULT 0,
  name          text NOT NULL,
  purpose       text NOT NULL DEFAULT '',
  plan          text NOT NULL DEFAULT '',
  price         text NOT NULL DEFAULT '',
  started       text NOT NULL DEFAULT '',
  renewal       text NOT NULL DEFAULT '',
  renew_on      date,
  status        text NOT NULL,
  status_note   text NOT NULL DEFAULT '',
  limits        text NOT NULL DEFAULT '',
  payer         text NOT NULL DEFAULT '',
  manage_url    text,
  manage_label  text NOT NULL DEFAULT '',
  manage_note   text NOT NULL DEFAULT '',
  source        text NOT NULL DEFAULT '',
  paid          boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_subscription_key_format CHECK (key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  CONSTRAINT console_subscription_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT console_subscription_status CHECK (
    status IN ('failing', 'active', 'limited', 'not_taken', 'unused', 'retired')
  ),
  CONSTRAINT console_subscription_manage_url CHECK (manage_url IS NULL OR manage_url ~ '^https://')
);

COMMENT ON TABLE console_subscription IS
  'The services the project depends on and their renewals (T-1788, D-391); written only by the computer''s import-calendar.';

CREATE TABLE console_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text NOT NULL,
  starts_on         date NOT NULL,
  at_time           time,
  repeat            text NOT NULL DEFAULT 'none',
  basis             text NOT NULL DEFAULT 'j',
  repeat_until      date,
  remind_minutes    integer,
  note              text NOT NULL DEFAULT '',
  color             text NOT NULL DEFAULT 'blue',
  subscription_key  text REFERENCES console_subscription (key) ON DELETE SET NULL,
  source_ref        text,
  created_by        uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  updated_by        uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT console_event_title CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  CONSTRAINT console_event_note_length CHECK (char_length(note) <= 4000),
  CONSTRAINT console_event_repeat CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  CONSTRAINT console_event_basis CHECK (basis IN ('j', 'g')),
  CONSTRAINT console_event_until CHECK (repeat_until IS NULL OR (repeat <> 'none' AND repeat_until >= starts_on)),
  CONSTRAINT console_event_remind CHECK (remind_minutes IS NULL OR remind_minutes IN (0, 15, 60, 1440)),
  CONSTRAINT console_event_color CHECK (
    color IN ('blue', 'green', 'amber', 'orange', 'pink', 'purple', 'teal', 'violet')
  )
);

-- The one-off import is idempotent by the page's own document id.
CREATE UNIQUE INDEX console_event_source ON console_event (source_ref) WHERE source_ref IS NOT NULL;
-- What the page and the reminder run read: the live events.
CREATE INDEX console_event_live ON console_event (starts_on) WHERE deleted_at IS NULL;

CREATE TRIGGER console_event_updated_at
  BEFORE UPDATE ON console_event FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE console_event IS
  'Notes and reminders on the agents console''s shared calendar (T-1788, D-391); Asia/Tehran wall clock; every change audited in console_audit.';

CREATE TABLE console_push_device (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES console_user (id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  CONSTRAINT console_push_device_endpoint CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 1000),
  CONSTRAINT console_push_device_keys CHECK (char_length(p256dh) <= 200 AND char_length(auth) <= 100)
);

CREATE INDEX console_push_device_user ON console_push_device (user_id);

COMMENT ON TABLE console_push_device IS
  'A console person''s browser that takes calendar reminders by Web Push (T-1788, D-391); apart from the members'' push_subscription.';

CREATE TABLE console_reminder_sent (
  event_id    uuid NOT NULL REFERENCES console_event (id) ON DELETE CASCADE,
  occurs_on   date NOT NULL,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  devices     integer NOT NULL DEFAULT 0,
  delivered   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, occurs_on)
);

CREATE INDEX console_reminder_sent_recent ON console_reminder_sent (claimed_at DESC);

COMMENT ON TABLE console_reminder_sent IS
  'One row per calendar reminder sent (T-1788, D-391): claimed before sending, so it goes out once.';

-- Down Migration

DROP TABLE console_reminder_sent;
DROP TABLE console_push_device;
DROP TABLE console_event;
DROP TABLE console_subscription;
