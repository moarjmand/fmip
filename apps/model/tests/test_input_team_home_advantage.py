"""Home advantage by team (T-1141, D-149)."""

from dataclasses import replace
from datetime import date, timedelta

import numpy as np

from fmip_model.backtest.inputs import judge
from fmip_model.backtest.inputs import run_division as run
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import InputContext, available, load
from fmip_model.inputs.team_home_advantage import (
    MIN_HOME_MATCHES,
    PENALTY,
    TeamHomeAdvantage,
    eligible,
    poisson_fit,
)
from fmip_model.model.dixon_coles import FittedModel, MatchObservation, fit
from fmip_model.model.version import BASELINE

TEAMS = [f"C{i}" for i in range(10)]
START = date(2024, 8, 1)


def simulate(bonus: dict[str, float], seed: int, rounds: int = 220) -> list[BacktestMatch]:
    """Ten sides, one division home advantage of 0.25, plus ``bonus`` for some sides at home."""
    rng = np.random.default_rng(seed)
    strength = {t: float(rng.normal(0, 0.3)) for t in TEAMS}
    matches: list[BacktestMatch] = []
    for r in range(rounds):
        day = START + timedelta(days=3 * r)
        order = rng.permutation(TEAMS)
        for k in range(5):
            home, away = str(order[2 * k]), str(order[2 * k + 1])
            b = bonus.get(home, 0.0)
            lam = np.exp(0.1 + 0.25 + b / 2 + strength[home] - strength[away])
            mu = np.exp(0.1 - b / 2 + strength[away] - strength[home])
            matches.append(
                BacktestMatch(day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu)))
            )
    return matches


def test_a_club_with_a_real_home_edge_gets_a_deviation_and_the_rest_stay_near_zero() -> None:
    matches = simulate({"C0": 0.6, "C1": -0.6}, seed=3)
    fit_date = matches[-1].date
    fitted = poisson_fit(matches, fit_date, 0.002, set(TEAMS), 3.0)
    delta = {t: float(fitted.delta[i]) for t, i in fitted.index.items()}
    assert delta["C0"] > 0.1 and delta["C1"] < -0.1
    assert all(abs(delta[t]) < abs(delta["C0"]) for t in TEAMS[2:])
    assert 0.1 < fitted.home < 0.4
    # The chosen penalty pulls every deviation further toward the division's value.
    shrunk = poisson_fit(matches, fit_date, 0.002, set(TEAMS), PENALTY)
    assert 0 < shrunk.delta[shrunk.index["C0"]] < delta["C0"]


def test_a_club_with_few_home_matches_stays_at_its_divisions_value() -> None:
    matches = simulate({}, seed=4, rounds=60)
    late = MatchObservation(matches[-1].date, "NEW", "C0", 3, 0)
    history = [*matches, late]
    free = eligible(history, late.date)
    assert "NEW" not in free and set(TEAMS) <= free
    fitted = poisson_fit(history, late.date, 0.002, free, PENALTY)
    assert fitted.delta[fitted.index["NEW"]] == 0.0
    assert MIN_HOME_MATCHES > 1


def test_a_side_the_history_never_saw_gives_no_value() -> None:
    matches = simulate({}, seed=5, rounds=40)
    term = TeamHomeAdvantage().fit("T9", matches, matches[-1].date, _model(matches))
    unseen = MatchObservation(matches[-1].date + timedelta(days=1), "C0", "NEW", 0, 0)
    assert term.shift(unseen, matches) is None
    seen = MatchObservation(matches[-1].date + timedelta(days=1), "C0", "C1", 0, 0)
    assert term.shift(seen, matches) is not None


def _model(matches: list[BacktestMatch]) -> FittedModel:
    return fit(matches, matches[-1].date, xi=0.002, ridge=0.1)


CANDIDATE = replace(BASELINE, version="0.9.0", xi=0.003, ridge=0.1)
WINDOW = (date(2025, 3, 1), date(2026, 6, 30))


def test_planted_home_edges_pass_the_bar_and_none_fails() -> None:
    bonus = {t: (0.5 if i % 2 else -0.5) for i, t in enumerate(TEAMS)}
    planted = run("T9", "football_data", simulate(bonus, 7), WINDOW, candidate=CANDIDATE,
                  model_input=TeamHomeAdvantage())  # fmt: skip
    overall, groups = judge([planted])
    assert overall == "passed", groups[0].reasons

    none = run("T9", "football_data", simulate({}, 7), WINDOW, candidate=CANDIDATE,
               model_input=TeamHomeAdvantage())  # fmt: skip
    assert judge([none])[0] == "failed"


def test_it_is_found_by_name() -> None:
    assert "team_home_advantage" in available()
    built = load("team_home_advantage", InputContext(None, ("E0",), START))
    assert built.name == "team_home_advantage"
