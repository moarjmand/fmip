-- Up Migration

-- T-130: the founder's match analysis (blueprint 6.5).
--
-- One of the three prediction products, and the whole point of rule 6 is that
-- it stays one of three: the statistical model, this, and the community
-- consensus are never blended or relabelled. The schema keeps them apart by
-- keeping them in different tables with different owners — a forecast is
-- written by the model service, a prediction by a member, and an analysis by a
-- person with the `founder` role, signed.
--
-- **Versions, not edits.** The blueprint asks for "publication time and any
-- clearly recorded update before kick-off", so an update is a new version with
-- its own publication time and the previous one stays readable. Every stored
-- version is published: a draft is not a thing the product shows, and making it
-- a row would mean an editable row, which is the one thing this table must not
-- have.
--
-- **Nothing after kick-off.** The same wall predictions meet (T-051), for the
-- stronger reason: an analysis edited once the result is known is not an
-- analysis, and a public record of predictions is worth nothing if it can be
-- revised in hindsight. The database clock decides, not the API's.

-- ---------------------------------------------------------------------------
-- founder_analysis
-- ---------------------------------------------------------------------------
-- One per fixture. The author is recorded because the blueprint says each entry
-- is "written and signed personally" — the signature is a row, not a byline
-- someone typed.
CREATE TABLE founder_analysis (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT founder_analysis_one_per_fixture UNIQUE (fixture_id)
);

CREATE INDEX founder_analysis_author_idx ON founder_analysis (author_id);

COMMENT ON TABLE founder_analysis IS
  'The founder''s analysis of one fixture (blueprint 6.5). The content is in its versions; this row is the identity and the signature.';

-- ---------------------------------------------------------------------------
-- founder_analysis_version
-- ---------------------------------------------------------------------------
-- Immutable. Every field the blueprint lists is here; the optional ones are
-- nullable and absent means absent, never an empty string pretending to be
-- prose (rule 3).
CREATE TABLE founder_analysis_version (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id       uuid NOT NULL REFERENCES founder_analysis (id) ON DELETE CASCADE,
  version_number    integer NOT NULL,
  -- The call itself.
  predicted_outcome text NOT NULL,
  predicted_home    smallint,
  predicted_away    smallint,
  -- 1 to 5, the same scale a member's prediction uses, so the two are readable
  -- side by side without a conversion nobody would trust.
  confidence        smallint NOT NULL,
  -- The blueprint's content fields. `reasoning` is required: an analysis with
  -- no reasoning is a prediction, and the product already has those.
  reasoning         text NOT NULL,
  lineup_impact     text,
  key_players       text,
  form_and_context  text,
  published_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT founder_version_outcome_check
    CHECK (predicted_outcome IN ('home', 'draw', 'away')),
  CONSTRAINT founder_version_score_complete
    CHECK ((predicted_home IS NULL) = (predicted_away IS NULL)),
  CONSTRAINT founder_version_score_non_negative
    CHECK ((predicted_home IS NULL OR predicted_home >= 0)
       AND (predicted_away IS NULL OR predicted_away >= 0)),
  -- A predicted score that contradicts the predicted outcome is two different
  -- calls in one row, and the page would have to choose which to believe.
  CONSTRAINT founder_version_score_matches_outcome CHECK (
    predicted_home IS NULL OR predicted_outcome = CASE
      WHEN predicted_home > predicted_away THEN 'home'
      WHEN predicted_home < predicted_away THEN 'away'
      ELSE 'draw'
    END
  ),
  CONSTRAINT founder_version_confidence_range CHECK (confidence BETWEEN 1 AND 5),
  CONSTRAINT founder_version_reasoning_not_blank CHECK (btrim(reasoning) <> ''),
  CONSTRAINT founder_version_optional_not_blank CHECK (
    (lineup_impact IS NULL OR btrim(lineup_impact) <> '')
    AND (key_players IS NULL OR btrim(key_players) <> '')
    AND (form_and_context IS NULL OR btrim(form_and_context) <> '')
  ),
  CONSTRAINT founder_version_number_positive CHECK (version_number >= 1),
  CONSTRAINT founder_version_unique UNIQUE (analysis_id, version_number)
);

CREATE INDEX founder_version_published_idx
  ON founder_analysis_version (analysis_id, published_at DESC);

COMMENT ON TABLE founder_analysis_version IS
  'One published version of a founder analysis. Immutable; the newest is current and the earlier ones stay readable as the record of what was said when.';

-- ---------------------------------------------------------------------------
-- The two walls
-- ---------------------------------------------------------------------------
CREATE TRIGGER founder_analysis_set_updated_at
  BEFORE UPDATE ON founder_analysis FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER founder_analysis_version_immutable
  BEFORE UPDATE OR DELETE ON founder_analysis_version
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- The same device as T-051, and the same reasoning: the API's clock is not the
-- authority. A version can only be written while the database itself says the
-- match has not started, so an analysis cannot be revised in hindsight by a
-- skewed server, a queued request, or a script writing straight to the table.
CREATE FUNCTION refuse_analysis_after_kickoff() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kickoff timestamptz;
BEGIN
  SELECT f.kickoff_at INTO kickoff
    FROM founder_analysis a
    JOIN fixture f ON f.id = a.fixture_id
   WHERE a.id = NEW.analysis_id;

  IF kickoff IS NULL THEN
    RAISE EXCEPTION 'analysis % has no fixture', NEW.analysis_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF now() >= kickoff THEN
    RAISE EXCEPTION 'a founder analysis is locked at kick-off (%)', kickoff
      USING ERRCODE = 'PL002', HINT = 'kick-off has passed by the database clock';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_analysis_after_kickoff() IS
  'Refuses a founder_analysis_version once the fixture has kicked off, by the database clock (T-130). SQLSTATE PL002.';

CREATE TRIGGER founder_analysis_version_lock
  BEFORE INSERT ON founder_analysis_version
  FOR EACH ROW EXECUTE FUNCTION refuse_analysis_after_kickoff();

-- Down Migration

DROP TRIGGER IF EXISTS founder_analysis_version_lock ON founder_analysis_version;
DROP FUNCTION IF EXISTS refuse_analysis_after_kickoff();
DROP TABLE IF EXISTS founder_analysis_version;
DROP TABLE IF EXISTS founder_analysis;
