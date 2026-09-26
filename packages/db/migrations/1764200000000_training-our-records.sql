-- Up Migration

-- T-512, D-083: the training store's third source -- our own records of the
-- licensed feed, copied from `fixture` by the model's loader. The feed's terms
-- were read and the maintainer allowed training on it; every load still names
-- them. A competition's division may now be a code of our own records (IR1),
-- not only a football-data.co.uk one, and its teams are named by their
-- catalogue ids, so their aliases are identity rows.

ALTER TABLE training.source_load DROP CONSTRAINT source_load_source_check;
ALTER TABLE training.source_load ADD CONSTRAINT source_load_source_check
  CHECK (source IN ('football_data_co_uk', 'clubelo', 'our_records'));

COMMENT ON COLUMN competition.football_data_division IS
  'The training division the model fits this competition in: a football-data.co.uk code (E0, SP1, ...) or one of our own records (IR1, D-083). NULL until the competition is mapped for the model.';

COMMENT ON TABLE training.team_alias IS
  'Catalog team -> training team name per division. A team without a row cannot be forecast yet. In a division of our own records (D-083) the name is the team id itself.';

-- Down Migration

-- Loads already recorded from our own records stay; the narrower check
-- applies to new rows only.
ALTER TABLE training.source_load DROP CONSTRAINT source_load_source_check;
ALTER TABLE training.source_load ADD CONSTRAINT source_load_source_check
  CHECK (source IN ('football_data_co_uk', 'clubelo')) NOT VALID;

COMMENT ON COLUMN competition.football_data_division IS
  'football-data.co.uk division code (E0, SP1, ...). NULL until the competition is mapped for the model.';

COMMENT ON TABLE training.team_alias IS
  'Catalog team -> football-data.co.uk team name per division. A team without a row cannot be forecast yet.';
