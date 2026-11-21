---
name: weekly-check-baselines
description: Normal values for the weekly server/site check (ports, SSH, failed logins, headers stage under D-332) and false alarms already ruled out
metadata:
  type: project
---

Baselines (as of 2026-11-02):
- Failed SSH logins per 24 h: 1037 (2026-10-31), 1419 (2026-11-02). Noise while passwordauthentication is no; only a success from an unknown address matters.
- Listening: 22/80/443 on 0.0.0.0 and [::]; 5432 and 6379 on 127.0.0.1; 127.0.0.53/54:53 is systemd-resolved (normal, not public).
- Last reboot 2026-11-01 04:07 (kernel 6.8.0-147). unattended-upgrades never reboots, so reboot-required comes back after each kernel update; threshold 7 days.
- Origin lock check from the server returns 000; it counts as "locked" only when /en is 200 in the same run.

Headers follow D-332 in stages (T-1685): HSTS max-age=86400 first, then six months after a clean week (due about 2026-11-08), CSP report-only until a clean week, then nonces.
**Why:** the maintainer chose "step by step" (D-332).
**How to apply:** `server-hardening.sh` prints "MISSING: content-security-policy" while only the report-only header is present. That is a known false alarm (sec-2026-11-02-04), not a finding. Check the HSTS max-age each week.

Decided, do not re-raise:
- D-330: the guard hook is a seatbelt, not a sandbox, by design (details in the maintainer-only reports, not here).

This memory is published to the agents console (both people read it): never write a bypass method, an open weakness or an exploit step here (sec-2026-11-19-05).
Console review 2026-11-19: findings sec-2026-11-19-01..12; English copy in E:/FMIP/ops/reports/console-review-2026-11-19/ (not an agent folder, so the publisher does not publish it). Re-check those ids next month before re-raising. Verification pass 2026-11-19 on PRs #944-#950 added -13..-15 and restricted-key-plan.md in the same folder; re-check after deploy (curl -I the dotted console path, pnpm audit, live headers).
- Status words: the publisher shows new, open, decide and fixed-unverified as open (detail withheld); only resolved and accepted count as closed, so never write those for a sec finding before a re-check.
- POST /console/session is exempt from rate limits by inventory.ts (line ~321); raised once as sec-2026-11-02-02 (decide), wait for the maintainer.

PR reviews: several security runs share a day's findings file, so grep it for used `sec-<date>-NN` ids before numbering (2026-11-13: -05 was taken twice). Unit specs run from the worktree with `npx vitest run <files>` in apps/api, apps/web, packages/console-publisher; the *.http.spec files need Docker (usually off, so list them as not checked).

Guard re-check method: a scratch runner feeding {tool_name, tool_input} JSON to .claude/hooks/guard.mjs on stdin (like .claude/hooks/test-guard.mjs). Never put guard-trigger strings (env file path, dropdb, docker inspect, core.hooksPath) in a Bash command or a findings heredoc; write them with Write to a scratch file. Heredocs that contain apostrophes also fail in this Bash wrapper, and so does a heredoc followed by a single-quoted command in the same call: write the findings with Write to a scratchpad .jsonl, validate with node, then cat >> the day's file.
