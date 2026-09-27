-- Up Migration
-- T-602: the colour theme a member chose (D-089): light, dark, or `system`,
-- which follows the device. Kept on the account so a second device renders
-- the member's choice after sign-in. Additive, with a constant default:
-- Postgres records the default without rewriting the table, and every
-- existing account reads `system`, which is what it was already shown. No
-- backfill.

ALTER TABLE user_account
  ADD COLUMN theme text NOT NULL DEFAULT 'system'
    CONSTRAINT user_account_theme_check CHECK (theme IN ('light', 'dark', 'system'));

COMMENT ON COLUMN user_account.theme IS
  'The colour theme the member chose (T-602): light, dark, or system (follow the device).';

-- Down Migration

ALTER TABLE user_account DROP COLUMN theme;
