# Input `team_home_advantage_penalty_100` against dixon-coles-elo@0.5.0, 2023-07-01 to 2024-06-30

Home advantage by team: each club's deviation from its division's, penalised by 100 x delta^2 and fitted with the strengths; a club with fewer than 19 home matches in 730 days stays at the division's value (T-1141, D-149).

choosing window, laptop fmip_t114x

**Verdict: failed** (D-139). Published version for reference: dixon-coles-elo@0.1.0.

Fits with an Elo prior, published and candidate (a published version with none had no Club Elo rating cached): E0 0 and 35 of 35; SP1 0 and 36 of 36; D1 0 and 33 of 33; I1 0 and 38 of 38; F1 0 and 33 of 33; N1 0 and 33 of 33; P1 0 and 36 of 36; T1 0 and 35 of 35; B1 0 and 38 of 38; SC0 0 and 32 of 32.

Scored on the matches where the input could be read; lower is better.

| Group | Verdict | Scored | Applied | Log loss published | candidate | with input | Difference [interval] | Brier candidate / with input | Calibration candidate / with input |
|---|---|---|---|---|---|---|---|---|---|
| football_data | failed | 3271 | 3271 (100%) | 0.9826 | 0.9728 | 0.9730 | +0.00016 [-0.00004, +0.00038] | 0.5779 / 0.5780 | 0.0220 / 0.0216 |
| our_records | not run | 0 | 0 | | | | | | |

- football_data: log loss difference +0.00016, 95% interval [-0.00004, +0.00038] does not exclude zero on the better side

- football_data: worse in 6 of 10 divisions judged (E0, SP1, D1, I1, B1, SC0), more than 33%

- our_records: no division of this group was run

| Division | Group | Scored | Applied | Log loss candidate | with input | Judged | Worse |
|---|---|---|---|---|---|---|---|
| E0 | football_data | 378 | 378 | 0.9300 | 0.9303 | yes | yes |
| SP1 | football_data | 379 | 379 | 0.9645 | 0.9645 | yes | yes |
| D1 | football_data | 304 | 304 | 0.9861 | 0.9867 | yes | yes |
| I1 | football_data | 379 | 379 | 0.9928 | 0.9932 | yes | yes |
| F1 | football_data | 305 | 305 | 1.0398 | 1.0396 | yes | no |
| N1 | football_data | 305 | 305 | 0.9183 | 0.9183 | yes | no |
| P1 | football_data | 304 | 304 | 0.9351 | 0.9350 | yes | no |
| T1 | football_data | 378 | 378 | 1.0053 | 1.0051 | yes | no |
| B1 | football_data | 311 | 311 | 0.9986 | 0.9991 | yes | yes |
| SC0 | football_data | 228 | 228 | 0.9514 | 0.9518 | yes | yes |
