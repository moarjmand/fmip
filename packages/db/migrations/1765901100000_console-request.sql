-- Up Migration

-- ---------------------------------------------------------------------------
-- Teammate requests in the agents console (T-1728, D-354).
--
-- The maintainer writes down what the teammate asks for; Claude, in the
-- maintainer's own chat on his computer, reads them over `ssh`
-- (`list-requests`), does the work only when the maintainer says so, and
-- writes the result back (`request-result`). When the maintainer says to
-- wait for the teammate, Claude puts the question on the request
-- (`request-ask`) and any console user answers it in the console.
--
-- `console_request` is the request as it stands now; `console_request_event`
-- is its history, append-only like `console_audit`, shown as the request's
-- timeline. A person's change also writes its `console_audit` row (rule 10).
-- ---------------------------------------------------------------------------

CREATE TABLE console_request (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  body                  text NOT NULL DEFAULT '',
  status                text NOT NULL DEFAULT 'new',
  priority              text NOT NULL DEFAULT 'normal',
  created_by            uuid NOT NULL REFERENCES console_user (id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- The result box: written by Claude through the command line only.
  result                text,
  result_at             timestamptz,
  -- The open or answered question for the teammate.
  decision_question     text,
  decision_asked_at     timestamptz,
  decision_choice       text,
  decision_text         text,
  decided_by            uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  decided_at            timestamptz,
  -- A console user's "run it now"; cleared when the request closes.
  execute_requested_at  timestamptz,
  execute_requested_by  uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  CONSTRAINT console_request_title_length CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  CONSTRAINT console_request_body_length CHECK (char_length(body) <= 4000),
  CONSTRAINT console_request_status CHECK (
    status IN ('new', 'in_progress', 'waiting_decision', 'decided', 'done', 'cancelled')
  ),
  CONSTRAINT console_request_priority CHECK (priority IN ('normal', 'high')),
  CONSTRAINT console_request_result_length CHECK (
    result IS NULL OR (btrim(result) <> '' AND char_length(result) <= 8000)
  ),
  CONSTRAINT console_request_result_time CHECK ((result IS NULL) = (result_at IS NULL)),
  CONSTRAINT console_request_question_length CHECK (
    decision_question IS NULL OR (btrim(decision_question) <> '' AND char_length(decision_question) <= 2000)
  ),
  -- Waiting for a decision always has its question.
  CONSTRAINT console_request_waiting_has_question CHECK (
    status <> 'waiting_decision' OR decision_question IS NOT NULL
  ),
  CONSTRAINT console_request_choice CHECK (
    decision_choice IS NULL OR decision_choice IN ('approve', 'reject', 'other')
  ),
  CONSTRAINT console_request_decision_text_length CHECK (
    decision_text IS NULL OR char_length(decision_text) <= 4000
  ),
  -- A decision is whole: its choice, who and when, and only on a question.
  CONSTRAINT console_request_decision_whole CHECK (
    (decision_choice IS NULL) = (decided_by IS NULL)
    AND (decision_choice IS NULL) = (decided_at IS NULL)
    AND (decision_choice IS NULL OR decision_question IS NOT NULL)
    AND (decision_choice IS NOT NULL OR decision_text IS NULL)
  ),
  CONSTRAINT console_request_execute_whole CHECK (
    (execute_requested_at IS NULL) = (execute_requested_by IS NULL)
  )
);

-- The list, newest first, and its tabs.
CREATE INDEX console_request_created ON console_request (created_at DESC, id DESC);
CREATE INDEX console_request_status_created ON console_request (status, created_at DESC);

COMMENT ON TABLE console_request IS
  'Teammate requests kept by the maintainer in the agents console (T-1728, D-354); Claude acts on one only on the maintainer''s word in his own chat.';

CREATE TABLE console_request_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES console_request (id) ON DELETE RESTRICT,
  -- The console user; NULL is Claude, through the server's command line.
  actor_id     uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  kind         text NOT NULL,
  from_status  text,
  to_status    text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT console_request_event_kind CHECK (kind IN (
    'created', 'edited', 'cancelled', 'reopened', 'execute_requested', 'execute_withdrawn',
    'asked', 'decided', 'result'
  )),
  -- Only Claude writes a result or asks a question; only a person does the rest.
  CONSTRAINT console_request_event_actor CHECK (
    (kind IN ('result', 'asked')) = (actor_id IS NULL)
  ),
  CONSTRAINT console_request_event_note_length CHECK (note IS NULL OR char_length(note) <= 8000)
);

-- A request's timeline, oldest first.
CREATE INDEX console_request_event_request ON console_request_event (request_id, created_at, id);
-- A person's changes this hour, for the ceiling.
CREATE INDEX console_request_event_actor ON console_request_event (actor_id, created_at)
  WHERE actor_id IS NOT NULL;

CREATE TRIGGER console_request_event_immutable
  BEFORE UPDATE OR DELETE ON console_request_event FOR EACH ROW EXECUTE FUNCTION refuse_change();

COMMENT ON TABLE console_request_event IS
  'The history of each teammate request (T-1728, D-354): who did what, when, and the status before and after. Immutable.';

-- The ceiling (D-103's inventory): sixty changes to the requests an hour per
-- console account, counted by the API from the person's own
-- `console_request_event` rows in the clock hour, before the write. Two
-- people keeping a list do not make sixty changes an hour; a stuck form or a
-- script would.
INSERT INTO rate_limit (action, per_hour) VALUES ('console_request', 60)
ON CONFLICT (action) DO NOTHING;

-- Down Migration

DELETE FROM rate_limit WHERE action = 'console_request';
DROP TABLE console_request_event;
DROP TABLE console_request;
