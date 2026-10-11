-- Up Migration
-- T-1382: ask again for the detail of every fixture whose timeline holds the
-- same incident twice.
--
-- `incident.sequence` is the incident's place in the provider's list, and the
-- writer never deleted a place the list stopped filling. When the list shrank
-- (the provider dropped a repeated event) the old tail stayed, and when a
-- place came to hold an incident we skip (a player waiting for review) the
-- older incident stayed there: production showed fixture 1639651's 60th and
-- 90th minute substitutions twice and hid a goal. The writer now deletes such
-- rows, but only on its next answer for that fixture, and the post-match
-- detail is asked once. Which copy is the stale one only the provider's list
-- can say, so no incident is deleted here: the fixture's fetch mark is, and
-- the detail backlog asks again (about fifty requests on 2026-10-10).
-- `fixture_detail_fetch` carries no trigger; removing a mark is what an
-- adoption does to every mark (D-079).

DELETE FROM fixture_detail_fetch
 WHERE fixture_id IN (
   SELECT DISTINCT fixture_id
     FROM incident
    GROUP BY fixture_id, kind, minute, added_time, person_id, related_person_id, detail
   HAVING count(*) > 1
 );

-- Down Migration

-- Nothing to restore: the marks come back as the backlog asks again.
SELECT 1;
