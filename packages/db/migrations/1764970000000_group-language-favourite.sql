-- Up Migration

-- T-1022 (D-133): a group's preferred language, and its favourite club or
-- competition.
--
-- **The language is a tag, not a translation.** It says what the members
-- write in, so the group's page and conversation can be marked up with it
-- (`lang`) and the directory can be filtered by it. Nothing machine-translates
-- what members write (13.2, D-061). The same shape check as a member's
-- preferred language (T-020): a BCP 47 tag.
--
-- **A favourite is an id, never a name (rule 1).** A club or a competition,
-- at most one of the two: a group about a club and a competition at once is
-- two groups. `ON DELETE SET NULL`, because a catalogue row merged away should
-- leave the group without a favourite, not take the group with it.
--
-- All three are nullable, and a group with none says nothing: no backfill.
ALTER TABLE user_group
  ADD COLUMN language text,
  ADD COLUMN favourite_team_id uuid REFERENCES team (id) ON DELETE SET NULL,
  ADD COLUMN favourite_competition_id uuid REFERENCES competition (id) ON DELETE SET NULL,
  ADD CONSTRAINT user_group_language_shape
    CHECK (language IS NULL OR language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  ADD CONSTRAINT user_group_one_favourite
    CHECK (num_nonnulls(favourite_team_id, favourite_competition_id) <= 1);

COMMENT ON COLUMN user_group.language IS
  'The language the members write in, a BCP 47 tag (T-1022, D-133). Markup and a directory filter, never a translation.';
COMMENT ON COLUMN user_group.favourite_team_id IS
  'The club the group is about, by id (rule 1). At most one of this and favourite_competition_id (T-1022).';
COMMENT ON COLUMN user_group.favourite_competition_id IS
  'The competition the group is about, by id (rule 1). At most one of this and favourite_team_id (T-1022).';

-- The directory's two new filters, over findable groups only, like the name
-- index beside them (T-240).
CREATE INDEX user_group_language_idx ON user_group (language)
  WHERE visibility <> 'invite_only' AND language IS NOT NULL;
CREATE INDEX user_group_favourite_team_idx ON user_group (favourite_team_id)
  WHERE visibility <> 'invite_only' AND favourite_team_id IS NOT NULL;
CREATE INDEX user_group_favourite_competition_idx ON user_group (favourite_competition_id)
  WHERE visibility <> 'invite_only' AND favourite_competition_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS user_group_favourite_competition_idx;
DROP INDEX IF EXISTS user_group_favourite_team_idx;
DROP INDEX IF EXISTS user_group_language_idx;
ALTER TABLE user_group DROP CONSTRAINT IF EXISTS user_group_one_favourite;
ALTER TABLE user_group DROP CONSTRAINT IF EXISTS user_group_language_shape;
ALTER TABLE user_group DROP COLUMN IF EXISTS favourite_competition_id;
ALTER TABLE user_group DROP COLUMN IF EXISTS favourite_team_id;
ALTER TABLE user_group DROP COLUMN IF EXISTS language;
