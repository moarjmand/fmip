-- Up Migration
-- T-1397 (D-212): a starter's place in the side's shape, so the match
-- centre can draw every formation on the pitch (4-2-3-1, 3-4-2-1, ...), not
-- only the three-line ones T-1384 could place from the roles alone.
--
-- `grid_row` counts the lines from the goalkeeper's (1) towards the halfway
-- line; `grid_col` counts across a line from the side's own left as it
-- attacks (1). Both null for the bench, for a provider that supplies no
-- place (Highlightly, football-data.org) and for a row written before this.
--
-- Additive and nullable, no default: adding the columns rewrites no row, so
-- neither of the table's row triggers fires (`lineup_set_updated_at`,
-- BEFORE UPDATE; `lineup_notify_change`, AFTER INSERT/UPDATE/DELETE; no
-- `refuse_change` on this table). No backfill here: a stored line-up gains
-- its places the next time its fixture is fetched, which the writer now
-- counts as a change (D-212 says which fetches those are).

ALTER TABLE lineup
  ADD COLUMN grid_row smallint,
  ADD COLUMN grid_col smallint,
  ADD CONSTRAINT lineup_grid_row_positive CHECK (grid_row IS NULL OR grid_row > 0),
  ADD CONSTRAINT lineup_grid_col_positive CHECK (grid_col IS NULL OR grid_col > 0),
  -- A place is both numbers or neither: half a place is no place (rule 3).
  ADD CONSTRAINT lineup_grid_whole CHECK ((grid_row IS NULL) = (grid_col IS NULL));

-- Down Migration

ALTER TABLE lineup
  DROP CONSTRAINT IF EXISTS lineup_grid_whole,
  DROP CONSTRAINT IF EXISTS lineup_grid_col_positive,
  DROP CONSTRAINT IF EXISTS lineup_grid_row_positive,
  DROP COLUMN IF EXISTS grid_col,
  DROP COLUMN IF EXISTS grid_row;
