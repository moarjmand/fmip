"""Rest with what comes next as an input (T-1656, D-307)."""

from dataclasses import replace
from datetime import date, timedelta
from itertools import pairwise

import numpy as np
import pytest

from fmip_model.backtest.inputs import judge
from fmip_model.backtest.inputs import run_division as run
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import InputContext, available, load
from fmip_model.inputs.rest import ClubKeys
from fmip_model.inputs.rest_next import (
    ABROAD,
    CUP,
    EUROPEAN,
    NextSchedule,
    StoredMatch,
    countries,
    division_country,
    features_from,
    kind_of,
    rest_next_input,
    season_of,
    season_runs,
)
from fmip_model.model.version import BASELINE

#: A Saturday in 2025/26.
D = date(2025, 9, 13)


def day(offset: int) -> date:
    return D + timedelta(days=offset)


def league(home: str, away: str, offset: int, division: str = "E0") -> StoredMatch:
    return StoredMatch(division, day(offset), home, away)


def cross(home: str, away: str, offset: int) -> StoredMatch:
    return StoredMatch("XL", day(offset), home, away)


KEYS = ClubKeys(
    {"E0": {"Arsenal": "ars", "Chelsea": "che", "Fulham": "ful", "Brentford": "bre"}}
)  # fmt: skip

#: Arsenal play Barcelona three days after Saturday; Chelsea have nothing in the
#: four days after; Brentford's first stored match is Saturday's; a lower-division
#: club met in the cup gives the season's domestic cup.
STORE = [
    league("ars", "che", -7),
    league("ful", "bre", 7),
    league("bar", "sev", -6, "SP1"),
    cross("bar", "ars", 3),
    cross("che", "low", 20),
]


def schedule(matches: list[StoredMatch] = STORE, horizon: int = 60) -> NextSchedule:
    return NextSchedule(matches, day(horizon))


def match(home: str, away: str, offset: int = 0) -> BacktestMatch:
    return BacktestMatch(day(offset), home, away, 0, 0)


def test_the_input_is_found_by_name_and_needs_the_store() -> None:
    assert "rest_next" in available()
    with pytest.raises(LookupError):
        load("rest_next", InputContext(None, ("E0",), D))


def test_a_european_match_three_days_later_is_read_and_none_is_zero() -> None:
    f = features_from(schedule(), KEYS)
    # [short, short opp, extra, extra opp, european, european opp, cup, cup opp]
    home, away = [0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    assert f("E0", match("Arsenal", "Chelsea"), []) == (home, away)
    # Chelsea's cup match is 20 days away: nothing next for either of them on day 4.
    # Arsenal, away, played Barcelona on day 3: a short rest, read as the opponent's.
    assert f("E0", match("Chelsea", "Arsenal", 4), []) == (
        [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    )


def test_the_look_ahead_is_four_days_and_never_the_match_day() -> None:
    f = features_from(schedule(), KEYS)
    on = f("E0", match("Arsenal", "Chelsea", -1), [])  # Barcelona four days after
    off = f("E0", match("Arsenal", "Chelsea", -2), [])  # five days after
    assert on is not None and on[0][4] == 1.0
    assert off is not None and off[0][4] == 0.0
    # A match on the day itself is neither before nor after.
    same = schedule([*STORE, cross("ars", "bar", 0)])
    assert features_from(same, KEYS)("E0", match("Arsenal", "Chelsea"), []) == f(
        "E0", match("Arsenal", "Chelsea"), []
    )


def test_a_cup_match_in_the_four_days_is_read_as_a_cup() -> None:
    s = schedule([*STORE, cross("che", "low", 2)])
    x = features_from(s, KEYS)("E0", match("Arsenal", "Chelsea"), [])
    assert x is not None
    assert (x[0][4], x[0][6], x[1][4], x[1][6]) == (1.0, 0.0, 0.0, 1.0)


def test_a_side_with_no_earlier_match_is_not_read() -> None:
    f = features_from(schedule(), KEYS)
    # Brentford's first stored match is on day 7: on day 0 it has no rest value.
    assert f("E0", match("Arsenal", "Brentford"), []) is None
    assert f("E0", match("Brentford", "Arsenal"), []) is None


def test_an_unbridged_side_or_a_cup_match_is_not_read() -> None:
    f = features_from(schedule(), KEYS)
    assert f("E0", match("Arsenal", "Leeds"), []) is None  # no team id: its cups unseen
    assert f("XL", match("Arsenal", "Chelsea"), []) is None  # a cup's next match may hang on it


def test_the_stores_end_and_a_season_without_its_cups_are_not_read() -> None:
    f = features_from(schedule(horizon=3), KEYS)  # the store ends inside the four days
    assert f("E0", match("Arsenal", "Chelsea"), []) is None
    assert features_from(schedule(horizon=4), KEYS)("E0", match("Arsenal", "Chelsea"), [])
    # No domestic cup stored for England in 2025/26: the zeros would be missing data.
    no_cup = schedule([m for m in STORE if m.away != "low"])
    assert features_from(no_cup, KEYS)("E0", match("Arsenal", "Chelsea"), []) is None
    # No European match stored for England in 2025/26 either way.
    no_europe = schedule([m for m in STORE if m.home != "bar" or m.division != "XL"])
    assert features_from(no_europe, KEYS)("E0", match("Arsenal", "Chelsea"), []) is None


def test_an_unclassified_match_in_the_four_days_is_not_read() -> None:
    # "twice" has league matches in two countries: a cup or European match, not known which.
    s = schedule([*STORE, league("twice", "ful", -20), league("twice", "sev", -21, "SP1"),
                  cross("che", "twice", 2)])  # fmt: skip
    assert s.countries["twice"] is None and s.kinds["unclassified"] == 1
    f = features_from(s, KEYS)
    assert f("E0", match("Arsenal", "Chelsea"), []) is None
    # ...but only for the side that plays it, and only in its four days.
    later = f("E0", match("Arsenal", "Chelsea", 4), [])
    assert later is not None


def test_a_matchs_kind_comes_from_its_clubs_countries() -> None:
    assert division_country("E0") == division_country("E1") == division_country("EC") == "E"
    assert division_country("SC0") == "SC" and division_country("IR1") == "IR"
    assert division_country("XL") is None and division_country("Premier") is None
    c = countries(
        [
            league("ars", "che", 0),
            league("che", "lee", 1, "E1"),
            league("bar", "sev", 0, "SP1"),
            league("twice", "ars", 2),
            league("twice", "bar", 3, "SP1"),
            cross("ars", "low", 5),  # a lower-division club met at home: English
            cross("che", "low", 9),
            cross("ars", "zag", 6),  # met clubs of two countries: plays abroad
            cross("bar", "zag", 10),
            cross("lask", "sev", 11),  # one tie against Spain: read as Spanish (D-307)
        ]
    )
    assert c["ars"] == c["che"] == c["lee"] == c["low"] == "E"
    assert c["zag"] == ABROAD and c["twice"] is None and c["lask"] == "SP"
    assert kind_of(c["ars"], c["bar"]) == EUROPEAN
    assert kind_of(c["ars"], c["low"]) == CUP
    assert kind_of(c["ars"], c["zag"]) == EUROPEAN
    assert kind_of(c["ars"], c["twice"]) is None


def test_seasons_run_from_july() -> None:
    assert season_of(date(2025, 7, 1)) == 2025 and season_of(date(2025, 6, 30)) == 2024
    assert season_runs([2020, 2021, 2022, 2024]) == "2020/21-2022/23, 2024/25"
    assert season_runs([]) == "none"
    assert "E 2025/26" in rest_next_input(schedule(), KEYS, ("E0", "E1")).description


TEAMS = [f"C{i}" for i in range(24)]
ABROAD_CLUBS = [f"F{i}" for i in range(8)]
LOWER = [f"L{i}" for i in range(4)]
START = date(2024, 8, 1)


def simulate(effect: float, seed: int) -> tuple[list[BacktestMatch], NextSchedule]:
    """Three league matches a day between six of 24 clubs drawn at random; each
    club has a European match on any day with probability 0.12, against a club
    of another league, and a cup match against a lower-division club each
    season. A side with a European match in the four days after has its log
    expected goals moved by ``effect``."""
    rng = np.random.default_rng(seed)
    strength = {t: float(rng.normal(0, 0.35)) for t in TEAMS}
    stored = [StoredMatch("S9", START, f, g) for f, g in pairwise(ABROAD_CLUBS)]
    europe: dict[str, set[int]] = {t: set() for t in TEAMS}
    for t in TEAMS:
        for d in range(370):
            if rng.random() < 0.12:
                europe[t].add(d)
                opponent = str(rng.choice(ABROAD_CLUBS))
                stored.append(StoredMatch("XL", START + timedelta(days=d), t, opponent))
    for d in (5, 340):  # a domestic cup tie in each season
        stored += [
            StoredMatch("XL", START + timedelta(days=d), str(rng.choice(TEAMS)), lo) for lo in LOWER
        ]
    matches: list[BacktestMatch] = []
    for d in range(360):
        today = START + timedelta(days=d)
        order = rng.permutation(TEAMS)
        for k in range(3):
            home, away = str(order[2 * k]), str(order[2 * k + 1])
            th = effect if any(d < e <= d + 4 for e in europe[home]) else 0.0
            ta = effect if any(d < e <= d + 4 for e in europe[away]) else 0.0
            lam = np.exp(0.1 + 0.25 + strength[home] - strength[away] + th)
            mu = np.exp(0.1 + strength[away] - strength[home] + ta)
            matches.append(
                BacktestMatch(today, home, away, int(rng.poisson(lam)), int(rng.poisson(mu)))
            )
            stored.append(StoredMatch("T9", today, home, away))
    return matches, NextSchedule(stored, START + timedelta(days=400))


@pytest.mark.parametrize(("effect", "verdict"), [(-0.7, "passed"), (0.0, "failed")])
def test_a_planted_rotation_effect_passes_and_none_fails(effect: float, verdict: str) -> None:
    matches, schedule_ = simulate(effect, seed=1656)
    candidate = replace(BASELINE, version="0.9.0", xi=0.004, ridge=0.1)
    window = (matches[360].date, matches[-1].date)
    keys = ClubKeys({"T9": {t: t for t in TEAMS}})
    model_input = rest_next_input(schedule_, keys, ("T9",))
    division = run("T9", "football_data", matches, window, candidate=candidate,
                   model_input=model_input, refit_every_days=28)  # fmt: skip
    _, groups = judge([division])
    assert groups[0].verdict == verdict, groups[0].reasons
