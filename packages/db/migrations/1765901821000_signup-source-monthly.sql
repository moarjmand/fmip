-- Up Migration

-- ---------------------------------------------------------------------------
-- Where sign-ups start, as a count only (T-1821, D-415; desk decision
-- d-2026-11-09-01, the maintainer's option (c) after the business adviser's
-- note of 2026-11-13).
--
-- One row per calendar month (UTC), entry and referring host: how many
-- accounts were created from there. `entry` is the kind of page on which
-- "Create account" was clicked (`none` when the register page was the first
-- page we know of); `referrer_host` is the host of another site that linked
-- straight to the register page, '' for none. No account id, no time finer
-- than the month, no URL, path or query: nothing here is kept beside a
-- member, and no cookie or script on the visitor's device feeds it.
--
-- Written in the registration's own transaction (`createUser`); read only as
-- aggregates with cells of 5 or more (the growth-funnel skill).
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
  -- A bare host name, lower-case, never a URL (the API normalises it first).
  CONSTRAINT signup_source_monthly_host CHECK (
    referrer_host = '' OR referrer_host ~ '^[a-z0-9.-]{1,253}$'
  ),
  CONSTRAINT signup_source_monthly_positive CHECK (sign_ups > 0)
);

COMMENT ON TABLE signup_source_monthly IS
  'Sign-ups per month by entry page kind and referring host, aggregate only (T-1821, D-415).';

-- Down Migration

DROP TABLE signup_source_monthly;
