-- Up Migration

-- ---------------------------------------------------------------------------
-- Where sign-ups start, as a count only (T-1821, D-415; desk decision
-- d-2026-11-09-01, the maintainer's option (c) after the business adviser's
-- note of 2026-11-13).
--
-- One row per calendar month (UTC), entry and referring site: how many
-- accounts were created from there. `entry` is the kind of page on which
-- "Create account" was clicked (`none` when the register page was the first
-- page we know of); `referrer_host` is the main domain of another site that
-- linked straight to the register page (`github.io`, never `name.github.io`;
-- never an address or a one-label name), `telegram` for Telegram's Android
-- app, '' for none. No account id, no time finer than the month, no URL,
-- path or query, and no cookie or script on the visitor's device feeds it.
--
-- Still personal data (pseudonymous, UK GDPR, legitimate interests): with a
-- handful of sign-ups a month most cells are one member, and whoever can
-- read this table and `user_account` together may single one out. To keep
-- that small, the count is written in its own transaction after the
-- registration has committed (never in it, so a row never carries the
-- account's transaction id), and the daily retention run rewrites every row
-- in one transaction (`RetentionStore.restampSignupSources`), so after at
-- most a day no row's live version sits next to its account's transaction id
-- either. Old row versions remain on disk until vacuum, readable only with
-- superuser tools. Reports read closed months only, as folded aggregates
-- with cells of 5 or more (the growth-funnel skill).
--
-- A new table; accounts created before it are not counted (no backfill:
-- where they started was never recorded).
-- ---------------------------------------------------------------------------

CREATE TABLE signup_source_monthly (
  month         date    NOT NULL,
  entry         text    NOT NULL,
  referrer_host text    NOT NULL DEFAULT '',
  sign_ups      integer NOT NULL,
  PRIMARY KEY (month, entry, referrer_host),
  CONSTRAINT signup_source_monthly_month CHECK (month = date_trunc('month', month)::date),
  CONSTRAINT signup_source_monthly_entry CHECK (
    entry IN ('home', 'match', 'team', 'competition', 'news', 'other', 'none')
  ),
  -- A main domain of two labels or more, never an address; or the one app name.
  CONSTRAINT signup_source_monthly_host CHECK (
    referrer_host = ''
    OR referrer_host = 'telegram'
    OR (
      length(referrer_host) <= 253
      AND referrer_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'
      AND referrer_host !~ '\.[0-9]+$'
    )
  ),
  CONSTRAINT signup_source_monthly_positive CHECK (sign_ups > 0)
);

COMMENT ON TABLE signup_source_monthly IS
  'Sign-ups per month by entry page kind and referring main domain; aggregate, still personal data (T-1821, D-415).';

-- Down Migration

DROP TABLE signup_source_monthly;
