---
name: forecast-placeholder-versions
description: Forecast versions with probabilities null are real stored rows (model_unreachable etc.) and can be latest after an answered one - check every "no forecast" condition against that
metadata:
  type: project
---

A model outage during a recompute stores a *published* version with `probabilities: null`
(`apps/api/src/modules/forecast/forecast.service.ts`, reason `model_unreachable` / `contract_violation`),
so `latest` (or the card's pre-kick-off version) can be a placeholder while an earlier version answered.

**Why:** PR #854 (2026-11-06) keyed "No model forecast for this match" on the card version's `p === null`,
contradicting the earlier version's percentages listed below it (rule 3, finding rev-2026-11-06-01).

**How to apply:** in any web change touching the forecast card/panel, test "no forecast" against
`versions.some(v => v.probabilities !== null)`, not the shown version alone.
