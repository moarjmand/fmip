---
name: design-canvas-workflow
description: How the Design canvas artifact was built for the 2026-11-05 package 1 boards (shared CSS upload, crests, no-verify limits), reusable for later mockup runs
metadata:
  type: reference
---

- Design canvas = Artifact type created with `quickstart` intent design, then `publish` with `type_url`. Files live under `project/` (canvas.json + one `.dc.html` per board). Canvas URL for package 1: https://claude.ai/artifact/DtVZYPQU35fkTRVjD78E9Y.
- A shared stylesheet works as an uploaded asset: publish the css with `asset: true`, then `<link rel="stylesheet" href="/_blob/<id>">` after the support.js line in every board (a changed css is a new upload; all boards must be repointed). Package 1's tokens/components css was written by hand from `apps/web/src/app/tokens.css` (Day = default, `.night` class for Night).
- Crests: only reachable via the built-in browser (Bash has no egress). Fetch in `javascript_tool`, base64 out, write the text, `base64 -d` to .webp, upload as assets. About 4 KB each; costs a few thousand tokens of copying, so do it only for the two or three crests a board really needs.
- Board data loops: `sc-for` with data built in `renderVals()` keeps the theme x language matrices short; nested loops work in markup but were not render-checked.
- A private canvas cannot be opened by the browser pane without signing in (forbidden), so boards could not be visually verified in the 2026-11-05 run. Ask the maintainer to eyeball once.
- Welcome flow already has a skippable Territory step (Language, Territory, Time zone, Favourite teams) and keeps guest answers in the browser: precedent for "remembered" guest choices and for moving the register country there.
- Package 2 canvas (2026-11-06): https://claude.ai/artifact/Tu7xTPDw8i7ud8W1BgkKPZ ("Stadiomind Match Page Structure"). Reuse assets of an older canvas with `publish asset:true from_url asset_ids:[...]` (server copy, new ids; css + crests need no retyping). Extra css in a second file p2.css.
- Crests cheaply: in the browser pane draw to a 48px canvas, toBlob webp q0.5 (about 2 KB, ICC included), base64 out, retype via Write (not a bash heredoc: a long heredoc failed to parse), `base64 -d`, compare sha256 prefix computed in the browser. Costs about 3k chars per crest.
- Style attribute holes (`style="top:{{x}}"`) are risky; use sc-if variants or classes. Use `<helmet><style>` for one-off widths.
- Live-site facts (verified 2026-11-06): phone match page tabs are real CSS panels via :target/:has with a marked current tab; nav lives inside `<header>` (so a sticky tab row needs to move out); pick bar shipped as one "Pick" button, not three outcomes; Lite mode (cookie fmip_slow=1) gives fallback fonts, browser pane defaults to dark; pane innerWidth is 0 until resize_window is called.
- Blueprint 18.1 literally says "after verification, the member submits": option B (nothing saved until e-mail confirmed) is the literal reading; option A (saved, counts once confirmed) goes beyond it.
