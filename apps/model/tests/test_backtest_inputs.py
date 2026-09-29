"""The input harness (T-1101, D-139): a planted effect passes the bar, no effect fails it."""

from collections.abc import Sequence
from dataclasses import replace
from datetime import date, timedelta

import numpy as np
import pytest

from fmip_model.backtest.inputs import BAR, DivisionRun, judge, judge_group, render, report_body
from fmip_model.backtest.inputs import run_division as run
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import FeatureInput, InputContext, Scheduled, available, load
from fmip_model.model.dixon_coles import FittedModel, MatchObservation
from fmip_model.model.version import BASELINE

TEAMS = [f"C{i}" for i in range(10)]
START = date(2024, 8, 1)
WINDOW = (START + timedelta(days=3 * 20), START + timedelta(days=3 * 90))
CANDIDATE = replace(BASELINE, version="0.9.0", xi=0.004, ridge=0.1)

Features = dict[tuple[date, str, str], tuple[float, float]]


def simulate(effect: float, seed: int) -> tuple[list[BacktestMatch], Features]:
    """Ninety rounds of five matches, three days apart; each side has a +/-1 flag
    that moves its log expected goals by ``effect``."""
    rng = np.random.default_rng(seed)
    strength = {t: float(rng.normal(0, 0.35)) for t in TEAMS}
    matches: list[BacktestMatch] = []
    flags: Features = {}
    for r in range(90):
        day = START + timedelta(days=3 * r)
        order = rng.permutation(TEAMS)
        for k in range(5):
            home, away = str(order[2 * k]), str(order[2 * k + 1])
            xh, xa = float(rng.choice([-1, 1])), float(rng.choice([-1, 1]))
            lam = np.exp(0.1 + 0.25 + strength[home] - strength[away] + effect * xh)
            mu = np.exp(0.1 + strength[away] - strength[home] + effect * xa)
            matches.append(
                BacktestMatch(day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu)))
            )
            flags[(day, home, away)] = (xh, xa)
    return matches, flags


def flag_input(flags: Features) -> FeatureInput:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[list[float], list[float]]:
        xh, xa = flags[(match.date, match.home, match.away)]
        return [xh], [xa]

    return FeatureInput("flag", "a planted flag", features)


@pytest.fixture(scope="module")
def planted() -> DivisionRun:
    matches, flags = simulate(effect=0.3, seed=5)
    return run("T9", "football_data", matches, WINDOW, candidate=CANDIDATE,
               model_input=flag_input(flags))  # fmt: skip


def test_a_planted_effect_passes_the_bar(planted: DivisionRun) -> None:
    division = planted
    overall, groups = judge([division])
    fd = groups[0]
    assert fd.group == "football_data" and fd.verdict == "passed", fd.reasons
    assert fd.applied >= BAR.min_applied and fd.share_applied == 1.0
    assert fd.difference is not None and fd.interval is not None and fd.interval[1] < 0
    assert overall == "passed"
    assert groups[1].verdict == "not run"


def test_no_effect_fails_the_bar() -> None:
    matches, flags = simulate(effect=0.0, seed=5)
    division = run("T9", "football_data", matches, WINDOW, candidate=CANDIDATE,
                   model_input=flag_input(flags))  # fmt: skip
    overall, groups = judge([division])
    assert groups[0].verdict == "failed"
    assert overall == "failed"
    body = report_body("flag", "a planted flag", CANDIDATE, WINDOW, overall, groups,
                       [division], "simulated")  # fmt: skip
    assert "**Verdict: failed**" in render(body)


class Spy:
    """Records the latest match each call could see; applies no term on odd days."""

    name = "spy"
    description = "leak check"

    def __init__(self) -> None:
        self.calls: list[tuple[str, date, date | None]] = []

    def fit(
        self, division: str, history: Sequence[MatchObservation], fit_date: date,
        model: FittedModel,
    ) -> "Spy":  # fmt: skip
        self.calls.append(("fit", fit_date, max((m.date for m in history), default=None)))
        return self

    def shift(
        self, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[float, float] | None:  # noqa: E501
        self.calls.append(("shift", match.date, max((m.date for m in known), default=None)))
        return None if match.date.day % 2 else (0.0, 0.0)


def test_the_input_never_sees_a_match_after_its_fit_date() -> None:
    matches, _ = simulate(effect=0.0, seed=2)
    spy = Spy()
    division = run("T9", "our_records", matches, WINDOW, candidate=CANDIDATE, model_input=spy)
    fits = [c for c in spy.calls if c[0] == "fit"]
    shifts = [c for c in spy.calls if c[0] == "shift"]
    assert fits and shifts
    for _, fit_date, latest in fits:
        assert latest is not None and latest <= fit_date
    for _, day, latest in shifts:
        assert latest is not None and latest < day
    # A match the input cannot read is the candidate's own forecast and not in its sample.
    skipped = [s for s in division.scores if not s.applied]
    assert skipped and all(s.with_input == s.candidate for s in skipped)


def test_groups_are_judged_apart_and_a_small_sample_gets_no_verdict(
    planted: DivisionRun,
) -> None:
    division = planted
    small = DivisionRun("R1", "our_records", division.scores[:40], 1, 0, 0)
    overall, groups = judge([division, small])
    assert [g.verdict for g in groups] == ["passed", "insufficient"]
    assert overall == "passed"
    assert judge_group("our_records", [small]).applied == 40


def test_inputs_are_found_by_name() -> None:
    assert "null" in available()
    context = InputContext(None, ("E0",), date(2026, 1, 1))
    assert load("null", context).name == "null"
    with pytest.raises(LookupError):
        load("no_such_input", context)
