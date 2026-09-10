-- Up Migration

-- T-063: the bridge between the catalog and the training store. The model is
-- fitted on the training store's text team names (D-028); the API speaks in
-- catalog UUIDs. This table says which training name a catalog team has in
-- which football-data.co.uk division, so the model service can answer a
-- request made in the product's terms.
--
-- Lives in the training schema, because it is the model's concern: a catalog
-- team with no alias here is simply one the model cannot forecast yet, and
-- the service says so (rule 3) rather than guessing by string similarity.
CREATE TABLE training.team_alias (
  team_id       uuid NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  division      text NOT NULL,
  training_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_alias_name_not_blank CHECK (btrim(training_name) <> ''),
  CONSTRAINT team_alias_pkey PRIMARY KEY (team_id, division),
  CONSTRAINT team_alias_name_unique UNIQUE (division, training_name)
);

COMMENT ON TABLE training.team_alias IS
  'Catalog team -> football-data.co.uk team name per division. A team without a row cannot be forecast yet.';

-- Down Migration

DROP TABLE IF EXISTS training.team_alias;
