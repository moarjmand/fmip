-- Up Migration
-- Whether a competition's finished matches feed the model's training store
-- (T-1649, D-304). The records loader (`apps/model/fmip_model/training/records.py`)
-- copies every finished match of the competitions set to a division, and every
-- match of a competition that is not one domestic league into `XL`, the
-- cross-league fit, every day; our own Elo then reads every row. A competition
-- added to the catalogue therefore changed the published version's inputs the
-- next morning. The domestic cups added for the model factors (D-303) are shown
-- on the site and judged in the lab store first: they are set `false` with
-- `catalog --set-training`, and the published version keeps the matches it was
-- judged on until the maintainer approves the candidate that reads them.

ALTER TABLE competition ADD COLUMN model_training boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN competition.model_training IS
  'Whether the records loader copies this competition''s finished matches into the training store (T-1649, D-304); set with catalog --set-training, audited.';

-- Down Migration

ALTER TABLE competition DROP COLUMN model_training;
