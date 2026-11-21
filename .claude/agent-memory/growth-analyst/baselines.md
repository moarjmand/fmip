---
name: baselines
description: Growth baselines at 2026-11-16 and where schema pieces are
metadata:
  type: project
---

2026-11-16: 3 members, 1 staff, 1 deleted (dashboard users=5 is every account); 9 predictions from 1 member (last 2026-10-09); 1 follow; push 0.
Funnel 3 registered / 2 verified / 3 first run / 1 follow / 1 predicted / 1 returned. First sign-up in 6 weeks came week 2026-11-09 (unverified).
Channel 28d: forecast 27, results 25, weekly_accuracy 2.
signup_source_monthly has only the open month (2026-11), so closed-month queries are empty until December and
cells stay under 5. snapshot.json is a list of {"set": ...} objects (community set has users, predictions); read it with encoding utf-8.
No locale column on `session`; language only on user_account.preferred_language (cells under 5).
Forecast supply: `forecast` joins fixture -> season -> competition; rows include status unavailable and role shadow.
Ad-hoc SQL goes through data-audit/run.sh with a file in the scratchpad. Runner's "unterminated quoted string" heading glitch is harmless.
