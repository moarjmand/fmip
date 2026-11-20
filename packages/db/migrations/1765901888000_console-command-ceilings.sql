-- Up Migration
-- Ceilings on the agents console's commands (T-1880; D-103's inventory).
--
-- `POST /console/commands` was exempt as "one of the console's two people".
-- Each command is work on the maintainer's computer, and `agent.run` starts an
-- agent there at once, which spends the maintainer's subscription: a stuck
-- page, a script or a taken-over account could queue any number.
--
-- Two ceilings per console account, counted by the API from the account's own
-- `console_command` rows in the clock hour, before the insert, like
-- `console_message`:
--   console_command      every command (pause, resume, run, model, schedule,
--                        decision answer). Forty an hour: the sixteen agents
--                        paused and resumed once, and the open decisions
--                        answered, fit; a loop does not.
--   console_command_run  `agent.run` alone, also counted in the first. Ten an
--                        hour: a person starting a few agents by hand, not
--                        the whole team over and over.
-- The numbers are rows an administrator changes with an UPDATE; a missing row
-- means "not limited".
INSERT INTO rate_limit (action, per_hour) VALUES
  ('console_command', 40),
  ('console_command_run', 10)
ON CONFLICT (action) DO NOTHING;

-- Down Migration

DELETE FROM rate_limit WHERE action IN ('console_command', 'console_command_run');
