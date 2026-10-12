-- Up Migration
-- T-1398 (D-213): full player names from the provider's player profile.
--
-- About two people in three were adopted under the name the line-ups, events
-- and player statistics print, an initial and a surname ("M. Salah"), because
-- that is all those answers carry (D-079). The new `people_names` job asks
-- the provider's profile of each such person once, and writes the full name
-- ("Mohamed Salah") to `person.full_name` only where the profile agrees with
-- the short form; the short form is kept as an `entity_alias` row of kind
-- 'abbreviation', so search still finds it. It is an ingestion job like the
-- others, so its runs and the requests they spend are recorded in
-- `ingest_run` (T-501) and drawn from the bulk budget tier (D-183).
--
-- `person_name_fetch` records each ask, and is the per-person record of what
-- the job changed (rule 10 -- `audit_log` needs a user as its actor, and this
-- is a scheduled job): `asked_at` when the last request was sent, `attempts`
-- how many were sent, `answered_at` when the provider answered, `outcome`
-- what the job did with the answer, `previous_name` and `written_name` the
-- name before and after when it wrote one, and `profile_name` the full name
-- the profile gave. An answered person is never asked again; an unanswered
-- one is asked again a day later, at most `MAX_ATTEMPTS` times in all
-- (`person-names.ts`).
--
-- Triggers on the tables this touches, listed before writing it:
-- `ingest_run` has `ingest_run_set_updated_at` only (a constraint is
-- replaced, no row is written). `person`, which the job writes, has
-- `person_set_updated_at` only; `entity_alias` has none. Neither is immutable
-- (`refuse_change` guards `audit_log`, which nothing here writes).

ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check
  CHECK (job IN ('fixtures', 'live', 'lineups', 'standings', 'post_match', 'squads', 'people_names'));

CREATE TABLE person_name_fetch (
  person_id     uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  provider      text NOT NULL,
  asked_at      timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 1,
  answered_at   timestamptz,
  outcome       text,
  -- Why the name was or was not written, in a sentence, for the operator.
  detail        text,
  previous_name text,
  written_name  text,
  profile_name  text,
  PRIMARY KEY (provider, person_id),
  CONSTRAINT person_name_fetch_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT person_name_fetch_attempts_positive CHECK (attempts >= 1),
  CONSTRAINT person_name_fetch_outcome_check CHECK (
    outcome IS NULL OR outcome IN (
      'written', 'no_profile', 'family_name_differs', 'initial_differs', 'name_kept'
    )
  ),
  -- An outcome is what was done with an answer; an unanswered ask has none.
  CONSTRAINT person_name_fetch_outcome_answered CHECK ((outcome IS NULL) = (answered_at IS NULL)),
  CONSTRAINT person_name_fetch_written_has_names CHECK (
    outcome IS DISTINCT FROM 'written' OR (previous_name IS NOT NULL AND written_name IS NOT NULL)
  )
);

CREATE INDEX person_name_fetch_asked_idx ON person_name_fetch (provider, asked_at);

COMMENT ON TABLE person_name_fetch IS
  'Each ask of the provider''s player profile for a person stored under a short name, and what was done with the answer (T-1398, D-213).';

-- Down Migration

-- Put back every short name the job replaced and is still in place, and drop
-- the aliases it added, before the record of them goes.
UPDATE person p
   SET full_name = f.previous_name
  FROM person_name_fetch f
 WHERE f.outcome = 'written' AND p.id = f.person_id AND p.full_name = f.written_name;
DELETE FROM entity_alias a
 USING person_name_fetch f
 WHERE f.outcome = 'written' AND a.entity_type = 'person' AND a.entity_id = f.person_id
   AND a.kind = 'abbreviation' AND a.source = f.provider;
DROP TABLE person_name_fetch;
DELETE FROM ingest_run WHERE job = 'people_names';
ALTER TABLE ingest_run DROP CONSTRAINT ingest_run_job_check;
ALTER TABLE ingest_run ADD CONSTRAINT ingest_run_job_check
  CHECK (job IN ('fixtures', 'live', 'lineups', 'standings', 'post_match', 'squads'));
