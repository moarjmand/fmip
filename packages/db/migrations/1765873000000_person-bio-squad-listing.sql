-- Up Migration
-- T-1428 (D-220): the player data the provider already sends and we dropped.
--
-- 1. Bios. The `people_names` job asks the provider's player profile (T-1398),
--    which carries the birth date, nationality and height, and kept only the
--    name. Its run now has a second pass that asks each player's profile once
--    and fills `person.date_of_birth`, `nationality_id` and `height_cm` (and
--    `preferred_foot`, which this provider never gives) where they are empty:
--    a value already held is never overwritten. The nationality is a
--    `country` row found by the FIFA trigram the adapter knows for the
--    provider's spelling, or by exactly that name; otherwise it stays empty
--    and the spelling is recorded here for review. `person_bio_fetch` is one
--    row per person asked about and the record of what was written (rule 10:
--    `audit_log` needs a user as its actor, and this is a scheduled job; every
--    field it writes was empty before, so `written` is the whole change). An
--    answered person is never asked again; an unanswered one a day later, at
--    most five times in all (`person-bios.ts`).
--
-- 2. Squad listings. The `squads` job asks each club's squad (T-1324), which
--    lists each player's shirt number and position, and kept only photos. It
--    now records the listing: `team_squad_member` is the club's squad as the
--    provider last listed it, for the players we hold, replaced as a whole by
--    each answer. It is not a `player_spell`: a listing says who is in the
--    squad on the day it was read, not when they joined, and a spell's start
--    date would have to be invented.
--
-- Triggers on the tables this touches, listed before writing it: `person`,
-- which the bio pass writes, has `person_set_updated_at` only, and is not
-- immutable. The new tables have none.

CREATE TABLE person_bio_fetch (
  person_id             uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  provider              text NOT NULL,
  asked_at              timestamptz NOT NULL DEFAULT now(),
  attempts              integer NOT NULL DEFAULT 1,
  answered_at           timestamptz,
  outcome               text,
  -- Why something was or was not written, in a sentence, for the operator.
  detail                text,
  -- The fields written and their values ({"height_cm": 175, ...}); each was empty before.
  written               jsonb,
  -- The provider's nationality when no country matched it.
  unmatched_nationality text,
  PRIMARY KEY (provider, person_id),
  CONSTRAINT person_bio_fetch_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT person_bio_fetch_attempts_positive CHECK (attempts >= 1),
  CONSTRAINT person_bio_fetch_outcome_check CHECK (
    outcome IS NULL OR outcome IN ('written', 'nothing_new', 'no_profile', 'name_differs')
  ),
  CONSTRAINT person_bio_fetch_outcome_answered CHECK ((outcome IS NULL) = (answered_at IS NULL)),
  CONSTRAINT person_bio_fetch_written_has_fields CHECK (
    (outcome = 'written') = (written IS NOT NULL AND written <> '{}'::jsonb)
  )
);

CREATE INDEX person_bio_fetch_asked_idx ON person_bio_fetch (provider, asked_at);

COMMENT ON TABLE person_bio_fetch IS
  'Each ask of the provider''s player profile for a player''s birth date, nationality and height, and what was written (T-1428, D-220).';

CREATE TABLE team_squad_member (
  team_id      uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  provider     text NOT NULL,
  shirt_number smallint,
  position     text,
  listed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, person_id),
  CONSTRAINT team_squad_member_provider_check
    CHECK (provider IN ('api_football', 'football_data_org', 'highlightly')),
  CONSTRAINT team_squad_member_shirt_range
    CHECK (shirt_number IS NULL OR shirt_number BETWEEN 1 AND 99),
  CONSTRAINT team_squad_member_position_check
    CHECK (position IS NULL OR position IN ('goalkeeper', 'defender', 'midfielder', 'forward'))
);

CREATE INDEX team_squad_member_person_idx ON team_squad_member (person_id);

COMMENT ON TABLE team_squad_member IS
  'A club''s squad as the provider last listed it (T-1428, D-220): the players we hold, with the shirt number and position the listing gives. Replaced by each answer; not a spell.';

-- The listing's size, so a squad of which we hold only some players says so.
ALTER TABLE team_squad_fetch ADD COLUMN listed integer;
ALTER TABLE team_squad_fetch ADD CONSTRAINT team_squad_fetch_listed_nonnegative
  CHECK (listed IS NULL OR listed >= 0);

-- Down Migration

-- Empty again every field the bio pass filled and that still holds its value.
UPDATE person p
   SET date_of_birth = CASE WHEN p.date_of_birth::text = f.written->>'date_of_birth'
                            THEN NULL ELSE p.date_of_birth END,
       nationality_id = CASE WHEN p.nationality_id::text = f.written->>'nationality_id'
                             THEN NULL ELSE p.nationality_id END,
       height_cm = CASE WHEN p.height_cm::text = f.written->>'height_cm'
                        THEN NULL ELSE p.height_cm END,
       preferred_foot = CASE WHEN p.preferred_foot = f.written->>'preferred_foot'
                             THEN NULL ELSE p.preferred_foot END
  FROM person_bio_fetch f
 WHERE f.outcome = 'written' AND p.id = f.person_id;
ALTER TABLE team_squad_fetch DROP CONSTRAINT team_squad_fetch_listed_nonnegative;
ALTER TABLE team_squad_fetch DROP COLUMN listed;
DROP TABLE team_squad_member;
DROP TABLE person_bio_fetch;
