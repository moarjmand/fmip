---
name: mail-log-leads
description: Where member mail can reach logs, and which processes run NODE_ENV=production (CI journeys do not), for reviews of identity/delivery logging
metadata:
  type: reference
---

- Since D-430 (PR #904, T-1846) `DeliveryMailer` prints a mail's text only when the e-mail channel is absent and
  NODE_ENV is not production; failures write one masked `[mail-not-sent]` line straight to stdout (not the JSON logger).
- NODE_ENV=production: `apps/api/Dockerfile`, `deploy/docker-compose.prod.yml`, `deploy/preview/Dockerfile`.
  NOT set in CI `e2e-journeys` (API started with `node dist/main.js`), so `[mail] to=` still reaches `api.log` there;
  `journeys/members.ts verifyLink` depends on it. A change that sets NODE_ENV in that job breaks the journeys.
- `delivery.service.ts` logs `error.stack` of a channel failure; nodemailer appends the SMTP server's reply to the
  message, which can echo the full recipient address (never the body). Raised as rev-2026-11-16-13.
- nodemailer in this repo ships only `dist/` (no `lib/`): grep `node_modules/.pnpm/nodemailer@*/node_modules/nodemailer/dist/cjs`.
- `git show <ref>:.github/...` is mangled by Git Bash path conversion: prefix `MSYS_NO_PATHCONV=1`.
