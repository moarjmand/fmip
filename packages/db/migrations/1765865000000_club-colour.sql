-- Up Migration
-- T-1416 (D-218): a club's colour, derived from the shirts it wore.
--
-- `fixture_participant.kit_colour` is the side's outfield shirt in that match
-- as the licensed feed gave it through the adapter (`#rrggbb`, T-1415): our
-- record of the match. `team.colour` is the club's colour, either derived
-- (`colour_source = 'kits'`) by `team_kit_colour` -- the colour worn most
-- often at home in the club's latest ten home matches with a stored shirt,
-- the most recent breaking a tie -- or set by an editor (`'editor'`, audited
-- by `catalog.mjs --set-colour`), which the derivation never overwrites. Both
-- are null until something is known (rule 3).
--
-- Past matches get their shirts from the `kit_colours` job (T-1417), not
-- from here: a migration asks no provider.
--
-- Triggers on the tables this touches, listed before writing it:
-- `fixture_participant` has `fixture_participant_notify_change` (a NOTIFY per
-- changed row; adding a column writes none) and `team` has
-- `team_set_updated_at`. Neither is immutable.

ALTER TABLE fixture_participant
  ADD COLUMN kit_colour text,
  ADD CONSTRAINT fixture_participant_kit_colour_hex
    CHECK (kit_colour IS NULL OR kit_colour ~ '^#[0-9a-f]{6}$');

ALTER TABLE team
  ADD COLUMN colour text,
  ADD COLUMN colour_source text,
  ADD CONSTRAINT team_colour_hex CHECK (colour IS NULL OR colour ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT team_colour_source_known
    CHECK (colour_source IS NULL OR colour_source IN ('kits', 'editor')),
  ADD CONSTRAINT team_colour_with_source CHECK ((colour IS NULL) = (colour_source IS NULL));

COMMENT ON COLUMN fixture_participant.kit_colour IS
  'The side''s outfield shirt in this match, #rrggbb, from the licensed feed through its adapter (T-1416, D-218). Null when not supplied.';
COMMENT ON COLUMN team.colour IS
  'The club''s colour, #rrggbb (T-1416, D-218): derived from its home shirts (colour_source kits) or set by an editor (editor). Shown only on the club and player bands (D-204).';

CREATE FUNCTION team_kit_colour(team_id uuid) RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT recent.kit_colour
    FROM (
      SELECT fp.kit_colour, f.kickoff_at
        FROM fixture_participant fp
        JOIN fixture f ON f.id = fp.fixture_id
       WHERE fp.team_id = $1 AND fp.side = 'home' AND fp.kit_colour IS NOT NULL
       ORDER BY f.kickoff_at DESC
       LIMIT 10
    ) recent
   GROUP BY recent.kit_colour
   ORDER BY count(*) DESC, max(recent.kickoff_at) DESC
   LIMIT 1
$$;

COMMENT ON FUNCTION team_kit_colour(uuid) IS
  'D-218: the colour a team wore most often at home in its latest ten home matches with a stored shirt, the most recent breaking a tie; null with none.';

-- Down Migration

DROP FUNCTION team_kit_colour(uuid);

ALTER TABLE team
  DROP CONSTRAINT team_colour_with_source,
  DROP CONSTRAINT team_colour_source_known,
  DROP CONSTRAINT team_colour_hex,
  DROP COLUMN colour_source,
  DROP COLUMN colour;

ALTER TABLE fixture_participant
  DROP CONSTRAINT fixture_participant_kit_colour_hex,
  DROP COLUMN kit_colour;
