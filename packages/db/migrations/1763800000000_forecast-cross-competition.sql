-- Up Migration
-- T-503: a forecast the model cannot give because the match is between clubs of
-- different leagues -- a European cup's, and any other competition that is not
-- a single domestic league. The model rates clubs within one league (D-029), so
-- this is not "not mapped": no division could ever be given to the Europa
-- League. Its own reason lets the match page say so, until the model's next
-- version puts clubs of different leagues on one scale (T-533).

ALTER TABLE forecast DROP CONSTRAINT forecast_reason_check;
ALTER TABLE forecast ADD CONSTRAINT forecast_reason_check CHECK (
  unavailable_reason IS NULL
  OR unavailable_reason IN ('team_not_mapped', 'no_history', 'division_not_loaded', 'competition_not_mapped', 'model_unreachable', 'contract_violation', 'cross_competition')
);

-- Down Migration

-- Forecasts are never rewritten (rule 5), so rows written with the new reason
-- stay; the narrower check applies to new rows only.
ALTER TABLE forecast DROP CONSTRAINT forecast_reason_check;
ALTER TABLE forecast ADD CONSTRAINT forecast_reason_check CHECK (
  unavailable_reason IS NULL
  OR unavailable_reason IN ('team_not_mapped', 'no_history', 'division_not_loaded', 'competition_not_mapped', 'model_unreachable', 'contract_violation')
) NOT VALID;
