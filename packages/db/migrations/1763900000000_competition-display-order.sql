-- Up Migration
-- T-504: where a competition sits on the scores page, after a member's own
-- favourites. With fifteen competitions the old order -- country, then name --
-- put the Championship above the Premier League and every European cup above
-- every league. The order is the operator's to state (`catalog.mjs
-- --set-order`), not inferred: nothing in the data says which league a reader
-- looks for first. NULL sorts after every stated position, in the old order.

ALTER TABLE competition ADD COLUMN display_order smallint;
ALTER TABLE competition ADD CONSTRAINT competition_display_order_positive
  CHECK (display_order IS NULL OR display_order >= 1);

COMMENT ON COLUMN competition.display_order IS
  'Position on the scores page after a member''s favourites, 1 first; NULL after every stated one (T-504).';

-- Down Migration

ALTER TABLE competition DROP CONSTRAINT competition_display_order_positive;
ALTER TABLE competition DROP COLUMN display_order;
