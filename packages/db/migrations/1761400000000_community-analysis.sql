-- Up Migration

-- T-260: community-written match analysis (blueprint 10.3).
--
-- **This is a fourth signed opinion, and the schema is where rule 6 is most
-- likely to break.** Community analysis contains a predicted result, a
-- confidence and reasoning, which makes it look exactly like `founder_analysis`
-- in a diagram. Storing it there with a different `author_id` would be the
-- obvious, wrong, one-line version of this epic -- and it would make the
-- founder's own signature mean nothing, because the column that distinguished
-- them would be one a query could forget to filter on.
--
-- So: its own tables, sharing nothing. The cost is real -- two analysis shapes,
-- two kick-off walls, two immutability triggers -- and it is the price of the
-- reader always knowing whose opinion they are reading.
--
-- **The workflow is four rows, not a status column.** Draft, submission, review
-- decision, published version. A `state` column would be a fact kept in one
-- place and changed by several, and the question this epic has to answer months
-- later is "who approved this, and what did it say when they did" -- which a
-- column cannot answer and a row can.

-- ---------------------------------------------------------------------------
-- community_analysis
-- ---------------------------------------------------------------------------
-- The identity and the signature: this analyst, this match. One each -- an
-- analyst who wants to say something different revises, and the history is in
-- the versions.
CREATE TABLE community_analysis (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id uuid NOT NULL REFERENCES fixture (id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Not unique per fixture, unlike the founder's: a match can carry many
  -- analysts' opinions and that is the point of the feature.
  CONSTRAINT community_analysis_one_per_author UNIQUE (fixture_id, author_id)
);

CREATE INDEX community_analysis_author_idx ON community_analysis (author_id, created_at DESC);

COMMENT ON TABLE community_analysis IS
  'One analyst''s analysis of one fixture (blueprint 10.3, T-260). Its own table, sharing nothing with founder_analysis (rule 6).';

CREATE TRIGGER community_analysis_set_updated_at
  BEFORE UPDATE ON community_analysis FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Writing one at all needs a live contributor grant (T-250). The same gate the
-- public panel uses, asked the same way, because approval to write in public is
-- one decision and not two.
CREATE FUNCTION refuse_unapproved_analysis() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT member_may_contribute(NEW.author_id) THEN
    RAISE EXCEPTION 'writing analysis needs an approved contributor grant'
      USING ERRCODE = 'PL014', HINT = 'no live contributor grant';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_unapproved_analysis() IS
  'Refuses a community analysis from a member without a live contributor grant (T-260). SQLSTATE PL014.';

CREATE TRIGGER community_analysis_approval_guard
  BEFORE INSERT ON community_analysis
  FOR EACH ROW EXECUTE FUNCTION refuse_unapproved_analysis();

-- ---------------------------------------------------------------------------
-- community_analysis_draft
-- ---------------------------------------------------------------------------
-- The working copy, and the only mutable content in this epic. One per
-- analysis: a draft is where somebody is still thinking, and keeping a history
-- of half-finished thoughts would be a surveillance feature rather than an
-- editorial one.
--
-- The fields are the blueprint's, and they are **named the same as the
-- founder's on purpose while living in a different table**. Renaming them to
-- avoid the resemblance would make the two harder to read side by side without
-- making them any harder to confuse in a query.
CREATE TABLE community_analysis_draft (
  analysis_id       uuid PRIMARY KEY REFERENCES community_analysis (id) ON DELETE CASCADE,
  predicted_outcome text NOT NULL,
  predicted_home    smallint,
  predicted_away    smallint,
  confidence        smallint NOT NULL,
  reasoning         text NOT NULL,
  lineup_impact     text,
  key_players       text,
  form_and_context  text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_draft_outcome_check
    CHECK (predicted_outcome IN ('home', 'draw', 'away')),
  CONSTRAINT community_draft_score_complete
    CHECK ((predicted_home IS NULL) = (predicted_away IS NULL)),
  CONSTRAINT community_draft_score_non_negative
    CHECK ((predicted_home IS NULL OR predicted_home >= 0)
       AND (predicted_away IS NULL OR predicted_away >= 0)),
  -- A predicted score that contradicts the predicted outcome is two calls in
  -- one row, and a page would have to choose which to believe.
  CONSTRAINT community_draft_score_matches_outcome CHECK (
    predicted_home IS NULL OR predicted_outcome = CASE
      WHEN predicted_home > predicted_away THEN 'home'
      WHEN predicted_home < predicted_away THEN 'away'
      ELSE 'draw'
    END
  ),
  CONSTRAINT community_draft_confidence_range CHECK (confidence BETWEEN 1 AND 5),
  -- An analysis with no reasoning is a prediction, and the product already has
  -- those.
  CONSTRAINT community_draft_reasoning_not_blank CHECK (btrim(reasoning) <> ''),
  CONSTRAINT community_draft_optional_not_blank CHECK (
    (lineup_impact IS NULL OR btrim(lineup_impact) <> '')
    AND (key_players IS NULL OR btrim(key_players) <> '')
    AND (form_and_context IS NULL OR btrim(form_and_context) <> '')
  )
);

COMMENT ON TABLE community_analysis_draft IS
  'The working copy of one community analysis (T-260). Mutable, one per analysis; everything downstream of it is immutable.';

CREATE TRIGGER community_analysis_draft_set_updated_at
  BEFORE UPDATE ON community_analysis_draft FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- community_analysis_submission
-- ---------------------------------------------------------------------------
-- The draft as it was when somebody asked for it to be reviewed. Immutable, and
-- a copy rather than a reference: a reviewer must be able to say what they were
-- looking at, and a draft that kept changing under them would make every review
-- decision unverifiable afterwards.
--
-- Several per analysis, because "changes requested" is a real outcome and the
-- second attempt is a second submission.
CREATE TABLE community_analysis_submission (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id       uuid NOT NULL REFERENCES community_analysis (id) ON DELETE CASCADE,
  attempt           integer NOT NULL,
  predicted_outcome text NOT NULL,
  predicted_home    smallint,
  predicted_away    smallint,
  confidence        smallint NOT NULL,
  reasoning         text NOT NULL,
  lineup_impact     text,
  key_players       text,
  form_and_context  text,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_submission_attempt_positive CHECK (attempt >= 1),
  CONSTRAINT community_submission_unique UNIQUE (analysis_id, attempt),
  CONSTRAINT community_submission_outcome_check
    CHECK (predicted_outcome IN ('home', 'draw', 'away')),
  CONSTRAINT community_submission_confidence_range CHECK (confidence BETWEEN 1 AND 5),
  CONSTRAINT community_submission_reasoning_not_blank CHECK (btrim(reasoning) <> '')
);

CREATE INDEX community_submission_analysis_idx
  ON community_analysis_submission (analysis_id, attempt DESC);

COMMENT ON TABLE community_analysis_submission IS
  'A community analysis as it was when review was asked for (T-260). Immutable copy, not a reference: a reviewer must be able to say what they were looking at.';

CREATE TRIGGER community_analysis_submission_immutable
  BEFORE UPDATE OR DELETE ON community_analysis_submission
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- ---------------------------------------------------------------------------
-- community_analysis_review
-- ---------------------------------------------------------------------------
-- One reviewer's decision about one submission. Immutable, names its actor and
-- its reason -- the same shape `moderation_decision` has, for the same reason
-- (rule 10): a decision that can be edited afterwards is not a record.
--
-- **One review per submission**, enforced by the primary key rather than by a
-- convention. Two reviewers reaching different conclusions about the same
-- submission is a situation the product has no answer for, so it is made
-- impossible rather than resolved arbitrarily.
CREATE TABLE community_analysis_review (
  submission_id uuid PRIMARY KEY
                REFERENCES community_analysis_submission (id) ON DELETE CASCADE,
  reviewer_id   uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  decision      text NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_review_decision_check
    CHECK (decision IN ('approved', 'changes_requested', 'rejected')),
  -- Every decision, including an approval. "Why did this get through" is as
  -- much a question as "why was this refused", and only one of them is usually
  -- asked in time.
  CONSTRAINT community_review_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE INDEX community_review_reviewer_idx ON community_analysis_review (reviewer_id, created_at DESC);

COMMENT ON TABLE community_analysis_review IS
  'One reviewer''s decision about one submission (blueprint 10.3, T-260). Immutable, names actor and reason; one per submission by the primary key.';

CREATE TRIGGER community_analysis_review_immutable
  BEFORE UPDATE OR DELETE ON community_analysis_review
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- ---------------------------------------------------------------------------
-- community_analysis_version
-- ---------------------------------------------------------------------------
-- What the public reads. Immutable, versioned after publication, and descended
-- from the approval that allowed it -- which is how "who approved this" survives
-- as a foreign key rather than as a note.
CREATE TABLE community_analysis_version (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id       uuid NOT NULL REFERENCES community_analysis (id) ON DELETE CASCADE,
  -- The approved submission this was published from. RESTRICT, so the record of
  -- what was approved cannot be removed out from under what was published.
  submission_id     uuid NOT NULL
                    REFERENCES community_analysis_submission (id) ON DELETE RESTRICT,
  version_number    integer NOT NULL,
  predicted_outcome text NOT NULL,
  predicted_home    smallint,
  predicted_away    smallint,
  confidence        smallint NOT NULL,
  reasoning         text NOT NULL,
  lineup_impact     text,
  key_players       text,
  form_and_context  text,
  published_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_version_number_positive CHECK (version_number >= 1),
  CONSTRAINT community_version_unique UNIQUE (analysis_id, version_number),
  -- One publication per approved submission: publishing the same approval twice
  -- would be two versions saying the same thing with different numbers.
  CONSTRAINT community_version_one_per_submission UNIQUE (submission_id),
  CONSTRAINT community_version_outcome_check
    CHECK (predicted_outcome IN ('home', 'draw', 'away')),
  CONSTRAINT community_version_confidence_range CHECK (confidence BETWEEN 1 AND 5),
  CONSTRAINT community_version_reasoning_not_blank CHECK (btrim(reasoning) <> '')
);

CREATE INDEX community_version_published_idx
  ON community_analysis_version (analysis_id, published_at DESC);

COMMENT ON TABLE community_analysis_version IS
  'One published version of a community analysis (blueprint 10.3, T-260). Immutable; the newest is current and the earlier ones stay readable.';

CREATE TRIGGER community_analysis_version_immutable
  BEFORE UPDATE OR DELETE ON community_analysis_version
  FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- ---------------------------------------------------------------------------
-- The kick-off wall
-- ---------------------------------------------------------------------------
-- The same device as T-051 and T-130, and the same reasoning: the API's clock is
-- not the authority. **A call revised after the result is known is not a call**,
-- and this is what stops a skewed server, a queued request or a script writing
-- straight to the table from producing one.
--
-- It guards submission and publication, not the draft: an analyst may keep
-- editing their own unpublished notes after kick-off, because nobody has been
-- shown them and nothing is being claimed.
CREATE FUNCTION refuse_community_analysis_after_kickoff() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kickoff timestamptz;
BEGIN
  SELECT f.kickoff_at INTO kickoff
    FROM community_analysis a
    JOIN fixture f ON f.id = a.fixture_id
   WHERE a.id = NEW.analysis_id;

  IF kickoff IS NOT NULL AND kickoff <= now() THEN
    RAISE EXCEPTION 'this match has kicked off'
      USING ERRCODE = 'PL002', HINT = 'kick-off has passed by the database clock';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_community_analysis_after_kickoff() IS
  'Refuses a submission or a publication once the database clock has reached kick-off (T-260). SQLSTATE PL002.';

CREATE TRIGGER community_submission_kickoff_guard
  BEFORE INSERT ON community_analysis_submission
  FOR EACH ROW EXECUTE FUNCTION refuse_community_analysis_after_kickoff();

CREATE TRIGGER community_version_kickoff_guard
  BEFORE INSERT ON community_analysis_version
  FOR EACH ROW EXECUTE FUNCTION refuse_community_analysis_after_kickoff();

-- ---------------------------------------------------------------------------
-- community_analysis_state(analysis)
-- ---------------------------------------------------------------------------
-- Derived, never stored. A `state` column would be one fact kept in one place
-- and changed from four, and the first time it disagreed with the rows nobody
-- would know which to believe.
CREATE FUNCTION community_analysis_state(analysis uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    -- Published wins: a later "changes requested" on a newer attempt does not
    -- unpublish what the public has already read.
    WHEN EXISTS (SELECT 1 FROM community_analysis_version v WHERE v.analysis_id = analysis)
      THEN 'published'
    ELSE coalesce(
      (SELECT CASE
                WHEN r.decision IS NULL THEN 'submitted'
                WHEN r.decision = 'approved' THEN 'approved'
                ELSE r.decision
              END
         FROM community_analysis_submission s
         LEFT JOIN community_analysis_review r ON r.submission_id = s.id
        WHERE s.analysis_id = analysis
        ORDER BY s.attempt DESC
        LIMIT 1),
      'draft')
  END
$$;

COMMENT ON FUNCTION community_analysis_state(uuid) IS
  'draft, submitted, approved, changes_requested, rejected or published, derived from the rows (T-260).';

-- Down Migration

DROP FUNCTION IF EXISTS community_analysis_state(uuid);
DROP TRIGGER IF EXISTS community_version_kickoff_guard ON community_analysis_version;
DROP TRIGGER IF EXISTS community_submission_kickoff_guard ON community_analysis_submission;
DROP FUNCTION IF EXISTS refuse_community_analysis_after_kickoff();
DROP TRIGGER IF EXISTS community_analysis_version_immutable ON community_analysis_version;
DROP TABLE IF EXISTS community_analysis_version;
DROP TRIGGER IF EXISTS community_analysis_review_immutable ON community_analysis_review;
DROP TABLE IF EXISTS community_analysis_review;
DROP TRIGGER IF EXISTS community_analysis_submission_immutable ON community_analysis_submission;
DROP TABLE IF EXISTS community_analysis_submission;
DROP TRIGGER IF EXISTS community_analysis_draft_set_updated_at ON community_analysis_draft;
DROP TABLE IF EXISTS community_analysis_draft;
DROP TRIGGER IF EXISTS community_analysis_approval_guard ON community_analysis;
DROP FUNCTION IF EXISTS refuse_unapproved_analysis();
DROP TRIGGER IF EXISTS community_analysis_set_updated_at ON community_analysis;
DROP TABLE IF EXISTS community_analysis;
