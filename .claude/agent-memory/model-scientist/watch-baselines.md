---
name: watch-baselines
description: Model-watch baselines as of 2026-11-16 (match-counted) - 0.7.0 published since 2026-11-13 (D-410), 0.6.0 closing figures, drift date ~12-21/12-28, failing calibration bands, SQL quirks after a promotion
metadata:
  type: project
---

Baselines at the 2026-11-16 watch. Every figure counts MATCHES (T-1772, D-380).

**Versions**
- 0.7.0 is PUBLISHED since 2026-11-13 (D-410, the maintainer). On 11-16 it had n=3 published matches.
- 0.6.0 is retired. Its closing record: n=864, LL 0.9524 [0.922, 0.983], acc 57.8.
- 0.7.0's pre-promotion shadow record: n=673, LL 0.9487.
- No candidate is in shadow. The next candidate's count starts at zero.
- The 2026-11-09 D-336 looks (both met) are history. The ledger entry `version_0_7_0_shadow` is now `adopted` (decided_on 2026-11-13), with the recorded figures. Never re-look at them.

**Drift (current published version)**
- 0.7.0 published restarts the count at 11-13.
- About 266 matches were forecast for the week of 11-16. The record reaches 300 around 11-23..11-26.
- First judgeable around the 2026-12-21 or 12-28 watch.

**Calibration** (mod-2026-10-31-03): the same 2 bands fail on 0.7.0's whole pre-KO record.
- away 40-50%: said 44.4, seen 60.4, n=101
- draw 20-30%: said 25.0, seen 20.2, n=485
- Lead: home 50-60% has said 54.6, seen 69.1 at n=97. Judge it at 100.

**Competitions**: counts restart under 0.7.0 published.
- 0.6.0 closed with FA Cup at n=51, acc 39.2, LL 1.067, and Eredivisie at n=44, LL 1.099.
- 0.7.0 differs from 0.6.0 in cups only.

**SQL quirks after a promotion** (mod-2026-11-16-01, proposed fix)
- The paired and coverage blocks compare the published version with its own old shadow rows.
- The extreme-draw block mixes 0.1.0 and 0.5.0 rows.
- The competition and calibration blocks are empty until the published record grows. Use a drill over all roles of the current version, labelled as such.

**Why:** the next watch compares against these figures and keeps the finding ids open: mod-2026-10-31-03/04/06, mod-2026-11-09-02, mod-2026-11-16-01, mod-2026-11-06-03, mod-2026-11-03-90.

**How to apply:**
- For a verdict, fix the method before computing. Use D-139's paired percentile bootstrap: 2,000 resamples of matches, numpy default_rng(1101), multinomial weights. Run plain python, since `python -I` hides numpy.
- Editing the ledger:
  - Python's json.dumps rewrites small floats such as 0.00001 as 1e-05 across the whole file. Splice only the changed entry into the original text and check that the diff touches nothing else.
  - `matches_total` must be >= `matches`.
  - A running entry carries no figures.
- The scratchpad root holds a stray `inspect.py` that breaks `import numpy`. Run scripts from a subfolder, e.g. `scratchpad/recal/`.
- A psql `\echo` containing an apostrophe breaks the file ("unterminated quoted string").
- A heredoc with apostrophes fails in this Bash. Stage findings in the scratchpad with a python script, then `cat >>` them.
