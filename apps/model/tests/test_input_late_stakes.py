"""Late-season stakes (T-1659, D-311): each side's state in the last eight rounds, by the zones."""

from datetime import date, timedelta

import pytest

from fmip_model.inputs import FeatureInput, InputContext, Scheduled, available
from fmip_model.inputs._lab import RECORDS_URL, MinimumFit, Unread, records_url
from fmip_model.inputs._zones import SeasonZones
from fmip_model.inputs.late_stakes import (
    ROUNDS,
    State,
    build,
    cuts,
    finishes,
    late_stakes_input,
    late_states,
    state,
)
from fmip_model.inputs.league_stakes import Listed, Schedule
from fmip_model.model.dixon_coles import FittedModel, MatchObservation

TEAMS = ["A", "B", "C", "D", "E", "F"]  # A strongest
START = date(2024, 8, 3)
LABEL = "2024/25"


def double_round_robin(teams: list[str]) -> list[list[tuple[str, str]]]:
    """Rounds of (home, away): the circle method, then the same rounds reversed."""
    ts, n, half = list(teams), len(teams), []
    for r in range(n - 1):
        pairs = [(ts[i], ts[n - 1 - i]) for i in range(n // 2)]
        half.append([(h, a) if r % 2 == 0 else (a, h) for h, a in pairs])
        ts = [ts[0], ts[-1], *ts[1:-1]]
    return half + [[(a, h) for h, a in rnd] for rnd in half]


ROUND_LIST = double_round_robin(TEAMS)  # 10 rounds, 3 matches each
LISTED = [
    Listed(START + timedelta(days=7 * r), h, a) for r, rnd in enumerate(ROUND_LIST) for h, a in rnd
]


def zones(teams: int = 6, complete: bool = True) -> SeasonZones:
    # 1: champion; 1-2: Champions League; 5: relegation play-off; 6: relegated.
    return SeasonZones(
        "X1",
        LABEL,
        teams,
        (("champions_league", 1, 2), ("relegation_playoff", 5, 5), ("relegation", 6, 6)),
        complete,
    )


def results_before(r: int) -> list[MatchObservation]:
    """The stronger side wins every match of the rounds before ``r``."""
    return [
        MatchObservation(
            f.date,
            f.home,
            f.away,
            *((1, 0) if TEAMS.index(f.home) < TEAMS.index(f.away) else (0, 1)),
        )
        for f in LISTED
        if f.date < START + timedelta(days=7 * r)
    ]


def match_in(r: int, k: int = 0) -> Scheduled:
    h, a = ROUND_LIST[r][k]
    return MatchObservation(START + timedelta(days=7 * r), h, a, 0, 0)


def test_the_double_round_robin_is_complete() -> None:
    assert len(ROUND_LIST) == 10 and len(LISTED) == 30
    assert Schedule({("X1", LABEL): LISTED}).seasons[("X1", LABEL)].complete


def test_prizes_are_decided_at_each_prize_s_last_place_and_drops_at_each_relegation_s_first() -> (
    None
):
    assert cuts(zones()) == ((1, 2), (5, 6))
    promotion = SeasonZones(
        "E1",
        LABEL,
        24,
        (("promotion", 1, 2), ("promotion_playoff", 3, 6), ("relegation", 22, 24)),
        True,
    )
    assert cuts(promotion) == ((1, 2, 6), (22,))


def test_states_on_a_close_table() -> None:
    prize, drop = cuts(zones())
    points = {"A": 20, "B": 18, "C": 12, "D": 11, "E": 6, "F": 2}
    left = dict.fromkeys(points, 2)
    assert finishes("C", points, left) == (2, 5)
    assert state("A", points, left, prize, drop) == State(up=True, danger=False)  # the title open
    assert state("B", points, left, prize, drop) == State(up=True, danger=False)
    # C can still reach second place and still fall into the play-off: both at once.
    assert state("C", points, left, prize, drop) == State(up=True, danger=True)
    assert state("E", points, left, prize, drop) == State(up=False, danger=True)
    # F is sure of the bottom two, and can still drop from the play-off to last.
    assert state("F", points, left, prize, drop) == State(up=False, danger=True)


def test_nothing_to_play_for_is_settled_up_safe_or_down() -> None:
    prize, drop = cuts(zones())
    points = {"A": 30, "B": 22, "C": 15, "D": 14, "E": 5, "F": 1}
    left = dict.fromkeys(points, 1)
    for team in TEAMS:  # champion, sure of second, mid-table, sure of the play-off, down
        assert state(team, points, left, prize, drop).nothing, team
    assert State(up=False, danger=False).vector() == (0.0, 0.0, 1.0)
    assert State(up=True, danger=True).vector() == (1.0, 1.0, 0.0)


def test_a_level_finish_counts_against_the_side() -> None:
    prize, drop = cuts(zones())
    points = {"A": 30, "B": 22, "C": 19, "D": 14, "E": 5, "F": 1}
    left = {**dict.fromkeys(points, 0), "C": 1}
    # C can reach 22, level with B: B's second place is not yet sure.
    assert state("B", points, left, prize, drop).up
    assert state("C", points, left, prize, drop).up


def test_only_the_last_eight_rounds_are_read() -> None:
    schedule = Schedule({("X1", LABEL): LISTED})
    covered = {("X1", LABEL): zones()}
    # Each side plays 10: rounds 1 and 2 leave 10 and 9, round 3 leaves 8.
    assert ROUNDS == 8
    assert late_states(schedule, covered, "X1", match_in(0), results_before(0)) is None
    assert late_states(schedule, covered, "X1", match_in(1), results_before(1)) is None
    assert late_states(schedule, covered, "X1", match_in(2), results_before(2)) is not None
    assert late_states(schedule, covered, "X1", match_in(9), results_before(9)) is not None


def test_a_season_without_complete_zones_of_its_size_is_not_read() -> None:
    schedule = Schedule({("X1", LABEL): LISTED})
    m, known = match_in(5), results_before(5)
    assert late_states(schedule, {}, "X1", m, known) is None  # the file does not cover it
    assert late_states(schedule, {("X1", LABEL): zones(complete=False)}, "X1", m, known) is None
    assert late_states(schedule, {("X1", LABEL): zones(teams=8)}, "X1", m, known) is None
    # A result of the season before the day is missing from what is known.
    assert late_states(schedule, {("X1", LABEL): zones()}, "X1", m, known[1:]) is None
    # A split season, the play-offs in the list: not a double round robin.
    short = Schedule({("X1", LABEL): LISTED[:-1]})
    assert late_states(short, {("X1", LABEL): zones()}, "X1", m, known) is None


def test_the_features_are_each_side_s_state_own_then_opponent_s() -> None:
    schedule = Schedule({("X1", LABEL): LISTED})
    covered = {("X1", LABEL): zones()}
    term = late_stakes_input(schedule, covered).features
    m, known = match_in(6), results_before(6)
    states = late_states(schedule, covered, "X1", m, known)
    x = term.features_of("X1", m, known)
    assert states is not None and x is not None
    home, away = states[0].vector(), states[1].vector()
    assert tuple(x[0]) == (*home, *away)
    assert tuple(x[1]) == (*away, *home)
    assert any(x[0])  # every read match moves
    assert term.features_of("X1", match_in(0), results_before(0)) is None


def test_a_term_fitted_on_too_few_matches_is_not_read() -> None:
    flags = FeatureInput("flag", "", lambda division, match, known: ((1.0,), (0.0,)))
    guarded = MinimumFit(flags, coefficients=1)
    assert guarded.minimum == 25 and "fewer than 25 matches" in guarded.description
    model = FittedModel(
        date(2025, 1, 1),
        ("A", "B"),
        {"A": 0.0, "B": 0.0},
        {"A": 0.0, "B": 0.0},
        0.2,
        0.0,
        0.0,
        0,
        0.0,
    )
    history = [
        MatchObservation(date(2024, 9, 1) + timedelta(days=i), "A", "B", 2, 1) for i in range(25)
    ]
    thin = guarded.fit("X1", history[:24], date(2025, 1, 1), model)
    assert isinstance(thin, Unread) and thin.shift(history[0], []) is None
    fitted = guarded.fit("X1", history, date(2025, 1, 1), model)
    assert fitted.shift(history[0], []) is not None


def test_our_records_are_read_from_the_records_database_when_named(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(RECORDS_URL, raising=False)
    assert records_url("postgresql://lab") == "postgresql://lab"
    monkeypatch.setenv(RECORDS_URL, "postgresql://records")
    assert records_url("postgresql://lab") == "postgresql://records"


def test_the_input_is_found_and_needs_the_database() -> None:
    assert "late_stakes" in available()
    with pytest.raises(LookupError):
        build(InputContext(None, ("E0",), date(2025, 6, 30)))
