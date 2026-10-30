"""Regulars missing from the XI as an input (T-1655, D-313).

The rule and the harness on line-ups built here need no database; the store's
read needs DATABASE_URL and the migrated schema, and writes nothing it keeps.
"""

import os
import uuid
from collections.abc import Sequence
from dataclasses import replace
from datetime import date, timedelta

import numpy as np
import pytest

from fmip_model.backtest.inputs import judge, run_division
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import InputContext, available, load
from fmip_model.inputs.regulars_missing import (
    MAX_AGE_DAYS,
    MIN_EARLIER,
    WINDOW,
    Appearance,
    Fixture,
    Lineups,
    TeamIds,
    explain,
    features_from,
    main,
    match_indices,
    read_lineups,
    read_team_ids,
    regulars_missing_input,
)
from fmip_model.model.version import BASELINE

DATABASE_URL = os.environ.get("DATABASE_URL")
D = date(2025, 10, 18)  # the training row's day of the match under test

USUAL = ["gk1"] + [f"p{i}" for i in range(1, 11)]  # the usual XI, keeper first
BENCH = ["gk2"] + [f"b{i}" for i in range(1, 8)]


def side(
    fixture: str,
    team: str,
    day: date,
    starters: Sequence[str],
    subs: dict[str, int] | None = None,
    unused: Sequence[str] = (),
    *,
    starter_minutes: int | None = 90,
) -> list[Appearance]:
    """A side's line-up: each starter's minutes, the substitutes who came on with
    theirs, and the unused ones with none (as the store holds them)."""
    keeper = {"gk1", "gk2", "gk3"}
    rows = [
        Appearance(fixture, team, p, day, True, starter_minutes,
                   "goalkeeper" if p in keeper else "midfielder")
        for p in starters
    ]  # fmt: skip
    rows += [
        Appearance(fixture, team, p, day, False, m, "goalkeeper" if p in keeper else "defender")
        for p, m in (subs or {}).items()
    ]
    rows += [
        Appearance(fixture, team, p, day, False, None, "goalkeeper" if p in keeper else "forward")
        for p in unused
    ]
    return rows


def history(team: str, until: date, n: int = WINDOW, *, prefix: str = "h") -> list[Appearance]:
    """``n`` weekly earlier matches of ``team`` before ``until``: the usual XI, one
    substitute on for twenty minutes, the backup keeper unused."""
    rows: list[Appearance] = []
    for i in range(1, n + 1):
        rows += side(f"{prefix}-{team}-{i}", team, until - timedelta(days=7 * i), USUAL,
                     {"b1": 20}, ["gk2", "b2"])  # fmt: skip
    return rows


def own(home_xi: Sequence[str], away_xi: Sequence[str] = USUAL, day: date = D) -> list[Appearance]:
    """The match's own line-ups: Stuttgart at home to Gladbach."""
    return [
        row
        for team, xi in (("stu", home_xi), ("gla", away_xi))
        for row in side("own", team, day, xi, {"b1": 20}, [p for p in ("gk2",) if p not in xi])
    ]


IDS = TeamIds({"D1": {"Stuttgart": "stu", "M'gladbach": "gla"}})


def indices(rows: list[Appearance], day: date = D) -> tuple[float, float, float, float] | None:
    found = match_indices(
        Lineups(rows), IDS, "D1", BacktestMatch(day, "Stuttgart", "M'gladbach", 0, 0)
    )
    if found is None:
        return None
    h, a = found
    return h.missing, h.keeper_out, a.missing, a.keeper_out


EARLIER = history("stu", D) + history("gla", D)
#: Window minutes: ten matches of eleven starters' 90 and one substitute's 20.
TOTAL = WINDOW * (11 * 90 + 20)


def test_the_input_is_registered_by_name_and_needs_the_store() -> None:
    assert "regulars_missing" in available()
    with pytest.raises(LookupError):
        load("regulars_missing", InputContext(None, ("D1",), D))


def test_full_strength_is_near_zero() -> None:
    found = indices(EARLIER + own(USUAL))
    assert found is not None
    missing, keeper_out, away_missing, away_keeper_out = found
    # Only the substitute's minutes are missing: he is on the bench, not in the XI.
    assert missing == pytest.approx(WINDOW * 20 / TOTAL)
    assert missing < 0.05
    assert keeper_out == 0.0 and away_keeper_out == 0.0 and away_missing == missing


def test_six_changes_raise_the_index() -> None:
    """Stuttgart's six changes before Gladbach (D-303): the rating went up, this must too."""
    rotated = USUAL[:5] + ["b2", "b3", "b4", "b5", "b6", "b7"]
    full = indices(EARLIER + own(USUAL))
    six = indices(EARLIER + own(rotated))
    assert full is not None and six is not None
    assert six[0] == pytest.approx(WINDOW * (6 * 90 + 20) / TOTAL)
    assert six[0] > full[0] + 0.4
    assert six[1] == 0.0  # the keeper still starts
    assert six[2] == full[2]  # the opponent's side is its own


def test_a_goalkeeper_change_raises_the_flag() -> None:
    found = indices(EARLIER + own(["gk2"] + USUAL[1:]))
    assert found is not None
    assert found[1] == 1.0
    assert found[0] == pytest.approx(WINDOW * (90 + 20) / TOTAL)
    assert found[3] == 0.0


def test_keepers_level_on_minutes_raise_the_flag_only_when_neither_starts() -> None:
    shared: list[Appearance] = []
    for i in range(1, WINDOW + 1):
        keeper = "gk1" if i % 2 else "gk2"
        shared += side(f"s-{i}", "stu", D - timedelta(days=7 * i), [keeper] + USUAL[1:])
    rows = shared + history("gla", D)
    one = indices(rows + own(["gk2"] + USUAL[1:]))
    neither = indices(rows + own(["gk3"] + USUAL[1:]))
    assert one is not None and neither is not None
    assert one[1] == 0.0 and neither[1] == 1.0


def test_without_both_stored_xis_the_match_is_not_read() -> None:
    home_only = side("own", "stu", D, USUAL, {"b1": 20})
    assert indices(EARLIER + home_only) is None
    assert indices(EARLIER) is None
    # A stored XI of ten starters is not an XI: its missing man is not rotation.
    assert indices(EARLIER + own(USUAL[:10])) is None
    # A side with fewer than MIN_EARLIER earlier line-ups: never a default.
    few = history("stu", D, MIN_EARLIER - 1) + history("gla", D)
    assert indices(few + own(USUAL)) is None
    enough = history("stu", D, MIN_EARLIER) + history("gla", D)
    assert indices(enough + own(USUAL)) is not None


def test_a_window_without_a_keeper_or_with_partial_minutes_is_not_read() -> None:
    no_keeper: list[Appearance] = []
    for i in range(1, WINDOW + 1):
        no_keeper += side(f"n-{i}", "stu", D - timedelta(days=7 * i), ["gk9"] + USUAL[1:])
    assert indices(no_keeper + history("gla", D) + own(USUAL)) is None  # gk9 has no position
    # Line-ups whose starters have no minutes (statistics not supplied) are skipped.
    partial: list[Appearance] = []
    for i in range(1, WINDOW + 1):
        partial += side(f"q-{i}", "stu", D - timedelta(days=7 * i), USUAL, starter_minutes=None)
    assert indices(partial + history("gla", D) + own(USUAL)) is None


def test_only_line_ups_strictly_before_the_day_are_read() -> None:
    base = history("stu", D, MIN_EARLIER) + history("gla", D)
    rows = base + own(USUAL)
    lineups = Lineups(rows)
    home = lineups.own_fixture("stu", "gla", D)
    assert home is not None
    assert len(lineups.window("stu", home[0], D)) == MIN_EARLIER
    # Another match of the club on the match's own day, or after it, is never read:
    # a different XI there would move nothing.
    later = (side("same-day", "stu", D, BENCH[:1] + USUAL[1:])
             + side("after", "stu", D + timedelta(days=3), BENCH[:1] + USUAL[1:]))  # fmt: skip
    before = indices(rows)
    after = indices(rows + later)
    assert before is not None and after == before
    # The day before is read: a sixth earlier line-up enters the window.
    extra = side("eve", "stu", D - timedelta(days=1), USUAL, {"b1": 20})
    lineups = Lineups(rows + extra)
    home = lineups.own_fixture("stu", "gla", D)
    assert home is not None
    assert len(lineups.window("stu", home[0], D)) == MIN_EARLIER + 1


def test_the_window_stops_at_its_size_and_its_age() -> None:
    lineups = Lineups(history("stu", D, WINDOW + 5) + own(USUAL))
    home = lineups.own_fixture("stu", "gla", D)
    assert home is not None
    window = lineups.window("stu", home[0], D)
    assert len(window) == WINDOW
    assert min(s.day for s in window) == D - timedelta(days=7 * WINDOW)  # the newest ten
    old = side("old", "stu", D - timedelta(days=MAX_AGE_DAYS + 1), USUAL, {"b1": 20})
    edge = side("edge", "stu", D - timedelta(days=MAX_AGE_DAYS), USUAL, {"b1": 20})
    lineups = Lineups(history("stu", D, MIN_EARLIER - 1) + old + own(USUAL))
    home = lineups.own_fixture("stu", "gla", D)
    assert home is not None
    assert len(lineups.window("stu", home[0], D)) == MIN_EARLIER - 1  # a year and a day: out
    lineups = Lineups(history("stu", D, MIN_EARLIER - 1) + edge + own(USUAL))
    home = lineups.own_fixture("stu", "gla", D)
    assert home is not None
    assert len(lineups.window("stu", home[0], D)) == MIN_EARLIER  # a year to the day: in


def test_an_own_fixture_dated_a_day_earlier_is_never_its_own_history() -> None:
    """A late kick-off in Asia: the site's local day is ours plus one."""
    earlier_day = D - timedelta(days=1)
    rows = EARLIER + own(USUAL, day=earlier_day)
    lineups = Lineups(rows)
    pair = lineups.own_fixture("stu", "gla", D)
    assert pair is not None and pair[0].fixture == "own"
    window = lineups.window("stu", pair[0], min(D, pair[0].day))
    assert "own" not in {s.fixture for s in window}
    assert indices(rows) == indices(EARLIER + own(USUAL))


def test_football_data_names_reach_line_ups_through_the_bridge_a_day_apart() -> None:
    """The site dates the match locally; our UTC date may be the next day."""
    next_day = D + timedelta(days=1)
    rows = history("stu", D) + history("gla", D) + own(USUAL, day=next_day)
    features = features_from(Lineups(rows), IDS)
    match = BacktestMatch(D, "Stuttgart", "M'gladbach", 0, 0)
    found = features("D1", match, [])
    assert found is not None
    home, away = found
    assert home[0] == pytest.approx(WINDOW * 20 / TOTAL) and home[0] == away[1]
    # Two days apart is another match, not this one.
    assert features("D1", BacktestMatch(D - timedelta(days=1), "Stuttgart", "M'gladbach", 0, 0),
                    []) is None  # fmt: skip
    # A name the bridge does not hold is a gap, never matched by likeness.
    assert features("D1", BacktestMatch(D, "Stuttgart", "Gladbach", 0, 0), []) is None
    assert features("E0", match, []) is None
    # Our records' rows name clubs by team id, through identity aliases.
    ours = features_from(Lineups(rows), TeamIds({"XL": {"stu": "stu", "gla": "gla"}}))
    assert ours("XL", BacktestMatch(D, "stu", "gla", 0, 0), []) == found


def test_one_match_is_explained_as_the_input_reads_it(monkeypatch: pytest.MonkeyPatch) -> None:
    rotated = USUAL[:5] + ["b2", "b3", "b4", "b5", "b6", "b7"]
    match = Fixture(D, "Stuttgart", "M'gladbach")
    said = explain(Lineups(EARLIER + own(rotated)), IDS, "D1", match)
    assert said == (
        "D1 2025-10-18 Stuttgart v M'gladbach: home index 0.554, keeper out 0, 10 line-ups; "
        "away index 0.020, keeper out 0, 10 line-ups"
    )
    assert "not read" in explain(Lineups(EARLIER), IDS, "D1", match)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert main(["--division", "D1", "--date", "2025-10-18", "--home", "a", "--away", "b"]) == 2


def test_two_stored_fixtures_within_a_day_are_not_guessed_between() -> None:
    twice = (
        own(USUAL)
        + side("again", "stu", D + timedelta(days=1), USUAL)
        + side("again", "gla", D + timedelta(days=1), USUAL)
    )
    assert indices(EARLIER + twice) is None


# The harness on a planted effect -----------------------------------------------------------

CLUBS = [f"C{i}" for i in range(12)]
START = date(2024, 8, 1)


def simulate(effect: float, seed: int) -> tuple[list[BacktestMatch], list[Appearance]]:
    """Six matches every other day between clubs drawn at random; each side changes a
    random number of its usual starters, and its log expected goals move by
    ``effect`` times the share of its recent minutes missing (as the input reads it)."""
    rng = np.random.default_rng(seed)
    strength = {c: float(rng.normal(0, 0.3)) for c in CLUBS}
    fixtures: list[tuple[date, str, str, str]] = []
    rows: list[Appearance] = []
    for d in range(0, 450, 2):
        day = START + timedelta(days=d)
        order = rng.permutation(CLUBS)
        for k in range(len(CLUBS) // 2):
            home, away = str(order[2 * k]), str(order[2 * k + 1])
            fixture = f"f{d}-{k}"
            fixtures.append((day, home, away, fixture))
            for club in (home, away):
                changes = int(rng.choice([0, 0, 1, 2, 4, 6, 8]))
                out = set(rng.choice(10, size=changes, replace=False).tolist())
                xi = [f"{club}-o{i + 1}" for i in range(10) if i not in out]
                xi += [f"{club}-o{11 + j}" for j in range(changes)]
                keeper = f"{club}-gk2" if rng.random() < 0.1 else f"{club}-gk1"
                for p in [keeper, *xi]:
                    pos = "goalkeeper" if "gk" in p else "midfielder"
                    rows.append(Appearance(fixture, club, p, day, True, 90, pos))
    lineups = Lineups(rows)
    keys = TeamIds({"T9": {c: c for c in CLUBS}})
    matches: list[BacktestMatch] = []
    for day, home, away, _ in fixtures:
        found = match_indices(lineups, keys, "T9", BacktestMatch(day, home, away, 0, 0))
        th, ta = (0.0, 0.0) if found is None else (found[0].missing, found[1].missing)
        lam = np.exp(0.1 + 0.25 + strength[home] - strength[away] + effect * th)
        mu = np.exp(0.1 + strength[away] - strength[home] + effect * ta)
        matches.append(BacktestMatch(day, home, away, int(rng.poisson(lam)), int(rng.poisson(mu))))
    return matches, rows


@pytest.mark.parametrize(("effect", "verdict"), [(-2.0, "passed"), (0.0, "failed")])
def test_a_planted_effect_passes_and_none_fails(effect: float, verdict: str) -> None:
    matches, rows = simulate(effect, seed=1655)
    model_input = regulars_missing_input(Lineups(rows), TeamIds({"T9": {c: c for c in CLUBS}}))
    assert model_input.minimum == 100  # four coefficients, 25 matches each (D-313)
    candidate = replace(BASELINE, version="0.9.0", xi=0.004, ridge=0.1)
    window = (matches[500].date, matches[-1].date)
    division = run_division("T9", "football_data", matches, window, candidate=candidate,
                            model_input=model_input, refit_every_days=28)  # fmt: skip
    _, groups = judge([division])
    assert groups[0].verdict == verdict, groups[0].reasons


# The store's read ------------------------------------------------------------------------

needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


@needs_db
def test_the_store_is_read_without_friendlies_or_later_rows_and_the_bridge_by_division() -> None:
    import psycopg

    assert DATABASE_URL
    ids = {k: str(uuid.uuid4()) for k in ("team", "f1", "f2", "f3", "p1", "p2", "comp", "load")}
    with psycopg.connect(DATABASE_URL) as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO training.source_load"
                    " (id, source, scope, url, licence_url, licence_note)"
                    " VALUES (%s, 'our_records', 'fixture_lineup', 'u', 'l', 'n')",
                    (ids["load"],),
                )
                cur.execute(
                    "INSERT INTO team (id, name, kind, gender)"
                    " VALUES (%s, 'Z9 Club', 'club', 'men')",
                    (ids["team"],),
                )
                cur.execute(
                    "INSERT INTO training.team_alias (team_id, division, training_name)"
                    " VALUES (%s, 'Z9', 'Z9 Club')",
                    (ids["team"],),
                )
                for fixture, day, kind, person, started, minutes, position in [
                    ("f1", D, "league", "p1", True, 90, "goalkeeper"),
                    ("f1", D, "league", "p2", False, None, None),
                    ("f2", D, "friendly", "p1", True, 45, "goalkeeper"),
                    ("f3", D + timedelta(days=2), "cup", "p1", True, 90, "goalkeeper"),
                ]:
                    cur.execute(
                        "INSERT INTO training.fixture_lineup (fixture_id, team_id, person_id,"
                        " source_load_id, source, side, competition_id, competition_kind,"
                        " competition_scope, division, season, match_date, started, minutes,"
                        " position) VALUES (%s, %s, %s, %s, 'api_football', 'home', %s, %s,"
                        " 'domestic', NULL, '2025/26', %s, %s, %s, %s)",
                        (ids[fixture], ids["team"], ids[person], ids["load"], ids["comp"], kind,
                         day, started, minutes, position),
                    )  # fmt: skip
            read = [
                r
                for r in read_lineups(conn, D + timedelta(days=1))
                if r.fixture in {ids["f1"], ids["f2"], ids["f3"]}
            ]
            assert sorted((r.person, r.started, r.minutes, r.position) for r in read) == sorted(
                [(ids["p1"], True, 90, "goalkeeper"), (ids["p2"], False, None, None)]
            )
            assert {r.fixture for r in read} == {ids["f1"]} and read[0].day == D
            assert read_team_ids(conn)("Z9", "Z9 Club") == ids["team"]
            assert read_team_ids(conn)("Z8", "Z9 Club") is None
        finally:
            conn.rollback()
    # ``build`` reads the same store on a connection of its own.
    built = load("regulars_missing", InputContext(DATABASE_URL, ("Z9",), D))
    assert built.name == "regulars_missing"
