"""Rest and congestion as an input (T-1110, D-141)."""

from dataclasses import replace
from datetime import date, timedelta

import numpy as np
import pytest

from fmip_model.backtest.inputs import judge
from fmip_model.backtest.inputs import run_division as run
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import InputContext, available, load
from fmip_model.inputs.rest import (
    ClubKeys,
    Schedule,
    extra_matches,
    features_from,
    rest_input,
    short_rest,
)
from fmip_model.model.version import BASELINE

D = date(2025, 9, 1)


def test_the_input_is_found_by_name_and_needs_the_store() -> None:
    assert "rest" in available()
    with pytest.raises(LookupError):
        load("rest", InputContext(None, ("E0",), D))


def test_rest_reads_only_matches_strictly_before_the_day() -> None:
    s = Schedule([("a", D), ("a", D + timedelta(days=4)), ("a", D + timedelta(days=4)),
                  ("a", D + timedelta(days=10))])  # fmt: skip
    assert s.rest("a", D) is None  # no earlier match: no value, never a default
    assert s.rest("nobody", D) is None
    # The same day's match is not "before"; a duplicate row is one match day.
    assert s.rest("a", D + timedelta(days=4)) == (4, 1)
    assert s.rest("a", D + timedelta(days=10)) == (6, 2)
    # Fourteen days before the day, inclusive of day - 14.
    assert s.rest("a", D + timedelta(days=14)) == (4, 3)
    assert s.rest("a", D + timedelta(days=15)) == (5, 2)


def test_the_features_are_zero_on_a_normal_week() -> None:
    assert short_rest(7) == 0.0 and short_rest(30) == 0.0
    assert short_rest(3) == 1.0 and short_rest(1) == 1.0 and short_rest(5) == 0.5
    assert extra_matches(2) == 0.0 and extra_matches(4) == 2.0


def test_clubs_are_keyed_through_the_bridge() -> None:
    keys = ClubKeys({"E0": {"Arsenal": "uuid-ars"}})
    assert keys("E0", "Arsenal") == "uuid-ars"
    assert keys("E0", "Leeds") == "E0:Leeds"
    # A cup match stored under the team id counts toward the league side's rest.
    schedule = Schedule([("uuid-ars", D), ("E0:Leeds", D - timedelta(days=10))])
    f = features_from(schedule, keys)
    m = BacktestMatch(D + timedelta(days=3), "Arsenal", "Leeds", 0, 0)
    assert f("E0", m, []) == ([1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0])
    # Either side with no earlier match: not applied.
    assert f("E0", BacktestMatch(D, "Arsenal", "Leeds", 0, 0), []) is None


TEAMS = [f"C{i}" for i in range(24)]
START = date(2024, 8, 1)


def simulate(effect: float, seed: int) -> list[BacktestMatch]:
    """Three matches a day between six clubs drawn at random, so each side's rest
    varies on its own; a side on three days' rest or fewer has its log expected
    goals moved by ``effect``."""
    rng = np.random.default_rng(seed)
    strength = {t: float(rng.normal(0, 0.35)) for t in TEAMS}
    last: dict[str, date] = {}
    matches: list[BacktestMatch] = []
    for d in range(360):
        day = START + timedelta(days=d)
        order = rng.permutation(TEAMS)
        for k in range(3):
            home, away = str(order[2 * k]), str(order[2 * k + 1])
            th = effect if home in last and (day - last[home]).days <= 3 else 0.0
            ta = effect if away in last and (day - last[away]).days <= 3 else 0.0
            lam = np.exp(0.1 + 0.25 + strength[home] - strength[away] + th)
            mu = np.exp(0.1 + strength[away] - strength[home] + ta)
            matches.append(
                BacktestMatch(day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu)))
            )
            last[home] = last[away] = day
    return matches


def schedule_of(matches: list[BacktestMatch]) -> Schedule:
    return Schedule([(f"T9:{t}", m.date) for m in matches for t in (m.home, m.away)])


@pytest.mark.parametrize(("effect", "verdict"), [(-0.5, "passed"), (0.0, "failed")])
def test_a_planted_fatigue_effect_passes_and_none_fails(effect: float, verdict: str) -> None:
    matches = simulate(effect, seed=11)
    candidate = replace(BASELINE, version="0.9.0", xi=0.004, ridge=0.1)
    window = (matches[360].date, matches[-1].date)
    model_input = rest_input(schedule_of(matches), ClubKeys({}))
    division = run("T9", "football_data", matches, window, candidate=candidate,
                   model_input=model_input, refit_every_days=28)  # fmt: skip
    _, groups = judge([division])
    assert groups[0].verdict == verdict, groups[0].reasons
