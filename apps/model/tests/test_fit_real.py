"""The model on real data from the training store (needs DATABASE_URL and a
loaded season). Skipped, visibly, otherwise.

This is not a backtest (that is T-062); it checks the fit is well behaved on
a real league: it converges, the home advantage is positive, and it beats a
uniform forecast on the matches it was trained on.
"""

import math
import os
from datetime import date

import psycopg
import pytest

from fmip_model.model.data import matches_before
from fmip_model.model.dixon_coles import fit

DATABASE_URL = os.environ.get("DATABASE_URL")

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


def test_fits_a_real_premier_league_season() -> None:
    assert DATABASE_URL
    with psycopg.connect(DATABASE_URL) as conn:
        matches = matches_before(conn, date(2025, 6, 1), ["E0"], since=date(2024, 7, 1))

    if len(matches) < 300:
        pytest.skip("load E0 2024/25 first: python -m fmip_model.training.load football-data ...")

    model = fit(matches, fit_date=date(2025, 6, 1))

    assert model.matches_used == len(matches)
    assert 0.0 < model.home_advantage < 0.6
    assert -0.5 < model.rho < 0.3
    assert len(model.teams) == 20

    # In-sample log loss against a uniform 1/3 forecast: the model must know
    # more than nothing about the season it was fitted on.
    log_loss = 0.0
    for m in matches:
        outcome = model.predict(m.home, m.away)
        p = (
            outcome.home_win
            if m.home_goals > m.away_goals
            else outcome.away_win
            if m.home_goals < m.away_goals
            else outcome.draw
        )
        log_loss -= math.log(max(p, 1e-9))
    log_loss /= len(matches)
    assert log_loss < math.log(3), f"in-sample log loss {log_loss:.3f} is no better than uniform"
