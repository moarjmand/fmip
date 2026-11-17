-- Up Migration

-- ---------------------------------------------------------------------------
-- Two business model canvases in the agents console (T-1872, D-448, amending
-- D-441): the one Claude filled (`claude`, the 55 seeded cards) and the one
-- the teammate fills himself (`teammate`, empty at first), each with the same
-- nine blocks, its own places, bin and history.
--
-- `console_canvas_card.canvas` names a card's canvas. Every existing card is
-- Claude's: the column is added with the default `claude`, which Postgres
-- writes into every existing row as it adds it (no UPDATE, no trigger fires).
-- A small, safe backfill: the table holds the seed's 55 cards and whatever
-- the two console accounts added since. The default stays, so a write from
-- the API version before this one (during a deploy's rollout) still lands
-- on Claude's canvas, where its routes always wrote.
--
-- `console_canvas_event.canvas` is the canvas of the event's card, added the
-- same way (the table is immutable; adding a column with a default rewrites
-- no row and fires no trigger). A foreign key on (card_id, canvas) keeps it
-- the card's own: an event can never name another canvas than its card's. It
-- lets the page read one canvas's newest changes and nothing else.
--
-- `console_audit` is immutable (rule 10) and is not rewritten: its canvas
-- rows name the card by `target_id`, and the card now says its canvas
-- (`claude` for every row written before this migration). New audit rows
-- carry `canvas` in the card they record before and after.
--
-- The `console_canvas` ceiling stays one per person across both canvases.
-- ---------------------------------------------------------------------------

ALTER TABLE console_canvas_card
  ADD COLUMN canvas text NOT NULL DEFAULT 'claude',
  ADD CONSTRAINT console_canvas_card_canvas CHECK (canvas IN ('claude', 'teammate')),
  -- The key the events' foreign key names: a card and its canvas.
  ADD CONSTRAINT console_canvas_card_id_canvas UNIQUE (id, canvas);

ALTER TABLE console_canvas_event
  ADD COLUMN canvas text NOT NULL DEFAULT 'claude',
  ADD CONSTRAINT console_canvas_event_card_canvas
    FOREIGN KEY (card_id, canvas) REFERENCES console_canvas_card (id, canvas) ON DELETE RESTRICT;

-- The page reads one canvas: its live cards by block and place, its bin, its
-- newest changes. The indexes of T-1856 are replaced by the same ones per canvas.
DROP INDEX console_canvas_card_live;
CREATE INDEX console_canvas_card_live ON console_canvas_card (canvas, block, position)
  WHERE deleted_at IS NULL;
DROP INDEX console_canvas_card_removed;
CREATE INDEX console_canvas_card_removed ON console_canvas_card (canvas, deleted_at)
  WHERE deleted_at IS NOT NULL;
DROP INDEX console_canvas_event_newest;
CREATE INDEX console_canvas_event_newest ON console_canvas_event (canvas, created_at DESC, id DESC);

COMMENT ON COLUMN console_canvas_card.canvas IS
  'Which canvas the card is on: claude (filled by Claude, the seed) or teammate (filled by the teammate). T-1872, D-448.';
COMMENT ON COLUMN console_canvas_event.canvas IS
  'The canvas of the event''s card (a foreign key with card_id keeps them equal). T-1872, D-448.';

-- Down Migration

-- Going back would put the teammate's cards on Claude's canvas; refuse while any exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM console_canvas_card WHERE canvas <> 'claude') THEN
    RAISE EXCEPTION 'console_canvas_card holds cards of another canvas than claude; move or keep them before going back';
  END IF;
END
$$;

DROP INDEX console_canvas_event_newest;
CREATE INDEX console_canvas_event_newest ON console_canvas_event (created_at DESC, id DESC);
DROP INDEX console_canvas_card_removed;
CREATE INDEX console_canvas_card_removed ON console_canvas_card (deleted_at)
  WHERE deleted_at IS NOT NULL;
DROP INDEX console_canvas_card_live;
CREATE INDEX console_canvas_card_live ON console_canvas_card (block, position)
  WHERE deleted_at IS NULL;

ALTER TABLE console_canvas_event
  DROP CONSTRAINT console_canvas_event_card_canvas,
  DROP COLUMN canvas;
ALTER TABLE console_canvas_card
  DROP CONSTRAINT console_canvas_card_id_canvas,
  DROP CONSTRAINT console_canvas_card_canvas,
  DROP COLUMN canvas;
