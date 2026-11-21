---
name: social-video-baseline
description: 2026-11-19 video/animation tools comparison for social posts - Remotion licence threshold, Buffer video API facts (no upload endpoint, isAiGenerated, no audio attach), Sora shutdown, which pages block reads
metadata:
  type: reference
---

Report: E:/FMIP/ops/reports/business-adviser/2026-11-19-video-tools-licensing-fa.md (EN copy in ops/reports/console-review-2026-11-19/video-tools-licensing.md). Findings biz-2026-11-19-01..04. Recommended Package 1 (Remotion self-hosted, Revideo MIT fallback); maintainer's choice pending.

Facts worth not re-researching (read 2026-11-19):
- Remotion: Free License up to 3 people incl. automation; contractors on the project count toward 4; AI agents don't. Above: Automators $0.01/render, min $100/month. Remotion AG, Swiss law, no sanctions clause (terms v5.0). Docs at remotion.dev/docs/license/pricing.md and faq.md.
- rlottie archived. Revideo team moved to Midrender (open repo lags).
- OpenAI Videos API / sora-2 shut down 2026-09-24 (developers.openai.com/api/docs/deprecations).
- Buffer API: no upload endpoint (media by stable public URL); `isAiGenerated` on Instagram and Twitter metadata; video cover only `metadata.thumbnailOffset`; Meta audio searchable (searchInstagramAudio) but no audio field on post input. Full schema: developers.buffer.com/reference.md (curl works).
- Shotstack terms 2026-10-06: output vests in customer, no sanctions clause, bans gambling content. Creatomate: US-embargo location warranty.
- ai.google.dev pages (pricing, regions, Veo docs) and elevenlabs.io/pricing 403 from this PC; placid.app refuses connection. Use WebSearch snippets.

Related: [[social-publishing-baseline]], [[project-jurisdiction]].
