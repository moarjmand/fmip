# Input `team_home_advantage` against dixon-coles-elo@0.5.0, 2024-07-01 to 2026-09-28

Home advantage by team: each club's deviation from its division's, penalised by 100 x delta^2 and fitted with the strengths; a club with fewer than 19 home matches in 730 days stays at the division's value (T-1141, D-149).

Laptop, private store fmip_t114x: football-data.co.uk 2012/13 to 2026/27 (to 2026-09-20), ten divisions, no Club Elo rows and no our-records division (D-016: training only). One process per division through the harness's own run_division and judge.

**Verdict: failed** (D-139). Published version for reference: dixon-coles-elo@0.1.0.

Fits with an Elo prior, published and candidate (a published version with none had no Club Elo rating cached): E0 0 and 72 of 72; SP1 0 and 77 of 77; D1 0 and 70 of 70; I1 0 and 78 of 78; F1 0 and 72 of 72; N1 0 and 76 of 76; P1 0 and 77 of 77; T1 0 and 77 of 77; B1 0 and 83 of 83; SC0 0 and 73 of 73.

Scored on the matches where the input could be read; lower is better.

| Group | Verdict | Scored | Applied | Log loss published | candidate | with input | Difference [interval] | Brier candidate / with input | Calibration candidate / with input |
|---|---|---|---|---|---|---|---|---|---|
| football_data | failed | 6946 | 6946 (100%) | 1.0040 | 0.9866 | 0.9866 | -0.00004 [-0.00019, +0.00012] | 0.5876 / 0.5875 | 0.0138 / 0.0140 |
| our_records | not run | 0 | 0 | | | | | | |

- football_data: log loss difference -0.00004, 95% interval [-0.00019, +0.00012] does not exclude zero on the better side

- our_records: no division of this group was run

| Division | Group | Scored | Applied | Log loss candidate | with input | Judged | Worse |
|---|---|---|---|---|---|---|---|
| E0 | football_data | 806 | 806 | 1.0062 | 1.0059 | yes | no |
| SP1 | football_data | 823 | 823 | 0.9760 | 0.9758 | yes | no |
| D1 | football_data | 643 | 643 | 0.9983 | 0.9981 | yes | no |
| I1 | football_data | 806 | 806 | 0.9818 | 0.9821 | yes | yes |
| F1 | football_data | 654 | 654 | 0.9957 | 0.9957 | yes | no |
| N1 | football_data | 671 | 671 | 0.9877 | 0.9876 | yes | no |
| P1 | football_data | 670 | 670 | 0.9450 | 0.9448 | yes | no |
| T1 | football_data | 695 | 695 | 0.9806 | 0.9807 | yes | yes |
| B1 | football_data | 681 | 681 | 1.0140 | 1.0143 | yes | yes |
| SC0 | football_data | 497 | 497 | 0.9788 | 0.9787 | yes | no |
