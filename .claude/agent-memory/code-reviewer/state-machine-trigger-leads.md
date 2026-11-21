---
name: state-machine-trigger-leads
description: Leads for reviewing DB state-machine triggers and CHECKs that mirror pure rules (found on PR #893, social posts)
metadata:
  type: project
---

Questions that found real holes in a "the database, not the code, keeps it" migration (PR #893, T-1834, D-427):

- A transition check guarded by `IF NEW.state <> OLD.state` lets a same-state write through: a second racing claim
  (`publishing -> publishing`) re-takes the row with a new slot. Ask what an equal-state UPDATE may change.
- An actor check on `NEW.<actor_col>` passes when the column is merely left as the previous person's value; require the
  change's own timestamp/reason to change too.
- A row CHECK that encodes an entry condition (e.g. "automatic needs a run of 14") contradicts a pure rule that later
  lowers the counter without lowering the level; test every pure-rule event against the CHECK in the DB.
- After a safety lowering, ask whether rows already approved by the job can still go out (a missing way back to a person).
- Columns not in the frozen list (approver, slot, day) stay rewritable after a final state.
- Verdict/result payloads: which score kind (full_time vs current, D-317) the evaluation used.

**Why:** the builder's own scratch-DB checks covered the obvious refusals, not these. **How to apply:** run the
rolled-back transaction recipe in [[review-toolbox]] with one SAVEPOINT per case.
