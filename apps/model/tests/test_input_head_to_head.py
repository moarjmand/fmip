"""Head-to-head after current strength (T-1140, D-148)."""

from dataclasses import replace
from datetime import date, timedelta

import numpy as np
import pytest

from fmip_model.backtest.inputs import judge
from fmip_model.backtest.inputs import run_division as run
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import InputContext, available, load
from fmip_model.inputs.head_to_head import (
    HALF_LIFE_DAYS,
    MAX_AGE_DAYS,
    PSEUDO_MEETINGS,
    HeadToHead,
    Meetings,
    residual,
)
from fmip_model.model.dixon_coles import FittedModel, MatchObservation
from fmip_model.model.version import BASELINE

DAY = date(2026, 3, 1)


def flat_model() -> FittedModel:
    """Every side scores exp(0) = 1 goal against every other; no home advantage."""
    teams = ("A", "B", "C")
    return FittedModel(DAY, teams, dict.fromkeys(teams, 0.0), dict.fromkeys(teams, 0.0), 0.0,
                       0.0, 0.002, 0, 0.0)  # fmt: skip


def test_the_residual_is_against_the_model_and_from_the_home_sides_view() -> None:
    model = flat_model()
    today = [MatchObservation(DAY - timedelta(days=1), "A", "B", 3, 1)]  # A +2 over expected
    assert residual(model, "A", "B", DAY, today) == pytest.approx(
        2 * np.exp(-np.log(2) / HALF_LIFE_DAYS) / (np.exp(-np.log(2) / HALF_LIFE_DAYS)
                                                   + PSEUDO_MEETINGS))  # fmt: skip
    # The same meeting read for B at home against A is the opposite residual.
    assert residual(model, "B", "A", DAY, today) == pytest.approx(-residual(model, "A", "B", DAY,
                                                                             today))  # fmt: skip
    # A meeting two half-lives old counts a quarter as much.
    old = [MatchObservation(DAY - timedelta(days=2 * HALF_LIFE_DAYS), "B", "A", 1, 3)]
    assert residual(model, "A", "B", DAY, old) == pytest.approx(2 * 0.25 / (0.25 + 2), rel=1e-3)
    # A result exactly as expected leaves nothing.
    assert residual(model, "A", "B", DAY, [MatchObservation(DAY, "A", "B", 1, 1)]) == 0.0


def test_no_meeting_is_no_value_never_zero() -> None:
    model = flat_model()
    assert residual(model, "A", "B", DAY, []) is None
    assert residual(model, "A", "Z", DAY, [MatchObservation(DAY, "A", "Z", 2, 0)]) is None


def test_meetings_are_read_strictly_before_the_day_and_within_the_age_limit() -> None:
    meetings = Meetings()
    rows = [
        MatchObservation(DAY - timedelta(days=MAX_AGE_DAYS + 1), "A", "B", 5, 0),
        MatchObservation(DAY - timedelta(days=10), "B", "A", 0, 1),
        MatchObservation(DAY, "A", "B", 9, 0),
        MatchObservation(DAY - timedelta(days=5), "A", "C", 1, 1),
    ]
    meetings.add("E0", rows)
    meetings.add("E0", rows)  # the harness and the store may hand the same row twice
    found = meetings.between("E0", "B", "A", DAY)
    assert [m.date for m in found] == [DAY - timedelta(days=10)]
    assert meetings.between("SP1", "A", "B", DAY) == []


def simulate(effect: float, seed: int) -> list[BacktestMatch]:
    """Two seasons of ten sides meeting often; each pair has a fixed edge of +/-``effect``
    in log expected goals for one side and against the other, whatever the venue."""
    rng = np.random.default_rng(seed)
    teams = [f"C{i}" for i in range(10)]
    strength = {t: float(rng.normal(0, 0.3)) for t in teams}
    edge = {(a, b): float(rng.choice([-1, 1])) * effect for a in teams for b in teams if a < b}
    matches: list[BacktestMatch] = []
    start = date(2024, 8, 1)
    for r in range(220):
        day = start + timedelta(days=3 * r)
        order = rng.permutation(teams)
        for k in range(5):
            home, away = str(order[2 * k]), str(order[2 * k + 1])
            e = edge[(home, away)] if home < away else -edge[(away, home)]
            lam = np.exp(0.1 + 0.25 + strength[home] - strength[away] + e)
            mu = np.exp(0.1 + strength[away] - strength[home] - e)
            matches.append(
                BacktestMatch(day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu)))
            )
    return matches


CANDIDATE = replace(BASELINE, version="0.9.0", xi=0.003, ridge=0.1)
WINDOW = (date(2025, 3, 1), date(2026, 6, 30))


def test_a_planted_pairing_edge_is_found_and_none_is_not() -> None:
    planted = run("T9", "football_data", simulate(0.35, 7), WINDOW, candidate=CANDIDATE,
                  model_input=HeadToHead(Meetings()))  # fmt: skip
    overall, groups = judge([planted])
    assert overall == "passed", groups[0].reasons
    assert groups[0].share_applied > 0.95

    none = run("T9", "football_data", simulate(0.0, 7), WINDOW, candidate=CANDIDATE,
               model_input=HeadToHead(Meetings()))  # fmt: skip
    assert judge([none])[0] == "failed"


def test_it_is_found_by_name_without_a_database() -> None:
    assert "head_to_head" in available()
    assert load("head_to_head", InputContext(None, ("E0",), DAY)).name == "head_to_head"
