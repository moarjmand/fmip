"""A new coach as an input (T-1131, D-147): the rule, and the harness on a planted bounce.

Needs no database: the line-ups are built here.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

import numpy as np
import pytest

from fmip_model.backtest.inputs import run_division
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import InputContext, available
from fmip_model.inputs.new_coach import (
    HALF_LIFE,
    WINDOW,
    Coaches,
    SideState,
    build,
    decay,
    new_coach_input,
)
from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.version import BASELINE
from fmip_model.training.coaches import LineUp

START = datetime(2025, 8, 2, 15, tzinfo=UTC)


def day(i: int) -> date:
    return (START + timedelta(days=7 * i)).date()


def club(team: str, coaches: Sequence[str | None]) -> list[LineUp]:
    return [
        LineUp(team, f"{team}-f{i}", START + timedelta(days=7 * i), "2025/26", c)
        for i, c in enumerate(coaches)
    ]


def test_the_term_decays_over_the_window_and_is_zero_after() -> None:
    assert decay(1) == 1.0
    assert decay(1 + int(HALF_LIFE)) == pytest.approx(0.5)
    assert decay(WINDOW) > 0
    assert decay(WINDOW + 1) == 0.0


def test_a_first_stored_coach_is_unknown_until_past_the_window() -> None:
    assert SideState(3, after_change=True).feature() == decay(3)
    assert SideState(3, after_change=False).feature() is None  # his spell may be new
    assert SideState(WINDOW + 1, after_change=False).feature() == 0.0
    assert SideState(WINDOW + 5, after_change=True).feature() == 0.0


def test_a_gap_is_never_read_and_a_change_restarts_the_count() -> None:
    coaches = Coaches(club("a", ["x"] * (WINDOW + 1) + ["y", None, "y"]))
    assert coaches.feature("a", day(WINDOW)) == 0.0  # x, past the window
    assert coaches.feature("a", day(WINDOW + 1)) == decay(1)  # y's first match
    assert coaches.feature("a", day(WINDOW + 2)) is None  # a gap: unknown, not carried
    assert coaches.feature("a", day(WINDOW + 3)) == decay(2)  # the gap counts for no one
    assert coaches.feature("a", day(WINDOW + 9)) is None  # no stored line-up
    assert coaches.changes_by_season == {"2025/26": 1}


def test_a_match_is_read_only_with_both_sides_known_and_one_new() -> None:
    lineups = (
        club("new", ["x"] * (WINDOW + 1) + ["y"])
        + club("old", ["o"] * (WINDOW + 2))
        + club("young", ["p"] * (WINDOW + 2))
    )
    term = new_coach_input(Coaches(lineups))
    d = day(WINDOW + 1)

    def m(home: str, away: str, on: date = d) -> MatchObservation:
        return MatchObservation(on, home, away, 0, 0)

    x = term.features_of("XL", m("new", "old"), [])
    assert x is not None
    assert list(x[0]) == [1.0, 0.0] and list(x[1]) == [0.0, 1.0]
    assert term.features_of("XL", m("old", "young"), []) is None  # neither is new
    # Early on, "young"'s first stored coach may be new: not read.
    assert term.features_of("XL", m("new", "young", day(3)), []) is None
    # A football-data name reaches no line-up.
    assert term.features_of("E0", m("Arsenal", "new"), []) is None


def test_the_input_needs_the_database() -> None:
    assert "new_coach" in available()
    with pytest.raises(LookupError):
        build(InputContext(None, ("XL",), date(2026, 6, 30)))


def test_the_harness_fits_a_planted_new_coach_bounce() -> None:
    rng = np.random.default_rng(1131)
    teams = [f"T{i}" for i in range(10)]
    rounds = 150
    # Every club changes coach every 25 rounds, staggered by club.
    coach_of = {
        t: [f"{t}-c{(r + 3 * i) // 25}" for r in range(rounds)] for i, t in enumerate(teams)
    }
    lineups: list[LineUp] = []
    matches: list[BacktestMatch] = []
    for r in range(rounds):
        kickoff = START + timedelta(days=4 * r)
        order = rng.permutation(teams)
        for k in range(5):
            h, a = str(order[2 * k]), str(order[2 * k + 1])
            for t in (h, a):
                lineups.append(LineUp(t, f"f{r}-{k}", kickoff, "2025/26", coach_of[t][r]))
            matches.append(BacktestMatch(kickoff.date(), h, a, 0, 0))
    coaches = Coaches(lineups)
    # Goals: a side under a new coach scores more (the planted effect).
    planted: list[BacktestMatch] = []
    for mt in matches:
        fh = coaches.feature(mt.home, mt.date) or 0.0
        fa = coaches.feature(mt.away, mt.date) or 0.0
        planted.append(
            BacktestMatch(
                mt.date,
                mt.home,
                mt.away,
                int(rng.poisson(1.4 * np.exp(0.6 * fh))),
                int(rng.poisson(1.1 * np.exp(0.6 * fa))),
            )
        )
    run = run_division(
        "XL",
        "our_records",
        planted,
        (planted[0].date + timedelta(days=4 * 60), planted[-1].date),
        candidate=BASELINE,
        model_input=new_coach_input(coaches),
        min_history=60,
    )
    applied = [s for s in run.scores if s.applied]
    assert applied and len(applied) < len(run.scores)
    for s in applied:
        home_f, away_f = (
            coaches.feature(s.match.home, s.match.date),
            coaches.feature(s.match.away, s.match.date),
        )
        assert home_f is not None and away_f is not None and (home_f > 0 or away_f > 0)
    # The fitted term raises the chance of the side with the new coach.
    home_new = [s for s in applied if (coaches.feature(s.match.home, s.match.date) or 0) > 0.5]
    assert home_new
    assert np.mean([s.with_input.home - s.candidate.home for s in home_new]) > 0
