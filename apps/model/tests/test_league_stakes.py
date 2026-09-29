"""League stakes (T-1120, D-143): a side's place is locked only when no one can reach it."""

from datetime import date, timedelta
from itertools import permutations

from fmip_model.backtest.inputs import run_division
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import available
from fmip_model.inputs.league_stakes import (
    Listed,
    Schedule,
    league_stakes_input,
    locked,
    season_list,
    stakes,
)
from fmip_model.model.dixon_coles import MatchObservation
from fmip_model.model.version import BASELINE

TEAMS = ["A", "B", "C", "D"]
START = date(2025, 8, 1)
ORDER = {"A": 4, "B": 3, "C": 2, "D": 1}


def double_round_robin(teams: list[str]) -> list[Listed]:
    """Each ordered pair once, a day apart: AB AC AD BA BC BD CA CB CD DA DB DC."""
    return [
        Listed(START + timedelta(days=i), h, a) for i, (h, a) in enumerate(permutations(teams, 2))
    ]


def played(fixtures: list[Listed], upto: int) -> list[MatchObservation]:
    """The first ``upto`` fixtures, the side earlier in the alphabet winning 1-0."""
    return [
        MatchObservation(
            f.date, f.home, f.away, *((1, 0) if ORDER[f.home] > ORDER[f.away] else (0, 1))
        )
        for f in fixtures[:upto]
    ]


def test_locked_needs_every_other_side_out_of_reach_both_ways() -> None:
    points = {"A": 30, "B": 12, "C": 12, "D": 0}
    left = {"A": 2, "B": 2, "C": 2, "D": 2}
    assert locked("A", points, left)  # the top: B and C reach 18
    assert locked("D", points, left)  # the bottom: D reaches 6
    assert not locked("B", points, left)  # level with C
    assert not locked("C", points, left)


def test_a_middle_side_is_locked_when_neither_neighbour_can_reach() -> None:
    points = {"A": 30, "B": 20, "C": 10, "D": 0}
    left = {"A": 1, "B": 1, "C": 1, "D": 1}
    assert all(locked(t, points, left) for t in TEAMS)
    assert locked("B", points, {**left, "C": 3})  # C reaches 19 < 20
    assert not locked("B", points, {**left, "C": 4})  # C reaches 22


def test_a_side_that_could_draw_level_is_not_locked() -> None:
    # B can reach A exactly: a level finish is decided by goal difference.
    points = {"A": 30, "B": 27, "C": 0, "D": 0}
    left = {"A": 0, "B": 1, "C": 0, "D": 0}
    assert not locked("A", points, left)
    assert not locked("B", points, left)


def test_stakes_on_a_constructed_season() -> None:
    fixtures = double_round_robin(TEAMS)  # 12 matches, 6 per side
    schedule = Schedule({("X1", "2025/26"): fixtures})
    known = played(fixtures, 9)
    match = fixtures[9]
    assert (match.home, match.away) == ("D", "A")
    # A 15 with one left; B 9 with one left reaches 12. D 0 with three left reaches B's 9.
    assert stakes(schedule, "X1", match, known) == (False, True)
    assert stakes(schedule, "X1", fixtures[0], []) == (False, False)


def test_an_incomplete_list_gives_no_value() -> None:
    fixtures = double_round_robin(TEAMS)[:-1]
    schedule = Schedule({("X1", "2025/26"): fixtures})
    assert not season_list(fixtures).complete
    assert stakes(schedule, "X1", fixtures[9], played(fixtures, 9)) is None


def test_a_missing_earlier_result_gives_no_value() -> None:
    fixtures = double_round_robin(TEAMS)
    schedule = Schedule({("X1", "2025/26"): fixtures})
    known = played(fixtures, 9)
    assert stakes(schedule, "X1", fixtures[9], known) is not None
    assert stakes(schedule, "X1", fixtures[9], known[1:]) is None


def test_an_unplayed_fixture_counts_as_a_match_left() -> None:
    # Our records: a postponed fixture before the day is not a missing result.
    fixtures = double_round_robin(TEAMS)
    pending = Listed(fixtures[8].date, fixtures[8].home, fixtures[8].away, played=False)
    schedule = Schedule({("X1", "2025/26"): [*fixtures[:8], pending, *fixtures[9:]]})
    assert stakes(schedule, "X1", fixtures[9], played(fixtures, 8)) is not None


def test_a_match_outside_the_lists_or_with_no_locked_side_is_not_read() -> None:
    fixtures = double_round_robin(TEAMS)
    feature = league_stakes_input(Schedule({("X1", "2025/26"): fixtures}))
    assert feature.features_of("X2", fixtures[0], []) is None
    assert feature.features_of("X1", fixtures[0], []) is None  # nobody locked on day one
    x = feature.features_of("X1", fixtures[9], played(fixtures, 9))
    assert x is not None  # D (home) is not locked, A (away) is
    assert list(x[0]) == [0.0, 1.0] and list(x[1]) == [1.0, 0.0]


def test_the_harness_finds_it_and_runs_it() -> None:
    assert "league_stakes" in available()
    teams = [f"T{i}" for i in range(8)]
    seasons: dict[tuple[str, str], list[Listed]] = {}
    matches: list[BacktestMatch] = []
    for s, year in enumerate((2023, 2024)):
        for i, (h, a) in enumerate(permutations(teams, 2)):
            day = date(year, 8, 1) + timedelta(days=4 * (i // 4))
            seasons.setdefault(("X1", str(s)), []).append(Listed(day, h, a))
            strong = teams.index(h) < teams.index(a)
            matches.append(BacktestMatch(day, h, a, 2 if strong else 0, 0 if strong else 1))
    run = run_division(
        "X1",
        "football_data",
        matches,
        (date(2024, 8, 1), date(2025, 6, 30)),
        candidate=BASELINE,
        model_input=league_stakes_input(Schedule(seasons)),
        min_history=40,
    )
    applied = [s for s in run.scores if s.applied]
    assert applied and len(applied) < len(run.scores)
