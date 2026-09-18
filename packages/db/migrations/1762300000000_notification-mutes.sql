-- Up Migration
-- T-331 (blueprint 12.2): per-team, per-competition and per-category
-- controls. A member can silence one team without silencing football.
--
-- The alternative to this table is a member turning everything off, which is
-- the last thing they do in the product. A mute is a row, so it is a fact
-- with a date and a scope: a team (by id, never by name -- rule 1), a
-- competition, or a whole category of kinds. Nothing here is a default:
-- a member with no rows hears everything their kind preferences allow.
CREATE TABLE notification_mute (
  user_id    uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  scope      text NOT NULL,
  -- A team or competition id, or a category name.
  target     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_mute_pkey PRIMARY KEY (user_id, scope, target),
  CONSTRAINT notification_mute_scope_check CHECK (scope IN ('team', 'competition', 'category')),
  CONSTRAINT notification_mute_target_shape CHECK (
    (scope = 'category' AND target IN ('football', 'social', 'account'))
    OR (scope <> 'category'
        AND target ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  )
);

COMMENT ON TABLE notification_mute IS
  'What a member chose not to hear about: a team, a competition or a category of kinds (blueprint 12.2, T-331).';

-- A conditional foreign key: the target must exist for its scope. A trigger
-- rather than two nullable columns, because a row with one scope and two
-- targets is a shape that lies.
CREATE FUNCTION notification_mute_target_exists() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  -- The shape first, so a name where an id belongs is a refusal and not a cast error.
  IF NEW.scope <> 'category'
     AND NEW.target !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'a % mute names one by its id, not "%"', NEW.scope, NEW.target
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.scope = 'team' AND NOT EXISTS (SELECT 1 FROM team WHERE id = NEW.target::uuid) THEN
    RAISE EXCEPTION 'no such team %', NEW.target USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.scope = 'competition'
     AND NOT EXISTS (SELECT 1 FROM competition WHERE id = NEW.target::uuid) THEN
    RAISE EXCEPTION 'no such competition %', NEW.target USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER notification_mute_target_exists
  BEFORE INSERT OR UPDATE ON notification_mute
  FOR EACH ROW EXECUTE FUNCTION notification_mute_target_exists();

-- ---------------------------------------------------------------------------
-- What a notification is about, in football terms: the teams and the
-- competition of the match behind its subject. A fixture is itself; a
-- prediction and a panel post point at one. Every other subject is about
-- nobody's team, and a team mute leaves it alone -- a friend request is not
-- football.
-- ---------------------------------------------------------------------------
CREATE FUNCTION notification_about(p_subject_type text, p_subject_id text)
  RETURNS TABLE (team_id uuid, competition_id uuid)
  LANGUAGE sql STABLE AS $$
  WITH subject AS (
    SELECT CASE p_subject_type
             WHEN 'fixture' THEN p_subject_id::uuid
             WHEN 'prediction' THEN (SELECT fixture_id FROM user_prediction WHERE id = p_subject_id::uuid)
             WHEN 'panel_post' THEN (SELECT fixture_id FROM panel_post WHERE id = p_subject_id::uuid)
           END AS fixture_id
     WHERE p_subject_type IN ('fixture', 'prediction', 'panel_post')
       AND p_subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  SELECT p.team_id, s.competition_id
    FROM subject
    JOIN fixture f ON f.id = subject.fixture_id
    JOIN season s ON s.id = f.season_id
    JOIN fixture_participant p ON p.fixture_id = f.id
$$;

COMMENT ON FUNCTION notification_about(text, text) IS
  'The teams and competition a notification is about, through its subject; empty for a subject that is not football (T-331).';

-- The one question emission asks: is this member muting what this is about?
-- Answers the scope that matched, so the outcome can say why, or NULL.
CREATE FUNCTION notification_muted_for(p_user uuid, p_subject_type text, p_subject_id text)
  RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT m.scope
    FROM notification_mute m
    JOIN notification_about(p_subject_type, p_subject_id) a
      ON (m.scope = 'team' AND m.target = a.team_id::text)
      OR (m.scope = 'competition' AND m.target = a.competition_id::text)
   WHERE m.user_id = p_user
   ORDER BY m.scope
   LIMIT 1
$$;

-- Down Migration

DROP FUNCTION IF EXISTS notification_muted_for(uuid, text, text);
DROP FUNCTION IF EXISTS notification_about(text, text);
DROP TRIGGER IF EXISTS notification_mute_target_exists ON notification_mute;
DROP FUNCTION IF EXISTS notification_mute_target_exists();
DROP TABLE notification_mute;
