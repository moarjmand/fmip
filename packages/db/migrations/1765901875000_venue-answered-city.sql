-- Up Migration
-- A ground's city from the provider's answer about the ground (T-1875, D-451,
-- amending D-229 point 4; finding aud-2026-11-11-01).
--
-- On production (read-only, 2026-11-17) "Estadio de Mestalla" showed the city
-- "Valdivia" on 142 matches and "Allianz Field" "Sao Paulo" on 84. Neither is
-- two grounds in one row: each is one provider id (1497, 1617), mapped once,
-- and its matches are Valencia's and Minnesota United's (and three national
-- teams' friendlies there). No ground of the 3,537 has two mappings, and none
-- holds domestic league matches of two countries. The city came from the one
-- fixture answer the ground was queued from (`unresolved_entity.payload`,
-- kept as it was), and D-229 let a later answer about the ground by its id
-- fill a city "only where none is stored": every ground had one, so none of
-- the 2,999 answers since corrected a city (all 3,537 still equal the queued
-- one), while their addresses (Avenida de Suecia; 400 Snelling Avenue North)
-- were written.
--
-- From T-1875 the city an answer about the ground gives replaces the stored
-- one, as its address and capacity already do. This column records that city
-- so the data audit's V1 can see a ground shown with a city its own answer
-- contradicts. Nothing is backfilled: the answers were not kept. Each ground
-- is described again on the existing monthly cadence (a current season's
-- clubs after 30 days, every other ground by id), which fills it.
-- No trigger on `venue_detail_fetch` (checked: none).
ALTER TABLE venue_detail_fetch
  ADD COLUMN city text,
  ADD CONSTRAINT venue_detail_fetch_city_not_blank CHECK (city IS NULL OR btrim(city) <> ''),
  ADD CONSTRAINT venue_detail_fetch_city_answered
    CHECK (city IS NULL OR answered_by IN ('venue', 'team'));

COMMENT ON COLUMN venue_detail_fetch.city IS
  'T-1875 (D-451): the city the latest answer about the ground gave; NULL when it gave none or predates T-1875.';

-- Down Migration
ALTER TABLE venue_detail_fetch
  DROP CONSTRAINT venue_detail_fetch_city_answered,
  DROP CONSTRAINT venue_detail_fetch_city_not_blank,
  DROP COLUMN city;
