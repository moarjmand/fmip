"""The second leg (T-1121, D-144): the first leg's score, only for a real two-legged tie."""

from datetime import date, timedelta

import numpy as np

from fmip_model.backtest.inputs import run_division
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import available
from fmip_model.inputs.second_leg import (
    CupFixture,
    first_leg_difference,
    pair_legs,
    second_leg_input,
)
from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.version import BASELINE

D1 = date(2026, 2, 17)
D2 = D1 + timedelta(days=7)


def cf(day: date, home: str, away: str, **kw: object) -> CupFixture:
    base: dict[str, object] = dict(
        season="UCL25", round="Round of 16", group=None, legs=1, continental=True
    )
    base.update(kw)
    return CupFixture(date=day, home=home, away=away, **base)  # type: ignore[arg-type]


def test_a_continental_tie_pairs_its_legs() -> None:
    pairs = pair_legs([cf(D1, "A", "B"), cf(D2, "B", "A")])
    assert pairs == {(D2, "B", "A"): (D1, "A", "B")}


def test_a_single_leg_round_and_a_group_are_not_ties() -> None:
    assert pair_legs([cf(D1, "A", "B", round="Final")]) == {}
    group = [cf(D1, "A", "B", group="Group A"), cf(D2, "B", "A", group="Group A")]
    assert pair_legs(group) == {}
    stage = [cf(D1, "A", "B", round="League Stage"), cf(D2, "B", "A", round="League Stage")]
    assert pair_legs(stage) == {}


def test_a_domestic_cup_needs_its_stage_to_say_two_legs() -> None:
    replay = [cf(D1, "A", "B", continental=False), cf(D2, "B", "A", continental=False)]
    assert pair_legs(replay) == {}
    semis = [cf(D1, "A", "B", continental=False, legs=2), cf(D2, "B", "A", continental=False,
                                                              legs=2)]  # fmt: skip
    assert len(pair_legs(semis)) == 1


def test_legs_on_one_day_or_with_the_same_home_side_are_not_a_tie() -> None:
    assert pair_legs([cf(D1, "A", "B"), cf(D1, "B", "A")]) == {}
    assert pair_legs([cf(D1, "A", "B"), cf(D2, "A", "B")]) == {}


def test_the_first_legs_difference_is_from_the_second_legs_home_side() -> None:
    pairs = pair_legs([cf(D1, "A", "B"), cf(D2, "B", "A")])
    second = MatchObservation(D2, "B", "A", 0, 0)
    # B lost 3-1 away in the first leg: -2 for B at home.
    assert first_leg_difference(pairs, second, [MatchObservation(D1, "A", "B", 3, 1)]) == -2
    assert first_leg_difference(pairs, second, [MatchObservation(D1, "A", "B", 0, 6)]) == 3
    assert first_leg_difference(pairs, second, []) is None  # the first leg's result unknown
    first = MatchObservation(D1, "A", "B", 0, 0)
    assert first_leg_difference(pairs, first, []) is None  # a first leg has no value


def test_the_features_move_each_side_by_its_lead() -> None:
    feature = second_leg_input(pair_legs([cf(D1, "A", "B"), cf(D2, "B", "A")]))
    x = feature.features_of("XL", MatchObservation(D2, "B", "A", 0, 0),
                            [MatchObservation(D1, "A", "B", 2, 0)])  # fmt: skip
    assert x is not None
    assert list(x[0]) == [-2.0, 2.0] and list(x[1]) == [2.0, 2.0]


def test_the_harness_reads_second_legs_only() -> None:
    assert "second_leg" in available()
    rng = np.random.default_rng(11)
    teams = [f"T{i}" for i in range(10)]
    fixtures: list[CupFixture] = []
    matches: list[BacktestMatch] = []
    start = date(2024, 8, 1)
    for r in range(40):
        order = rng.permutation(teams)
        for k in range(5):
            h, a = str(order[2 * k]), str(order[2 * k + 1])
            d1, d2 = start + timedelta(days=14 * r), start + timedelta(days=14 * r + 7)
            label = f"Round {r}"
            fixtures += [cf(d1, h, a, round=label), cf(d2, a, h, round=label)]
            matches += [
                BacktestMatch(d1, h, a, int(rng.poisson(1.4)), int(rng.poisson(1.1))),
                BacktestMatch(d2, a, h, int(rng.poisson(1.4)), int(rng.poisson(1.1))),
            ]
    run = run_division(
        "XL",
        "our_records",
        matches,
        (start + timedelta(days=14 * 10), start + timedelta(days=14 * 40)),
        candidate=BASELINE,
        model_input=second_leg_input(pair_legs(fixtures)),
        min_history=40,
    )
    applied = [s for s in run.scores if s.applied]
    assert applied and all((s.match.date - start).days % 14 == 7 for s in applied)
    assert len(applied) == len([s for s in run.scores if (s.match.date - start).days % 14 == 7])
