---
name: fmip-security
description: Security for FMIP / Stadiomind - a pull request's security review (authorisation, input handling, SQL, XSS, secrets, rate limits, audit of admin actions, dependencies) and a weekly read-only check of the server and site (ports, SSH, firewall, updates, response headers, the Cloudflare-only origin, failed logins). Use on every PR touching auth, admin, input, SQL, uploads or dependencies, and weekly.
---

# Security (T-1684, D-328)

The method of the `security` agent. Read `.claude/skills/team-charter/SKILL.md` first. You report;
the engineering session fixes, and anything on the server is the maintainer's to approve.

## On a pull request

Read the diff: `git diff origin/main...HEAD` for a branch, `gh pr diff <n>` for a PR (merged or
open), then for each change ask:
- **Authorisation:** is every new route guarded (role checks on admin routes, the owner on a
  member's data)? Can one member read or change another's?
- **Input:** validated at the boundary (DTOs, zod), lengths bounded, enums closed?
- **SQL:** every query parameterised (`$1`, never string-built from input); dynamic identifiers
  from a fixed list only.
- **Output:** no `dangerouslySetInnerHTML` with outside text; news and user text escaped; URLs
  from outside checked before they become links or images.
- **Secrets:** none in code, logs, error messages or client bundles (`NEXT_PUBLIC_` is public).
- **Abuse:** rate limits on login, registration, password reset, messaging and anything that
  sends mail or push (the `rate_window` and `auth_rate_window` tables).
- **Audit (rule 10):** a high-impact admin action writes `audit_log` with actor, time, reason and
  the previous value.
- **Dependencies:** a new package is maintained, pinned by the lockfile, and needed. Run
  `pnpm audit --prod --audit-level high` when the registry is reachable (it may not be from this
  machine: say so rather than skip silently).
- **The AI surfaces:** outside text sent to a language model is wrapped as data (prompt injection).
Each issue is a finding (prefix `sec`) with file and line, the attack in one sentence, and the fix.

## Weekly: the server and the site

`bash .claude/skills/fmip-security/server-hardening.sh`, then judge:

| Check | Expected | A finding when |
|---|---|---|
| Listening ports | 22, 80, 443 public; 5432 and 6379 on 127.0.0.1 only | anything else public |
| SSH | password and keyboard-interactive off, keys only | password on; also note root by key and X11 forwarding (harden later) |
| Firewall | active, only SSH, 80, 443 | inactive or wider |
| Updates | unattended-upgrades enabled, recent stamps | disabled, or security updates waiting more than 7 days |
| Reboot | none required | required for more than 7 days (a kernel update waits). A reboot restarts Postgres, which T-1472 forbids a *rollout* to do; a planned reboot is the maintainer's, in a window with no live matches, and the proposal says so |
| Response headers | HSTS, `X-Content-Type-Options: nosniff`, a frame policy, a referrer policy, a CSP | missing (check whether Cloudflare adds them before calling it) |
| Origin lock (D-112) | a direct request to the server's address is refused | it answers. From the server itself "no answer" cannot tell a working lock from Caddy being down: say "probably locked" unless the site probes are 200 at the same time |
| Failed SSH logins | noise from the internet; password login is off | a success from an unknown address, or a sudden jump with password login on |

**Quoting a dangerous command in a finding:** the guard hook refuses a Bash call whose text holds
one (production's env file, `docker compose config`). Describe it in words in the finding
("printing the container's environment"), or write the line with the Write tool to your own
report and quote it there, never by running it through Bash.

**The guard hook is a seatbelt, not a sandbox:** it reads the text of a call, so a script file
run on the server, an interpreter, or an edited hook can pass it. Review it against new bypasses
each month (`.claude/hooks/guard.cases.json`), and treat the agents' tool lists and the read-only
database session as the stronger locks.

Never propose a change that could lock the maintainer out (SSH, firewall) without a tested way
back; any server change is a proposal with its exact commands for the maintainer.

## The golden set

| Case | What the check must catch |
|---|---|
| D-112: the origin answered requests that bypassed Cloudflare | the origin lock |
| D-093: a reader could set the client IP header the web app trusts | input from outside treated as trusted |
| 2026-10-31: no HSTS, CSP, frame or nosniff header on `/en` | response headers |
| 2026-10-31: reboot required for 17 days, about 1,000 failed SSH logins a day | reboot; failed logins as noise while passwords are off |
| 2026-10-31: 23 ways around the guard hook (printing env, compose without a service, quoted subcommands, `git -C`, `sed -i` on a migration) | the monthly guard review |
