-- Up Migration
-- T-1394 (D-209): ask again for the detail of every fixture whose timeline
-- holds the same booking, sending-off or substitution twice.
--
-- The live audit of 2026-10-11 found Portugal v Norway (2026-10-04) booking
-- F. Conceicao twice at 86', in two places of the stored list. T-1382 made
-- the provider's list the whole truth for a fixture, so a repeat the list
-- itself carries was written at its own place and kept. The writer now drops
-- such a repeat (`withoutRepeats`), and a place it does not write is deleted,
-- but only on the next answer for that fixture, and the post-match detail is
-- asked once. No row is changed here, the schema least of all: only the
-- fixtures' fetch marks go, and the detail backlog asks again -- one request
-- per fixture, at the backlog's own pace. The kinds are the ones a match can
-- never repeat; goals are left alone (see `withoutRepeats`).
-- `fixture_detail_fetch` carries no trigger; removing a mark is what an
-- adoption does to every mark (D-079).

DELETE FROM fixture_detail_fetch
 WHERE fixture_id IN (
   SELECT DISTINCT fixture_id
     FROM incident
    WHERE kind IN ('yellow_card', 'second_yellow_card', 'red_card', 'substitution')
    GROUP BY fixture_id, participant_id, kind, minute, added_time, person_id,
             related_person_id, detail
   HAVING count(*) > 1
 );

-- Down Migration

-- Nothing to restore: the marks come back as the backlog asks again.
SELECT 1;
