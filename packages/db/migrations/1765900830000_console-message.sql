-- Up Migration

-- ---------------------------------------------------------------------------
-- Chat with an agent in the agents console (T-1722, D-350).
--
-- A console person writes to one agent; the maintainer's computer takes the
-- queued messages every ten minutes over `ssh` (`take-messages`), runs that
-- agent with the conversation, and posts its reply back (`post-reply`). No
-- model runs on the server: these rows are only text waiting for the computer.
--
-- One table for both sides. `author_id` is the console person; NULL is the
-- agent's reply, which always names the message it answers (`reply_to`), at
-- most one reply per message. Only a person's message has a status.
-- ---------------------------------------------------------------------------

CREATE TABLE console_message (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent        text NOT NULL,
  author_id    uuid REFERENCES console_user (id) ON DELETE RESTRICT,
  body         text NOT NULL,
  status       text,
  reply_to     uuid REFERENCES console_message (id) ON DELETE RESTRICT,
  failure      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  taken_at     timestamptz,
  answered_at  timestamptz,
  CONSTRAINT console_message_agent_format CHECK (agent ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  CONSTRAINT console_message_body_not_blank CHECK (btrim(body) <> ''),
  -- A person writes at most 4,000 characters; an agent's reply is cut to 8,000.
  CONSTRAINT console_message_body_length CHECK (
    char_length(body) <= CASE WHEN author_id IS NULL THEN 8000 ELSE 4000 END
  ),
  CONSTRAINT console_message_status CHECK (
    (author_id IS NOT NULL AND status IN ('queued', 'answering', 'answered', 'failed'))
    OR (author_id IS NULL AND status IS NULL)
  ),
  -- The agent's reply, and only it, answers a message.
  CONSTRAINT console_message_reply_is_agent CHECK ((author_id IS NULL) = (reply_to IS NOT NULL)),
  CONSTRAINT console_message_failure_when_failed CHECK (failure IS NULL OR status = 'failed'),
  CONSTRAINT console_message_failure_length CHECK (failure IS NULL OR char_length(failure) <= 1000)
);

-- One reply per message.
CREATE UNIQUE INDEX console_message_one_reply ON console_message (reply_to) WHERE reply_to IS NOT NULL;
-- What the computer takes: queued messages, oldest first (and an answering one left behind).
CREATE INDEX console_message_waiting ON console_message (created_at) WHERE status IN ('queued', 'answering');
-- An agent's conversation, newest first for paging.
CREATE INDEX console_message_conversation ON console_message (agent, created_at DESC, id DESC);
-- A person's messages this hour, for the ceiling.
CREATE INDEX console_message_author ON console_message (author_id, created_at) WHERE author_id IS NOT NULL;

COMMENT ON TABLE console_message IS
  'Messages between a console person and an agent (T-1722, D-350); answered by the maintainer''s computer, never by a model on the server.';

-- The ceiling (D-103's inventory): thirty messages an hour per console account.
-- Each message is an agent run on the maintainer's computer, which spends the
-- maintainer's subscription; two people chatting do not write thirty an hour.
-- Counted by the API from these rows (`console_message_author`), before the
-- insert, like `briefing`.
INSERT INTO rate_limit (action, per_hour) VALUES ('console_message', 30)
ON CONFLICT (action) DO NOTHING;

-- Down Migration

DELETE FROM rate_limit WHERE action = 'console_message';
DROP TABLE console_message;
