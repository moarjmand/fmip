-- Up Migration

-- T-1030 (D-136): a panel post links to at most one thing of its own match --
-- an incident, a player in either line-up, the author's own prediction, or a
-- team statistic -- rendered as a card beside the post (blueprint 10.2).
--
-- **Columns on `panel_post`, not a link table.** "At most one" is then a CHECK
-- on one row instead of a unique index plus a promise, and a link is written
-- with its post in the same INSERT, so there is no moment when a post exists
-- and its link is still on its way.
--
-- **The schema refuses a link to another match.** `refuse_foreign_panel_link`
-- asks, for every kind, whether the target belongs to `NEW.fixture_id`, and
-- raises `PL020` with the kind in the HINT when it does not. The service does
-- not check first; it writes and lets this refuse, as with every other panel
-- guard (T-251).
--
-- **An incident is linked by id with no foreign key, and with what it said.**
-- The feed may change an incident after it was linked (a goal re-credited, a
-- card downgraded by VAR) or it may disappear. A foreign key would either
-- block that (RESTRICT) or blank the link through an UPDATE the rewrite guard
-- refuses (SET NULL). Instead the trigger stores the incident's fields in
-- `link_snapshot` at the moment of linking, and the read compares: the same,
-- changed, or gone -- and the card says which rather than showing the old
-- value as current (rule 4). A statistic keeps its value at posting the same
-- way, because the post was written about that number and the number moves
-- during a live match.
--
-- **A prediction link is a prediction_version**, the one in force when the
-- post was written, chosen by the trigger from the author's own prediction on
-- this match -- never supplied by the client, so a post cannot carry somebody
-- else's call. Who may *see* it is not decided here: the read applies the
-- author's own `prediction_history_visibility` (D-063).
--
-- **A link is never edited.** `refuse_panel_link_rewrite` refuses any UPDATE
-- that changes a link column, the tombstone included: a removed post keeps its
-- link columns and the read shows no card for it, exactly as it shows no body.
--
-- The guard is named `panel_post_with_link_guard` so that it runs **last** of
-- the BEFORE INSERT triggers (they fire alphabetically): a member who may not
-- post at all is told that, not that their link was wrong.

ALTER TABLE panel_post
  ADD COLUMN link_kind                  text,
  ADD COLUMN link_incident_id           uuid,
  ADD COLUMN link_person_id             uuid REFERENCES person (id),
  ADD COLUMN link_prediction_version_id uuid REFERENCES prediction_version (id),
  ADD COLUMN link_participant_id        uuid REFERENCES fixture_participant (id),
  ADD COLUMN link_metric                text,
  -- Written by the trigger only: the incident's fields, or the statistic's
  -- value, as they were when the post was written.
  ADD COLUMN link_snapshot              jsonb,
  ADD CONSTRAINT panel_post_link_kind
    CHECK (link_kind IS NULL OR link_kind IN ('incident', 'player', 'prediction', 'statistic')),
  -- One link at most, and each kind carries exactly its own columns.
  ADD CONSTRAINT panel_post_one_link CHECK (
    (link_kind IS NULL
      AND link_incident_id IS NULL AND link_person_id IS NULL
      AND link_prediction_version_id IS NULL AND link_participant_id IS NULL
      AND link_metric IS NULL AND link_snapshot IS NULL)
    OR (link_kind = 'incident'
      AND link_incident_id IS NOT NULL AND link_snapshot IS NOT NULL
      AND link_person_id IS NULL AND link_prediction_version_id IS NULL
      AND link_participant_id IS NULL AND link_metric IS NULL)
    OR (link_kind = 'player'
      AND link_person_id IS NOT NULL
      AND link_incident_id IS NULL AND link_prediction_version_id IS NULL
      AND link_participant_id IS NULL AND link_metric IS NULL AND link_snapshot IS NULL)
    OR (link_kind = 'prediction'
      AND link_prediction_version_id IS NOT NULL
      AND link_incident_id IS NULL AND link_person_id IS NULL
      AND link_participant_id IS NULL AND link_metric IS NULL AND link_snapshot IS NULL)
    OR (link_kind = 'statistic'
      AND link_participant_id IS NOT NULL AND link_metric IS NOT NULL
      AND link_snapshot IS NOT NULL
      AND link_incident_id IS NULL AND link_person_id IS NULL
      AND link_prediction_version_id IS NULL)
  );

CREATE INDEX panel_post_link_prediction_idx ON panel_post (link_prediction_version_id)
  WHERE link_prediction_version_id IS NOT NULL;

CREATE FUNCTION refuse_foreign_panel_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  found_incident incident%ROWTYPE;
  version_id uuid;
  stat_value numeric;
BEGIN
  IF NEW.link_kind IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.link_kind = 'incident' THEN
    SELECT * INTO found_incident FROM incident
     WHERE id = NEW.link_incident_id AND fixture_id = NEW.fixture_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the linked incident is not one of this match''s'
        USING ERRCODE = 'PL020', HINT = 'incident';
    END IF;
    NEW.link_snapshot := jsonb_build_object(
      'kind', found_incident.kind,
      'minute', found_incident.minute,
      'added_time', found_incident.added_time,
      'participant_id', found_incident.participant_id,
      'person_id', found_incident.person_id,
      'related_person_id', found_incident.related_person_id,
      'detail', found_incident.detail);

  ELSIF NEW.link_kind = 'player' THEN
    IF NOT EXISTS (
      SELECT 1 FROM lineup l
        JOIN fixture_participant fp ON fp.id = l.participant_id
       WHERE fp.fixture_id = NEW.fixture_id AND l.person_id = NEW.link_person_id
    ) THEN
      RAISE EXCEPTION 'the linked player is in neither line-up of this match'
        USING ERRCODE = 'PL020', HINT = 'player';
    END IF;

  ELSIF NEW.link_kind = 'prediction' THEN
    -- The author's own call on this match, the version in force now. A version
    -- supplied by the caller must be exactly that one.
    SELECT pv.id INTO version_id
      FROM user_prediction up
      JOIN prediction_version pv ON pv.prediction_id = up.id
     WHERE up.user_id = NEW.author_id AND up.fixture_id = NEW.fixture_id
     ORDER BY pv.version_number DESC
     LIMIT 1;
    IF version_id IS NULL
       OR (NEW.link_prediction_version_id IS NOT NULL
           AND NEW.link_prediction_version_id <> version_id) THEN
      RAISE EXCEPTION 'the author has no prediction of their own on this match to link'
        USING ERRCODE = 'PL020', HINT = 'prediction';
    END IF;
    NEW.link_prediction_version_id := version_id;

  ELSIF NEW.link_kind = 'statistic' THEN
    SELECT s.value INTO stat_value
      FROM fixture_stat s
      JOIN fixture_participant fp ON fp.id = s.participant_id
     WHERE s.participant_id = NEW.link_participant_id
       AND fp.fixture_id = NEW.fixture_id
       AND s.metric = NEW.link_metric;
    IF NOT FOUND THEN
      -- Also refused when the statistic belongs to this match but was never
      -- supplied: a card for a number nobody has would invent one (rule 3).
      RAISE EXCEPTION 'the linked statistic is not supplied for this match'
        USING ERRCODE = 'PL020', HINT = 'statistic';
    END IF;
    NEW.link_snapshot := jsonb_build_object('value', stat_value);
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_foreign_panel_link() IS
  'Refuses a panel post link to anything outside the post''s own match, and records what an incident or statistic said when linked (T-1030, D-136). SQLSTATE PL020, HINT the kind.';

CREATE TRIGGER panel_post_with_link_guard
  BEFORE INSERT ON panel_post
  FOR EACH ROW EXECUTE FUNCTION refuse_foreign_panel_link();

CREATE FUNCTION refuse_panel_link_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.link_kind, NEW.link_incident_id, NEW.link_person_id,
      NEW.link_prediction_version_id, NEW.link_participant_id, NEW.link_metric,
      NEW.link_snapshot)
     IS DISTINCT FROM
     (OLD.link_kind, OLD.link_incident_id, OLD.link_person_id,
      OLD.link_prediction_version_id, OLD.link_participant_id, OLD.link_metric,
      OLD.link_snapshot) THEN
    RAISE EXCEPTION 'a panel post''s link is written with the post and never changed'
      USING ERRCODE = 'PL007', HINT = 'a different link is a new post';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_panel_link_rewrite() IS
  'Refuses any UPDATE that changes a panel post''s link (T-1030). SQLSTATE PL007.';

CREATE TRIGGER panel_post_link_fixed
  BEFORE UPDATE ON panel_post
  FOR EACH ROW EXECUTE FUNCTION refuse_panel_link_rewrite();

-- Down Migration

DROP TRIGGER IF EXISTS panel_post_link_fixed ON panel_post;
DROP FUNCTION IF EXISTS refuse_panel_link_rewrite();
DROP TRIGGER IF EXISTS panel_post_with_link_guard ON panel_post;
DROP FUNCTION IF EXISTS refuse_foreign_panel_link();
DROP INDEX IF EXISTS panel_post_link_prediction_idx;
ALTER TABLE panel_post
  DROP CONSTRAINT IF EXISTS panel_post_one_link,
  DROP CONSTRAINT IF EXISTS panel_post_link_kind,
  DROP COLUMN IF EXISTS link_snapshot,
  DROP COLUMN IF EXISTS link_metric,
  DROP COLUMN IF EXISTS link_participant_id,
  DROP COLUMN IF EXISTS link_prediction_version_id,
  DROP COLUMN IF EXISTS link_person_id,
  DROP COLUMN IF EXISTS link_incident_id,
  DROP COLUMN IF EXISTS link_kind;
