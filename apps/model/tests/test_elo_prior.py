"""The Elo-prior backtest (T-922): same matches, same fit dates, and an honest 'not run'."""

from dataclasses import replace
from datetime import date, timedelta

import numpy as np

from fmip_model.backtest.elo_prior import pooled, run_division
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.model.version import BASELINE

TEAMS = ["A", "B", "C", "D", "E", "F"]
STRENGTH = {t: 0.6 - i * 0.24 for i, t in enumerate(TEAMS)}


def season(start: date, seed: int) -> list[BacktestMatch]:
    rng = np.random.default_rng(seed)
    out: list[BacktestMatch] = []
    day = start
    for home in TEAMS:
        for away in TEAMS:
            if home == away:
                continue
            lam = float(np.exp(STRENGTH[home] / 2 - STRENGTH[away] / 2 + 0.25))
            mu = float(np.exp(STRENGTH[away] / 2 - STRENGTH[home] / 2))
            out.append(BacktestMatch(day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu))))
            day += timedelta(days=3)
    return out


def test_variants_are_scored_on_the_same_matches_and_a_missing_source_is_not_run() -> None:
    matches = season(date(2024, 8, 1), 1) + season(date(2025, 8, 1), 2)
    version = replace(BASELINE, version="0.5.0", elo_prior="own", per_division={})
    truth = {t: 1500 + 400 * STRENGTH[t] for t in TEAMS}
    row = run_division(
        "T9",
        version,
        matches,
        (date(2025, 8, 1), date(2025, 12, 31)),
        {"none": None, "clubelo": lambda _day: None, "own": lambda _day: truth},
        min_history=20,
    )
    scores = {s.variant: s for s in row.scores}
    assert row.matches > 0
    assert scores["clubelo"].ran is False and scores["clubelo"].log_loss is None
    assert scores["none"].ran and scores["own"].ran
    assert scores["none"].fits_with_prior == 0 and scores["own"].fits_with_prior > 0
    # A prior that knows the true strengths is no worse than none on the same matches.
    assert scores["own"].log_loss is not None and scores["none"].log_loss is not None
    assert scores["own"].log_loss <= scores["none"].log_loss + 1e-9

    summary = pooled([row])
    assert summary["clubelo"] is None
    assert summary["own"] == round(scores["own"].log_loss, 4)
