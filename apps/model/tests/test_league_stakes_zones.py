"""League stakes with zones (T-1167, D-171): settled within a band of the committed zones."""

import json
from datetime import date, timedelta
from itertools import permutations
from pathlib import Path

import pytest

from fmip_model.inputs import available
from fmip_model.inputs._zones import REPOSITORY, SeasonZones, parse, read
from fmip_model.inputs.league_stakes import Listed, Schedule
from fmip_model.inputs.league_stakes_zones import (
    league_stakes_zones_input,
    settled,
    zone_stakes,
)
from fmip_model.model.dixon_coles import MatchObservation

TEAMS = ["A", "B", "C", "D", "E", "F"]
START = date(2025, 8, 1)
ORDER = {t: len(TEAMS) - i for i, t in enumerate(TEAMS)}  # A strongest


def double_round_robin(teams: list[str]) -> list[Listed]:
    return [
        Listed(START + timedelta(days=i), h, a) for i, (h, a) in enumerate(permutations(teams, 2))
    ]


def played(fixtures: list[Listed], upto: int) -> list[MatchObservation]:
    return [
        MatchObservation(
            f.date, f.home, f.away, *((1, 0) if ORDER[f.home] > ORDER[f.away] else (0, 1))
        )
        for f in fixtures[:upto]
    ]


def zones(teams: int = 6, complete: bool = True) -> SeasonZones:
    # 1: champion; 2: Champions League; 3-4: open; 5-6: relegation.
    return SeasonZones(
        "X1", "2025/26", teams, (("champions_league", 1, 2), ("relegation", 5, 6)), complete
    )


def test_bands_split_the_champion_the_zones_and_the_runs_between() -> None:
    assert zones().bands() == (0, 1, 2, 2, 3, 3)
    # A zone that does not start at the top leaves the champion's place its own band.
    only_down = SeasonZones("X1", "s", 5, (("relegation", 4, 5),), True)
    assert only_down.bands() == (0, 1, 1, 2, 2)


def test_settled_is_the_same_band_at_best_and_worst() -> None:
    bands = zones().bands()
    points = {"A": 30, "B": 20, "C": 14, "D": 13, "E": 3, "F": 0}
    left = dict.fromkeys(points, 1)
    assert settled("A", points, left, bands)  # champion whatever happens
    assert settled("B", points, left, bands)  # second whatever happens
    # C can finish third or fourth, both open places: settled though not locked.
    assert settled("C", points, left, bands)
    assert settled("D", points, left, bands)
    assert settled("E", points, left, bands)  # down either way
    # With more matches left C can still drop into the relegation places.
    assert not settled("C", points, {**left, "E": 4}, bands)


def test_a_level_finish_counts_against_the_side() -> None:
    bands = zones().bands()
    points = {"A": 30, "B": 20, "C": 17, "D": 13, "E": 3, "F": 0}
    left = {**dict.fromkeys(points, 0), "C": 1}
    # C can reach 20: level with B, which goal difference could turn either way.
    assert not settled("B", points, left, bands)
    assert not settled("C", points, left, bands)


def test_zone_stakes_needs_a_complete_listed_season_of_the_right_size() -> None:
    fixtures = double_round_robin(TEAMS)  # 30 matches, 10 per side
    schedule = Schedule({("X1", "2025/26"): fixtures})
    known = played(fixtures, 25)
    match = fixtures[25]
    listed = {("X1", "2025/26"): zones()}
    assert zone_stakes(schedule, listed, "X1", match, known) is not None
    assert zone_stakes(schedule, {}, "X1", match, known) is None  # not listed: rule 3
    unpublished = {("X1", "2025/26"): zones(complete=False)}
    assert zone_stakes(schedule, unpublished, "X1", match, known) is None
    wrong_size = {("X1", "2025/26"): zones(teams=7)}
    assert zone_stakes(schedule, wrong_size, "X1", match, known) is None
    assert zone_stakes(schedule, listed, "X1", match, known[1:]) is None  # a result missing


def test_the_feature_reads_only_matches_with_a_settled_side() -> None:
    fixtures = double_round_robin(TEAMS)
    feature = league_stakes_zones_input(
        Schedule({("X1", "2025/26"): fixtures}), {("X1", "2025/26"): zones()}
    )
    assert feature.features_of("X1", fixtures[0], []) is None  # nobody settled on day one
    late = feature.features_of("X1", fixtures[29], played(fixtures, 29))
    assert late is not None
    assert "league_stakes_zones" in available()


def test_the_committed_list_parses_and_every_place_is_inside_its_table() -> None:
    listed = read(REPOSITORY)
    assert listed
    for entry in listed.values():
        assert len(entry.bands()) == entry.teams


def test_a_place_past_the_table_is_refused(tmp_path: Path) -> None:
    raw = [
        {
            "division": "X1",
            "season": "2025/26",
            "teams": 18,
            "zones": [{"kind": "relegation", "from": 18, "to": 20}],
            "complete": True,
            "sources": ["https://example.org"],
        }
    ]
    with pytest.raises(ValueError, match="not inside the table"):
        parse(raw)
    path = tmp_path / "zones.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError):
        read(path)
