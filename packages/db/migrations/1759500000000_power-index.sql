-- Up Migration

-- T-110: the Power Index (blueprint 6.1).
--
-- The number beside each team that says how strong it is, from 0 to 100, and —
-- this is the part that makes it a product rather than a statistic — the
-- components it was built from, so a reader can see *why*. The blueprint is
-- explicit that it is "not created by adding arbitrary fixed points", so a
-- component is a position in a distribution, not a bag of bonuses, and the row
-- keeps every component it used with the weight it used.
--
-- Immutable, like a forecast (rule 5): an index computed before the line-ups
-- were known is a fact about that moment, and recomputing it later writes a new
-- row rather than rewriting the old one. That is also what makes "what changed
-- after the confirmed line-up" answerable at all (T-121).
--
-- Recomputable (rule 8's discipline applied to a second number): `components`
-- carries every input value and `inputs_hash` identifies them, so an unchanged
-- recomputation is detectable and a published index can be reproduced from the
-- row alone.

CREATE TABLE power_index (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The side, not the team: a Power Index is about a team *in this fixture*,
  -- which is what makes the venue and congestion components meaningful. The
  -- participant row also makes an index for a team that is not playing
  -- impossible to write, the same device the lineup and statistics tables use.
  participant_id  uuid NOT NULL REFERENCES fixture_participant (id) ON DELETE CASCADE,
  -- The published formula, e.g. 'power-index@1.0.0'. Changing a weight is a new
  -- version, so two rows are never compared across different arithmetic.
  formula_version text NOT NULL,
  value           numeric(5, 2) NOT NULL,
  -- The share of the formula's total weight that was actually supplied, from
  -- just above 0 to 1. A component nothing supplied is `not_supplied` and its
  -- weight is redistributed over the ones that arrived; filling it with a
  -- neutral value would be inventing one (rule 3), and averaging over fewer
  -- components while saying so is the honest alternative. This column is what
  -- "saying so" means, and the UI shows it beside the number.
  completeness    numeric(5, 4) NOT NULL,
  -- One object per component: { key, weight, value, state, note }. `value` is
  -- null exactly when `state` is 'not_supplied'.
  components      jsonb NOT NULL,
  -- Identity of the inputs, so an unchanged recomputation is detectable.
  inputs_hash     text NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT power_index_formula_format
    CHECK (formula_version ~ '^[a-z0-9-]+@[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT power_index_value_range CHECK (value >= 0 AND value <= 100),
  -- An index with no supplied component at all is not a weak index, it is the
  -- absence of one, and must not exist as a number.
  CONSTRAINT power_index_completeness_range CHECK (completeness > 0 AND completeness <= 1),
  CONSTRAINT power_index_components_present
    CHECK (jsonb_typeof(components) = 'array' AND jsonb_array_length(components) >= 1),
  -- One index per side per formula per moment. Recomputing at the same instant
  -- with the same formula is the same computation, not a second one.
  CONSTRAINT power_index_one_per_moment UNIQUE (participant_id, formula_version, computed_at)
);

CREATE INDEX power_index_participant_idx
  ON power_index (participant_id, formula_version, computed_at DESC);

COMMENT ON TABLE power_index IS
  'One computation of a team''s Power Index for one fixture, with the components and weights it used. Immutable; newest per participant and formula is current.';

COMMENT ON COLUMN power_index.completeness IS
  'Share of the formula weight actually supplied. Below 1 means components were missing and their weight was redistributed; the UI must show it.';

CREATE TRIGGER power_index_immutable
  BEFORE UPDATE OR DELETE ON power_index FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Down Migration

DROP TABLE IF EXISTS power_index;
