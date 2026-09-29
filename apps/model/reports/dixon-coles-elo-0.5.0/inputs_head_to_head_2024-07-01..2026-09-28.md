# Input `head_to_head` against dixon-coles-elo@0.5.0, 2024-07-01 to 2026-09-28

Head-to-head after current strength: the residual goal difference of past meetings against the fitted model, half-life 730 days, shrunk by 2 zero meetings, one fitted coefficient (T-1140, D-148).

Laptop, private store fmip_t114x: football-data.co.uk 2012/13 to 2026/27 (to 2026-09-20), ten divisions, no Club Elo rows and no our-records division (D-016: training only). One process per division through the harness's own run_division and judge.

**Verdict: failed** (D-139). Published version for reference: dixon-coles-elo@0.1.0.

Fits with an Elo prior, published and candidate (a published version with none had no Club Elo rating cached): E0 0 and 72 of 72; SP1 0 and 77 of 77; D1 0 and 70 of 70; I1 0 and 78 of 78; F1 0 and 72 of 72; N1 0 and 76 of 76; P1 0 and 77 of 77; T1 0 and 77 of 77; B1 0 and 83 of 83; SC0 0 and 73 of 73.

Scored on the matches where the input could be read; lower is better.

| Group | Verdict | Scored | Applied | Log loss published | candidate | with input | Difference [interval] | Brier candidate / with input | Calibration candidate / with input |
|---|---|---|---|---|---|---|---|---|---|
| football_data | failed | 6946 | 6590 (95%) | 0.9960 | 0.9821 | 0.9826 | +0.00056 [-0.00011, +0.00121] | 0.5846 / 0.5851 | 0.0134 / 0.0139 |
| our_records | not run | 0 | 0 | | | | | | |

- football_data: log loss difference +0.00056, 95% interval [-0.00011, +0.00121] does not exclude zero on the better side

- football_data: worse in 8 of 10 divisions judged (SP1, D1, I1, F1, N1, P1, T1, SC0), more than 33%

- our_records: no division of this group was run

| Division | Group | Scored | Applied | Log loss candidate | with input | Judged | Worse |
|---|---|---|---|---|---|---|---|
| E0 | football_data | 806 | 775 | 1.0024 | 1.0019 | yes | no |
| SP1 | football_data | 823 | 798 | 0.9804 | 0.9804 | yes | yes |
| D1 | football_data | 643 | 605 | 0.9936 | 0.9943 | yes | yes |
| I1 | football_data | 806 | 759 | 0.9775 | 0.9786 | yes | yes |
| F1 | football_data | 654 | 628 | 0.9921 | 0.9925 | yes | yes |
| N1 | football_data | 671 | 647 | 0.9769 | 0.9800 | yes | yes |
| P1 | football_data | 670 | 626 | 0.9421 | 0.9428 | yes | yes |
| T1 | football_data | 695 | 628 | 0.9695 | 0.9707 | yes | yes |
| B1 | football_data | 681 | 638 | 1.0060 | 1.0039 | yes | no |
| SC0 | football_data | 497 | 486 | 0.9756 | 0.9770 | yes | yes |
