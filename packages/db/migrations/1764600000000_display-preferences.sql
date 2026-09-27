-- Up Migration
-- T-621: the accessibility preferences a member chose (blueprint 2.2): text
-- size, contrast and motion, kept on the account like the theme (T-602) so a
-- second device renders them after sign-in. Additive, each with a constant
-- default: Postgres records the default without rewriting the table, and
-- every existing account reads what it was already shown -- the browser's
-- text size, the device's contrast and the device's motion. No backfill.

ALTER TABLE user_account
  ADD COLUMN text_size text NOT NULL DEFAULT 'default'
    CONSTRAINT user_account_text_size_check CHECK (text_size IN ('default', 'large', 'larger')),
  ADD COLUMN contrast text NOT NULL DEFAULT 'system'
    CONSTRAINT user_account_contrast_check CHECK (contrast IN ('system', 'standard', 'more')),
  ADD COLUMN motion text NOT NULL DEFAULT 'system'
    CONSTRAINT user_account_motion_check CHECK (motion IN ('system', 'reduce'));

COMMENT ON COLUMN user_account.text_size IS
  'The text size the member chose (T-621): default (the browser''s), large or larger.';
COMMENT ON COLUMN user_account.contrast IS
  'The contrast the member chose (T-621): system (follow the device), standard or more (WCAG AAA text).';
COMMENT ON COLUMN user_account.motion IS
  'The motion the member chose (T-621): system (follow the device) or reduce.';

-- Down Migration

ALTER TABLE user_account DROP COLUMN motion, DROP COLUMN contrast, DROP COLUMN text_size;
