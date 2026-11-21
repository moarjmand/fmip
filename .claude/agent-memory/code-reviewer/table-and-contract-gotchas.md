---
name: table-and-contract-gotchas
description: standings.table() is league-stage only (group cups look tableless); old web throws on an unknown message key, so new enum members break the web during rollout
metadata:
  type: project
---

- `StandingsService.table(seasonId)` counts only `st.kind = 'league'` results (standings-store `leagueResults`):
  a cup with a group stage has an EMPTY table there; its tables are `groupTables`. Any "has a table" flag built on
  `table()` alone mislabels group cups (rev-2026-11-07-04, p5-competition-team `has_table`). Compare with the web's
  `hasTable` in `lib/competition-overview.ts`, which checks `group_tables`.
- The web's `message()`/`say()` throws (`textOf(undefined).other`) on a key that is not in the catalogue. When a contract
  adds an enum member that the web maps to a catalogue key (`ZONE_KEY[kind]`), the old web crashes against the new API
  during the window between `rollout.sh`'s api and web steps, and also on a web-only rollback (rev-2026-11-07-05).

**Why:** both came out of the 2026-11-07 package-5 review and are easy to miss when you read the diff alone.
**How to apply:** for any table/zone/coverage flag, ask what group stages and missing-data seasons return. For any new
contract enum member, ask what the previous web does with it.
