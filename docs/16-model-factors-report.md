# The model factors report (Phase 14, T-1661)

For the maintainer and the teammate who asked for the study (D-303). Written 2026-10-31 from the
lab runs recorded in D-329. The Persian version was sent to the maintainer the same day.

## The short answer

None of the factors the teammate proposed made the forecast reliably better by the bar we set
before running them (D-139: lower log loss with the 95% interval wholly below zero, calibration
not worse, worse in at most a third of the leagues, at least 300 matches). The one change that
did pass the development test, a better time decay for nine leagues, improved the numbers on the
held-out seasons as well (log loss 1.0070 against 1.0094, calibration error 0.0174 against
0.0249), but not by enough to clear the bar, and it made two of the five football-data leagues
worse. So it was not put in shadow, and **the published model does not change**. There is
nothing to promote; that decision stays the maintainer's.

## The five questions

### 1. What does each factor do to the percentages?

| Factor | Matches it applied to (development season) | Effect |
|---|---|---|
| Rest, and rest with the cups | all league matches | changed the percentages slightly; log loss worse by 0.0008 to 0.0010 |
| Team-specific home advantage | almost all | a tiny gain in the big leagues (-0.00018), worse in 6 of 17 leagues |
| Head to head | 91–94% | worse on our records (+0.0027) |
| New coach | 45% of our records' matches; none in the big leagues (no coach changes recorded there) | worse (+0.0026) |
| Motivation from the table's zones | 232 matches | too few to judge |
| Second leg | 289 matches | too few, and worse |
| Expected-goals form | 66% of football-data matches | better in the big leagues (-0.0032, significant), worse in 6 of 15 leagues |
| Regulars missing from the XI | 57% | worse (+0.0017 and +0.0049) |
| Rest with the next big match | 66% and 100% | worse, significantly on our records (+0.0062) |
| The draw recalibrated | all big-league matches | no effect (-0.0001): the draws were already calibrated |
| Late-season stakes | 21% (the last eight rounds) | worse (+0.0050) |
| Cross-league options (10 variants) | 3,952 European and cup matches | none better than the fit as it is |
| Time decay per league (9 leagues) | all matches of those leagues | on the held-out seasons, the largest probability of a match moved 5.1 points on average; 39% of matches moved more than 5 points, the most 33 points |
| Coach quality | — | its run had not finished; recorded when it does |

### 2. Accuracy, Brier, log loss, calibration

The candidate with the nine leagues' time decay, against the current version, on the same
3,819 held-out matches (2025-07-01 to 2026-10-31):

| | Log loss | Brier | RPS | Accuracy | Calibration error | Highest draw forecast |
|---|---|---|---|---|---|---|
| Current (0.7.0, same as the published 0.6.0 on these leagues) | 1.0094 | 0.6042 | 0.2069 | 50.3% | 0.0249 | 59.5% |
| Candidate 0.8.0 | 1.0070 | 0.6023 | 0.2064 | 50.2% | 0.0174 | 45.7% |
| One third each (uniform) | 1.0986 | 0.6667 | 0.2349 | 33.3% | 0.0703 | 33.3% |

The intervals: football-data leagues -0.00130 [-0.00673, +0.00468]; our records -0.00468
[-0.01215, +0.00262]. Both include zero, so the gain may be chance. Per league: better in
Greece, MLS, Brazil, Croatia, Saudi Arabia and the UAE; worse in the Championship, Switzerland
and Serbia. Each factor's own interval is in D-329's table.

### 3. Which factors help?

On the data we hold, none of the twelve. The time decay per league helped in development and on
average on the held-out seasons, but did not pass. Expected-goals form is the only factor with a
significant gain somewhere (the big leagues); limited to the leagues where expected goals are
recorded for nearly every match, it would be a new formulation for a new development run.

### 4. How was each weight set?

Never by hand. Each factor's formula and constants (half-lives, shrinkage, caps) were written in
a decision before its run (D-307 to D-313). Its coefficients were fitted by maximum likelihood on
the matches before each fit date, refitted weekly as the season went on: the same walk-forward
the published model uses, so no forecast saw its own result. The time decay and ridge per league
were chosen from a grid on 2023/24 and kept only where they also won on 2024/25; the held-out
seasons were used once, at the end.

### 5. Matches better and worse

The ten matches the candidate forecast best and worst relative to the current version, on the
held-out seasons (probabilities home/draw/away; the change in log loss, negative is better):

**Better**

| League | Date | Match | Score | Current | Candidate | Change |
|---|---|---|---|---|---|---|
| E1 | 2025-08-23 | Charlton v Leicester | 0–1 | 27/60/13 | 30/30/40 | -1.085 |
| BR1 | 2025-10-25 | Fortaleza v Flamengo | 1–0 | 13/20/67 | 31/26/43 | -0.858 |
| E1 | 2026-08-22 | West Ham v Charlton | 1–2 | 78/12/9 | 57/25/19 | -0.698 |
| E1 | 2026-08-16 | Watford v Southampton | 2–1 | 16/22/63 | 30/24/46 | -0.645 |
| BR1 | 2025-11-08 | Vasco v Juventude | 1–3 | 76/14/10 | 60/21/19 | -0.622 |
| E1 | 2025-10-31 | Wrexham v Coventry | 3–2 | 20/19/62 | 36/24/40 | -0.614 |
| E1 | 2026-09-02 | Millwall v Wrexham | 0–3 | 60/25/15 | 45/27/28 | -0.613 |
| SA1 | 2025-09-18 | NEOM v Al Okhdood | 1–0 | 27/51/21 | 50/27/23 | -0.605 |
| SA1 | 2025-09-14 | Dhamk v NEOM | 1–2 | 22/59/19 | 35/31/34 | -0.591 |
| E1 | 2025-11-22 | Leicester v Stoke | 2–1 | 35/31/34 | 62/23/16 | -0.559 |

**Worse**

| League | Date | Match | Score | Current | Candidate | Change |
|---|---|---|---|---|---|---|
| E1 | 2026-09-05 | Burnley v Bristol City | 1–2 | 35/26/39 | 60/26/14 | +1.010 |
| E1 | 2026-09-12 | Swansea v Burnley | 3–1 | 54/27/19 | 23/31/46 | +0.860 |
| E1 | 2026-10-16 | Burnley v Wolves | 1–2 | 37/23/41 | 58/24/18 | +0.789 |
| E1 | 2026-08-29 | Norwich v Burnley | 4–1 | 43/26/31 | 21/29/50 | +0.705 |
| BR1 | 2026-03-18 | Mirassol v Coritiba | 0–1 | 54/25/21 | 73/16/11 | +0.646 |
| E1 | 2025-11-01 | Southampton v Preston | 0–2 | 36/26/38 | 57/22/22 | +0.567 |
| SA1 | 2026-08-26 | Al Diriyah v Al Kholood | 1–1 | 25/55/21 | 45/31/23 | +0.565 |
| BR1 | 2025-10-16 | Fortaleza v Vasco | 0–2 | 36/22/41 | 51/24/24 | +0.532 |
| RS1 | 2025-11-30 | TSC v Radnik Surdulica | 0–2 | 39/27/34 | 56/24/20 | +0.515 |
| E1 | 2025-12-26 | Leicester v Watford | 1–2 | 46/24/29 | 60/21/18 | +0.479 |

What they show:
- **The current version sometimes gives an extreme draw early in a season** (60% for Charlton v
  Leicester, 51–59% for NEOM's matches), when a club has few matches in the league's recent
  history. The candidate never went above 46%. That is most of its gain.
- **The candidate's long memory** (the Championship's half-life rose to about 3.8 years)
  **kept Burnley strong** after their return to the Championship in 2026/27, from their strong
  Championship seasons of 2022/23 and 2024/25, and four of its five worst matches are Burnley's. It is the reason the
  Championship got worse.

## The teammate's twelve examples, forecast again

Stuttgart v Atlético, Como v Manchester United, Bayern v Arsenal, Beşiktaş v Crystal Palace,
Málaga v Espanyol, Napoli v Roma, Jablonec v Brighton, Stuttgart v Gladbach, Getafe v Lugano,
Sporting v LASK, Fenerbahçe v Slavia Prague, Nordsjælland v CSKA.

**Their forecasts do not change.** None of the twelve is in the nine leagues the candidate tuned,
and no factor passed. The European, cup and friendly matches among them are forecast by the
cross-league fit, which none of its ten variants improved; Napoli v Roma (Serie A) and Stuttgart v
Gladbach (Bundesliga) by their leagues' fits, whose constants stay. The questions they raised
were answered by the factors above: rotation (Stuttgart's six changes before Gladbach) by the
regulars-missing index, the cross-league confidence (Sporting at 92% against LASK) by the
cross-league variants, and the draw by the draw recalibration. Each was tested and none passed.

## What next (the maintainer's choice)

1. **Keep the model as it is** (recommended): nothing passed; the live record of the published
   version stands (Brier 0.573, log loss 0.967 on its first 500 pre-kick-off forecasts).
2. **Expected-goals form, limited to the leagues with full xG coverage:** a new formulation,
   written before a new development run, and a fresh holdout.
3. **The time decay again, with a guard on long memory for promoted and relegated clubs:** the
   Burnley pattern above; a new development run and a fresh holdout season.

Coach quality's verdict is added to D-329 when its run ends.
