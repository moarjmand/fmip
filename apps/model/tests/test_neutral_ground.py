"""Neutral ground (T-1122, D-145): no home advantage on neither club's usual ground."""

from datetime import date, timedelta

import numpy as np

from fmip_model.backtest.inputs import run_division
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import available
from fmip_model.inputs.neutral_ground import Fixture, Grounds, NeutralGround
from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.version import BASELINE

D = date(2025, 9, 1)


def league(home: str, away: str, day: date, venue: str | None, season: str = "L25") -> Fixture:
    return Fixture(day, home, away, venue, True, season)


def cup(home: str, away: str, day: date, venue: str | None) -> Fixture:
    return Fixture(day, home, away, venue, False, "C25")


def m(day: date, home: str, away: str) -> MatchObservation:
    return MatchObservation(day, home, away, 0, 0)


BASE = [
    league("A", "B", D, "va"),
    league("A", "C", D + timedelta(days=7), "va"),
    league("A", "B", D + timedelta(days=14), "vx"),  # one match elsewhere: still va
    league("B", "A", D + timedelta(days=21), "vb"),
    league("C", "A", D + timedelta(days=28), "vb"),  # C shares B's ground
    league("C", "B", D + timedelta(days=35), "vb"),
]


def test_a_final_on_a_third_ground_is_neutral() -> None:
    final = cup("A", "B", D + timedelta(days=60), "wembley")
    grounds = Grounds([*BASE, final])
    assert grounds.usual("A", final.date) == frozenset({"va"})
    assert grounds.neutral(m(final.date, "A", "B")) is True


def test_a_match_on_either_clubs_ground_is_not_neutral() -> None:
    at_home = cup("A", "B", D + timedelta(days=60), "va")
    at_away = cup("A", "B", D + timedelta(days=61), "vb")
    grounds = Grounds([*BASE, at_home, at_away])
    assert grounds.neutral(m(at_home.date, "A", "B")) is False
    assert grounds.neutral(m(at_away.date, "A", "B")) is False


def test_a_shared_ground_is_either_clubs_usual_ground() -> None:
    # C plays its home match on vb, B's ground too: not neutral for C v A.
    shared = cup("C", "A", D + timedelta(days=60), "vb")
    grounds = Grounds([*BASE, shared])
    assert grounds.neutral(m(shared.date, "C", "A")) is False


def test_a_tie_for_most_gives_every_venue_in_it() -> None:
    grounds = Grounds([league("A", "B", D, "v1"), league("A", "C", D + timedelta(days=7), "v2")])
    assert grounds.usual("A", D) == frozenset({"v1", "v2"})


def test_no_venue_or_no_usual_ground_cannot_be_told() -> None:
    no_venue = cup("A", "B", D + timedelta(days=60), None)
    foreign = cup("A", "Z", D + timedelta(days=61), "elsewhere")  # Z's league is not carried
    grounds = Grounds([*BASE, no_venue, foreign])
    assert grounds.neutral(m(no_venue.date, "A", "B")) is None
    assert grounds.neutral(m(foreign.date, "A", "Z")) is None
    assert grounds.neutral(m(D, "P", "Q")) is None  # not among the fixtures at all


def test_a_season_long_over_says_nothing() -> None:
    grounds = Grounds(BASE)
    assert grounds.usual("A", D + timedelta(days=200)) == frozenset({"va"})
    assert grounds.usual("A", D + timedelta(days=500)) is None
    assert grounds.usual("A", D - timedelta(days=1)) is None  # before any season


def test_the_harness_takes_the_home_advantage_off_neutral_matches_only() -> None:
    assert "neutral_ground" in available()
    rng = np.random.default_rng(3)
    teams = [f"T{i}" for i in range(8)]
    fixtures: list[Fixture] = []
    matches: list[BacktestMatch] = []
    start = date(2024, 8, 1)
    for r in range(60):
        day = start + timedelta(days=4 * r)
        order = rng.permutation(teams)
        for k in range(4):
            h, a = str(order[2 * k]), str(order[2 * k + 1])
            neutral = r % 5 == 4  # every fifth round is played on neutral ground
            venue = "final" if neutral else f"g{h}"
            fixtures.append(Fixture(day, h, a, venue, not neutral, "S"))
            lam = np.exp(0.1 + (0 if neutral else 0.3))
            matches.append(BacktestMatch(day, h, a, int(rng.poisson(lam)), int(rng.poisson(1.1))))
    run = run_division(
        "XL",
        "our_records",
        matches,
        (start + timedelta(days=4 * 20), start + timedelta(days=4 * 60)),
        candidate=BASELINE,
        model_input=NeutralGround(Grounds(fixtures)),
        min_history=40,
    )
    applied = [s for s in run.scores if s.applied]
    assert applied
    assert all((s.match.date - start).days // 4 % 5 == 4 for s in applied)
    for s in applied:
        # No home advantage: the home side's chance falls.
        assert s.with_input.home < s.candidate.home
