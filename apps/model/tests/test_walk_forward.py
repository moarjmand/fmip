"""Walk-forward evaluation on simulated seasons: no leaks, sensible scores, a report."""

import json
import math
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import numpy as np
import pytest

from fmip_model.backtest.report import as_json, render_markdown, write_report
from fmip_model.backtest.walk_forward import BacktestMatch, walk_forward
from fmip_model.model.version import BASELINE

TEAMS = ["Strong", "Good", "Mid", "Weak", "Poor", "Worst"]
ATTACK = {t: 0.5 - i * 0.2 for i, t in enumerate(TEAMS)}
DEFENCE = {t: -0.4 + i * 0.16 for i, t in enumerate(TEAMS)}
HOME = 0.25


def simulate(seasons: int, seed: int = 11, with_odds: bool = True) -> list[BacktestMatch]:
    rng = np.random.default_rng(seed)
    out: list[BacktestMatch] = []
    day = date(2022, 8, 1)
    for _ in range(seasons):
        for home in TEAMS:
            for away in TEAMS:
                if home == away:
                    continue
                lam = float(np.exp(ATTACK[home] + DEFENCE[away] + HOME))
                mu = float(np.exp(ATTACK[away] + DEFENCE[home]))
                hg, ag = int(rng.poisson(lam)), int(rng.poisson(mu))
                # "Market" odds: the true expected-goal ratio, roughly, with a 5% margin.
                ratio = lam / mu
                ph, pd_, pa = ratio / (ratio + 1.35), 0.26, 1 / (ratio + 1.35)
                s = (ph + pd_ + pa) * 1.05
                odds = (
                    (
                        Decimal(str(round(s / ph, 3))),
                        Decimal(str(round(s / pd_, 3))),
                        Decimal(str(round(s / pa, 3))),
                    )
                    if with_odds
                    else (None, None, None)
                )
                out.append(BacktestMatch(day, home, away, hg, ag, *odds))
                day += timedelta(days=2)
    return out


def test_walk_forward_never_sees_the_future_and_beats_uniform() -> None:
    matches = simulate(seasons=6)
    start = matches[len(matches) // 2].date

    result = walk_forward(
        matches, window_start=start, window_end=matches[-1].date, scope="sim", refit_every_days=14
    )

    assert all(f.fit_date < f.match.date for f in result.forecasts)
    assert result.refits >= 3
    assert result.model.log_loss < result.uniform.log_loss
    assert result.model.brier < result.uniform.brier
    assert result.market is not None and result.market.n == len(result.forecasts)
    assert math.isclose(result.uniform.log_loss, math.log(3))


def test_skips_matches_without_enough_history() -> None:
    matches = simulate(seasons=2)
    with pytest.raises(ValueError, match="enough history"):
        walk_forward(
            matches,
            window_start=matches[0].date,
            window_end=matches[3].date,
            scope="x",
            min_history=500,
        )


def test_market_is_optional() -> None:
    matches = simulate(seasons=4, with_odds=False)
    result = walk_forward(
        matches, window_start=matches[60].date, window_end=matches[-1].date, scope="no-odds"
    )
    assert result.market is None
    assert result.matches_with_odds == 0


def test_report_is_written_per_model_version(tmp_path: Path) -> None:
    matches = simulate(seasons=5)
    result = walk_forward(
        matches, window_start=matches[80].date, window_end=matches[-1].date, scope="E9 sim/season"
    )

    md, js = write_report(result, tmp_path)

    assert md.parent.name == "dixon-coles-elo-0.1.0"
    assert md.name == "E9_sim-season.md"
    text = md.read_text(encoding="utf-8")
    assert text.startswith(f"# Backtest — {BASELINE.id} — E9 sim/season")
    assert "| Model |" in text and "| Market" in text and "| Uniform 1/3 |" in text
    assert "## Reliability — draw" in text

    payload = json.loads(js.read_text(encoding="utf-8"))
    assert payload["model_version"]["id"] == BASELINE.id
    assert payload["model"]["n"] == len(result.forecasts)
    assert payload["market"]["n"] == len(result.forecasts)
    assert set(payload["model"]["reliability"]) == {"home", "draw", "away"}

    # The renderers are pure given a timestamp.
    assert render_markdown(result, generated_at=None) != ""
    assert json.loads(as_json(result))["scope"] == "E9 sim/season"
