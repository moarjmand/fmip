---
name: model-watch
description: Watch the FMIP / Stadiomind forecast model's live record - each version's pre-kick-off log loss, Brier and accuracy, published against shadow on the same fixtures, drift over 28 days, by competition, calibration - and keep the lab's verdicts and the promotion readiness (D-082, D-139, D-140). Use weekly, monthly, or when a candidate, a lab run or a promotion is discussed.
---

# Model watch (T-1684, D-328)

The method of the `model-scientist` agent. Read `.claude/skills/team-charter/SKILL.md` first, then
`docs/15-model.md` (the model and its lifecycle) and the newest decisions on it (D-303, D-329).

## Weekly (Monday, or whenever asked)

1. `bash .claude/skills/data-audit/run.sh .claude/skills/model-watch/model-watch.sql`: versions,
   the paired comparison with its interval and the share of identical matches, the coverage a shadow
   version adds, the current published version's 28-day drift, its competitions with intervals, the
   calibration of all three outcomes, and extreme draws. The intervals are normal approximations,
   fine for a watch; a promotion verdict uses D-139's paired bootstrap through the lab's tooling.
2. Judge, and write findings (prefix `mod`) for:
   - **drift:** the current published version's last-28-day log loss above the previous 28 days'
     by 0.02 or more, with 300 matches or more in *each* window (an empty window: "not judgeable
     yet", with the date it becomes judgeable);
   - **a weak competition:** log loss above 1.06 on 50 matches or more (worse than a draw-heavy
     coin), or accuracy below 45%;
   - **calibration:** a band with 100 matches or more whose "seen" is more than 8 points from
     "said" (unrounded), or whose interval excludes "said";
   - **promotion readiness (D-140):** a shadow version with 300 or more paired pre-kick-off
     matches. Judge it by D-139's bar on the paired set; the verdict is a proposal to the
     maintainer, never a promotion.
3. Write `E:/FMIP/ops/reports/model-scientist/<date>.md` in Persian: the table of versions, the
   paired verdict, drift and calibration in one paragraph each, and what to watch next week.

Findings are written in English like the other agents' (the report is Persian). A finding that
stays true keeps its id week to week (`status: open`), with the new numbers in `evidence`.

## Monthly, and on demand

- The lab: what ran, what is running (`E:/FMIP/lab-local/local.log`, `~/fmip-lab/*.log` on the
  server), each verdict against D-139 recorded in a decision by the engineering session.
- A proposal for a new factor or formulation: written as a decision draft *before* any run
  (D-303: formulations are not tuned on the run that judges them), with its development window,
  the bar and what would make it fail.

## Rules of this role

- Never promote, publish, or edit a version file; never change the service's configuration.
- The three prediction products stay apart (rule 6): the model's record is never mixed with the
  founder's analysis or the community's consensus.
- Forecasts are immutable (rule 5): a "correction" is a new version, never an update.
- The holdout is used once per candidate (D-303); a second look at the same holdout to pick
  divisions or constants is refused, and said so.

## The golden set

| Situation | The watch must |
|---|---|
| 0.8.0 better on average on the holdout but intervals across zero and worse in E1, CH1 (D-329) | say "failed", not "promising, promote" |
| 0.7.0 in shadow with 211 paired matches, difference 0.0000 (2026-10-31) | say "not ready (300 needed), no difference yet" |
| Eredivisie 1.079, the Scottish Premiership 1.064 and the Premier League 1.055 on the current version's first weeks (2026-10-31) | flag them as weak, with their intervals and how few matches they rest on |
| 0.7.0's paired difference 0.0000 with 97% of matches identical (it is 0.6.0 plus eleven leagues) | say the paired test cannot separate them; its gain is coverage (31 fixtures the published version did not forecast) and its promotion needs the maintainer's rule |
| Draws said 25% in the 20–30% band, seen 18% on 1,152 matches; away said 44%, seen 62% in the 40–50% band | flag calibration, and note the live record contradicts T-1657's development verdict (D-329) |
| A draw forecast of 60% early in a season (D-329's examples) | flag extreme draws above 45% as a calibration lead |
