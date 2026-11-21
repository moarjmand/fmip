-- Up Migration

-- T-1907 (D-456 point 2): a console person's triage of a finding is a command
-- for the maintainer's computer like the others, so `console_command.kind`
-- takes three more words:
--   finding.accept   the finding becomes `planned` and a task row is asked for
--   finding.reject   `rejected`, with the reason in the payload
--   finding.snooze   `snoozed` until the day in the payload
-- The target is the finding's id as the loaded snapshot has it. They count in
-- the `console_command` ceiling (T-1880); no new `rate_limit` row.
ALTER TABLE console_command DROP CONSTRAINT console_command_kind;
ALTER TABLE console_command ADD CONSTRAINT console_command_kind CHECK (
  kind IN ('agent.pause', 'agent.resume', 'agent.run', 'agent.model', 'agent.schedule', 'decision.answer',
           'finding.accept', 'finding.reject', 'finding.snooze')
);

-- Down Migration

-- The queue's triage rows cannot stay under the older constraint; their audit
-- rows (`console_audit`, append-only) keep who asked what and why.
DELETE FROM console_command WHERE kind IN ('finding.accept', 'finding.reject', 'finding.snooze');
ALTER TABLE console_command DROP CONSTRAINT console_command_kind;
ALTER TABLE console_command ADD CONSTRAINT console_command_kind CHECK (
  kind IN ('agent.pause', 'agent.resume', 'agent.run', 'agent.model', 'agent.schedule', 'decision.answer')
);
