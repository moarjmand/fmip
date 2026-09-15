-- Up Migration

-- T-253: which fixtures have a panel at all (blueprint 10.2).
--
-- **Until now every fixture had a panel, because nothing said which ones did.**
-- That is the wrong default and it was always going to be: a public discussion
-- attached to all ten thousand fixtures in a season is ten thousand rooms
-- nobody is reading, each of which can still be used to reach the public. The
-- moderation cost of a room is the same whether or not anybody wanted it.
--
-- So a panel is **opened**, by a person, for a reason, and the opening is a row
-- (rule 10). Not a boolean on `fixture`: a flag has no actor and no history, and
-- "who decided this match should have a public discussion, and when" is exactly
-- the question somebody asks after one goes wrong.
--
-- **Closing is not deleting.** A closed panel is still readable and accepts no
-- new posts. Taking the words down when the argument ends would rewrite a
-- record that people were told was public, and the reader who followed a link
-- to it should find what they were shown, not a 404.

CREATE TABLE match_panel (
  -- One per fixture, so the primary key says so rather than a unique index
  -- apologising for a surrogate one.
  fixture_id   uuid PRIMARY KEY REFERENCES fixture (id) ON DELETE CASCADE,
  opened_by    uuid NOT NULL REFERENCES user_account (id) ON DELETE RESTRICT,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  closed_by    uuid REFERENCES user_account (id) ON DELETE RESTRICT,
  close_reason text,
  CONSTRAINT match_panel_reason_not_blank CHECK (btrim(reason) <> ''),
  -- Closing is an act with an actor and a reason, or it did not happen -- the
  -- same shape `sanction`'s lift has, for the same reason (rule 10).
  CONSTRAINT match_panel_close_is_whole
    CHECK (
      (closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL)
      OR (closed_at IS NOT NULL
          AND closed_by IS NOT NULL
          AND btrim(coalesce(close_reason, '')) <> '')
    )
);

-- "Which matches have an open panel", which is the operator's list and the
-- feed's.
CREATE INDEX match_panel_open_idx ON match_panel (created_at DESC) WHERE closed_at IS NULL;

COMMENT ON TABLE match_panel IS
  'The decision that one fixture has a public discussion (blueprint 10.2, T-253). Opened by a person for a reason; closing keeps it readable and stops new posts.';

-- ---------------------------------------------------------------------------
-- fixture_panel_open(fixture_id)
-- ---------------------------------------------------------------------------
-- The single definition of "this match is open for posting", written once here
-- so no surface grows its own -- the same reason `users_blocked` and
-- `member_may_contribute` exist.
CREATE FUNCTION fixture_panel_open(match uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM match_panel WHERE fixture_id = match AND closed_at IS NULL
  )
$$;

COMMENT ON FUNCTION fixture_panel_open(uuid) IS
  'Whether a fixture has a panel that is open for posting (T-253).';

-- ---------------------------------------------------------------------------
-- The guard, and where it fires
-- ---------------------------------------------------------------------------
-- Named `panel_post_a_open_guard` so that it runs **first**: Postgres runs
-- BEFORE triggers in alphabetical order, and this has to beat `approval`
-- (`panel_post_approval_guard`, T-251).
--
-- The order is the same argument T-251 made, one level out. A member told they
-- are not an approved contributor will go and read about approval, and none of
-- it will help: there is no panel here to post on, and there would not be one
-- for them if they were approved tomorrow. "This match has no discussion" is
-- the refusal that is true of everybody, so it is the one heard first.
CREATE FUNCTION refuse_post_to_closed_panel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT fixture_panel_open(NEW.fixture_id) THEN
    RAISE EXCEPTION 'this match has no open discussion'
      USING ERRCODE = 'PL015', HINT = 'no open panel';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION refuse_post_to_closed_panel() IS
  'Refuses a post to a fixture with no open panel (T-253). SQLSTATE PL015.';

CREATE TRIGGER panel_post_a_open_guard
  BEFORE INSERT ON panel_post
  FOR EACH ROW EXECUTE FUNCTION refuse_post_to_closed_panel();

-- Down Migration

DROP TRIGGER IF EXISTS panel_post_a_open_guard ON panel_post;
DROP FUNCTION IF EXISTS refuse_post_to_closed_panel();
DROP FUNCTION IF EXISTS fixture_panel_open(uuid);
DROP TABLE IF EXISTS match_panel;
