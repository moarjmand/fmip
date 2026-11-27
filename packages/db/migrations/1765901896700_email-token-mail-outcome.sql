-- Up Migration

-- T-1967: what became of the mail each one-time e-mail token was sent in.
-- A sign-up, verification or reset mail that failed was only a log line,
-- gone at the next restart; the watchdog's `delivery:email` and the ops
-- snapshot read it from here, beside `notification_delivery`. Additive: two
-- nullable columns, no backfill (a token issued before this has no record and
-- is counted as none; tokens expire within a day and go 7 days after).
ALTER TABLE email_token
  ADD COLUMN mail_outcome text,
  ADD COLUMN mailed_at timestamptz,
  ADD CONSTRAINT email_token_mail_outcome_check
    CHECK (mail_outcome IN ('sent', 'failed', 'absent', 'skipped')),
  ADD CONSTRAINT email_token_mailed_with_outcome
    CHECK ((mail_outcome IS NULL) = (mailed_at IS NULL));

COMMENT ON COLUMN email_token.mail_outcome IS
  'What became of this token''s mail (T-1967): sent, failed (the provider refused), absent (no e-mail channel), skipped. NULL before it was sent or before T-1967.';

-- Down Migration

ALTER TABLE email_token
  DROP CONSTRAINT email_token_mailed_with_outcome,
  DROP CONSTRAINT email_token_mail_outcome_check,
  DROP COLUMN mailed_at,
  DROP COLUMN mail_outcome;
