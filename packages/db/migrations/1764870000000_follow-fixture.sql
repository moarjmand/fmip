-- Up Migration
-- T-945: following a match (blueprint 12.1, D-116).
--
-- `followed_entity` takes a fourth type, `fixture`. A match follow joins the
-- match-alert audience beside the followers of either team and of the
-- competition, under the same switches, mutes and quiet hours, and one member
-- is still one member of that audience however many ways they follow it.
--
-- A match is never a favourite: a favourite is pinned on the scores page and
-- shown on the profile, and a match pinned there would be stale in a week.
--
-- **The follow ends by itself.** `fixture_follow_open(id)` is the one copy of
-- the rule: a match follow counts until three hours after full-time -- the
-- end of the last period recorded, else two hours after kick-off -- once the
-- match is finished, awarded, cancelled or abandoned. A postponed or
-- suspended match keeps its followers until it is played. Every read of a
-- match follow asks this function, so a follow past its window follows
-- nothing, and the row itself is removed the next time the member follows a
-- match. Additive: no existing row changes, no backfill.

ALTER TABLE followed_entity DROP CONSTRAINT followed_entity_type_check;
ALTER TABLE followed_entity ADD CONSTRAINT followed_entity_type_check
  CHECK (entity_type IN ('team', 'competition', 'person', 'fixture'));
ALTER TABLE followed_entity ADD CONSTRAINT followed_entity_fixture_not_favourite
  CHECK (entity_type <> 'fixture' OR NOT favourite);

CREATE FUNCTION fixture_follow_open(p_fixture uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM fixture f
     WHERE f.id = p_fixture
       AND (f.status NOT IN ('finished', 'awarded', 'cancelled', 'abandoned')
            OR COALESCE((SELECT max(p.ended_at) FROM fixture_period p WHERE p.fixture_id = f.id),
                        f.kickoff_at + interval '2 hours')
               + interval '3 hours' > now())
  )
$$;

COMMENT ON FUNCTION fixture_follow_open(uuid) IS
  'D-116: whether a follow of this match still counts -- until three hours after full-time.';

COMMENT ON TABLE followed_entity IS
  'A member following a team, competition, person or match. favourite = pinned (never a match). One row per (user, entity).';

-- Down Migration

DELETE FROM followed_entity WHERE entity_type = 'fixture';
COMMENT ON TABLE followed_entity IS
  'A member following a team, competition or person. favourite = pinned. One row per (user, entity).';
DROP FUNCTION IF EXISTS fixture_follow_open(uuid);
ALTER TABLE followed_entity DROP CONSTRAINT followed_entity_fixture_not_favourite;
ALTER TABLE followed_entity DROP CONSTRAINT followed_entity_type_check;
ALTER TABLE followed_entity ADD CONSTRAINT followed_entity_type_check
  CHECK (entity_type IN ('team', 'competition', 'person'));
