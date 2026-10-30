"""Expected-goals form as an input (T-1652, D-312).

The pure tests need nothing. The store test needs DATABASE_URL and the
migrations (CI has both); it writes two clubs, their bridge, three stored
matches and their figures, and removes them.
"""

import math
import os
import uuid
from collections.abc import Iterator
from dataclasses import replace
from datetime import date, timedelta

import numpy as np
import psycopg
import pytest

from fmip_model.backtest.inputs import judge
from fmip_model.backtest.inputs import run_division as run
from fmip_model.backtest.walk_forward import BacktestMatch
from fmip_model.inputs import InputContext, available, load
from fmip_model.inputs.xg_form import (
    HALF_LIFE_DAYS,
    MIN_MATCHES,
    PSEUDO_MATCHES,
    WINDOW,
    Played,
    StatRow,
    StoredMatch,
    XgHistory,
    features_from,
    form,
    match_stats,
    read_history,
    team_id_of,
    xg_form_input,
)
from fmip_model.model.version import BASELINE
from fmip_model.training.football_data import MatchRow
from fmip_model.training.sources import FOOTBALL_DATA, OUR_RECORDS
from fmip_model.training.store import TrainingStore

DAY = date(2025, 3, 1)
DATABASE_URL = os.environ.get("DATABASE_URL")
needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


def tid(n: int) -> str:
    return str(uuid.UUID(int=n))


def weekly(n: int, xg_for: float, goals_for: int, xg_against: float, goals_against: int,
           *, last: date = DAY - timedelta(days=1)) -> list[Played]:  # fmt: skip
    """``n`` matches a week apart, the newest on ``last``, oldest first."""
    return [
        Played(last - timedelta(days=7 * k), xg_for, goals_for, xg_against, goals_against)
        for k in reversed(range(n))
    ]


def form_of(played: list[Played], day: date = DAY) -> tuple[float, float] | None:
    found = form(played, [p.date for p in played], day)
    return None if found is None else (found.attack, found.defence)


def test_the_input_is_found_by_name_and_needs_the_store() -> None:
    assert "xg_form" in available()
    with pytest.raises(LookupError):
        load("xg_form", InputContext(None, ("E0",), DAY))


# --- the form ----------------------------------------------------------------


def test_a_lucky_side_is_read_below_zero_in_attack_and_an_unlucky_one_above() -> None:
    lucky = weekly(8, xg_for=1.0, goals_for=3, xg_against=1.5, goals_against=0)
    unlucky = weekly(8, xg_for=2.0, goals_for=0, xg_against=0.5, goals_against=2)
    la, ld = form_of(lucky) or (0.0, 0.0)
    ua, ud = form_of(unlucky) or (0.0, 0.0)
    # Scored more than its chances: the goals-based fit overrates its attack.
    assert la < 0 < ua
    # Conceded fewer than the chances against it: the fit overrates its defence.
    assert ud < 0 < ld
    # The features: own attack and the opponent's defence, each side.
    history = XgHistory({tid(1): unlucky, tid(2): lucky}, {})
    features = features_from(history)
    got = features("IR1", BacktestMatch(DAY, tid(1), tid(2), 0, 0), [])
    assert got is not None
    (home_attack, away_defence), (away_attack, home_defence) = got
    assert (home_attack, away_defence) == pytest.approx((ua, ld))
    assert (away_attack, home_defence) == pytest.approx((la, ud))
    # The unlucky home side's goals are to move up, the lucky away side's down.
    assert home_attack > 0 and away_defence > 0 and away_attack < 0 and home_defence < 0


def test_the_mean_is_time_weighted_and_shrunk_by_the_pseudo_count() -> None:
    # Three matches, each HALF_LIFE_DAYS old: weight one half each.
    old = DAY - timedelta(days=HALF_LIFE_DAYS)
    played = [Played(old, 2.0, 1, 1.0, 1) for _ in range(3)]
    attack, defence = form_of(played) or (math.nan, math.nan)
    assert attack == pytest.approx(1.5 / (1.5 + PSEUDO_MATCHES))
    assert defence == 0.0
    # A newer match counts more than an older one with the opposite difference.
    pair = [Played(DAY - timedelta(days=300), 1.0, 0, 1.0, 1),
            Played(DAY - timedelta(days=10), 0.0, 1, 1.0, 1),
            Played(DAY - timedelta(days=5), 1.0, 1, 1.0, 1)]  # fmt: skip
    assert (form_of(pair) or (0.0, 0.0))[0] < 0


def test_few_matches_move_the_form_little_and_only_the_last_ten_are_read() -> None:
    three = form_of(weekly(3, 2.0, 0, 1.0, 1))
    ten = form_of(weekly(10, 2.0, 0, 1.0, 1))
    assert three is not None and ten is not None
    # The same +2 a match: shrunk well below it, and three less than ten.
    assert 0 < three[0] < ten[0] < 2.0
    assert three[0] < 2.0 * 3 / (3 + PSEUDO_MATCHES) + 1e-9
    # An eleventh, older match is outside the window, however large.
    eleven = [Played(DAY - timedelta(days=200), 5.0, 0, 0.0, 9), *weekly(WINDOW, 2.0, 0, 1.0, 1)]
    assert form_of(eleven) == pytest.approx(ten)


def test_fewer_than_three_matches_with_xg_is_no_value_never_zero() -> None:
    assert MIN_MATCHES == 3
    assert form_of(weekly(2, 2.0, 0, 1.0, 1)) is None
    assert form_of([]) is None
    history = XgHistory({tid(1): weekly(5, 1.0, 1, 1.0, 1), tid(2): weekly(2, 1.0, 1, 1.0, 1)}, {})
    features = features_from(history)
    # Either side below three, or a side with no match at all: the match is not read.
    assert features("IR1", BacktestMatch(DAY, tid(1), tid(2), 0, 0), []) is None
    assert features("IR1", BacktestMatch(DAY, tid(3), tid(1), 0, 0), []) is None
    # Even sides with a result exactly as their chances read zero: a reading, not a gap.
    level = XgHistory({tid(1): weekly(5, 1.0, 1, 1.0, 1), tid(2): weekly(5, 2.0, 2, 0.0, 0)}, {})
    assert features_from(level)("IR1", BacktestMatch(DAY, tid(1), tid(2), 0, 0), []) == (
        [0.0, 0.0],
        [0.0, 0.0],
    )


def test_only_matches_strictly_before_the_day_are_read() -> None:
    played = [*weekly(2, 2.0, 0, 1.0, 1, last=DAY - timedelta(days=3)),
              Played(DAY, 3.0, 0, 0.0, 4)]  # fmt: skip
    # The match on the day itself is not before it: two matches, no value.
    assert form_of(played, DAY) is None
    # The next day it is read, and its difference with it.
    with_it = form_of(played, DAY + timedelta(days=1))
    assert with_it is not None
    without = form_of(weekly(3, 2.0, 0, 1.0, 1, last=DAY - timedelta(days=3)),
                      DAY + timedelta(days=1))  # fmt: skip
    assert without is not None and with_it[0] > without[0] and with_it[1] < without[1]


# --- matching the figures to the stored matches ------------------------------


def stored(division: str, day: date, home: str, away: str, hg: int, ag: int) -> StoredMatch:
    return StoredMatch(division, day, home, away, hg, ag)


def stat(n: int, day: date, home: str, away: str, hx: float, ax: float) -> StatRow:
    return StatRow(tid(1000 + n), day, home, away, hx, ax)


def test_a_football_data_row_is_matched_through_the_bridge_within_a_day() -> None:
    ars, lee, che = tid(1), tid(2), tid(3)
    aliases = {"E0": {"Arsenal": ars, "Leeds": lee}}
    # Our date is the kick-off's in UTC: a day after the site's local one.
    matches = [stored("E0", DAY, "Arsenal", "Leeds", 2, 1)]
    stats = [stat(1, DAY + timedelta(days=1), ars, lee, 1.4, 0.6)]
    played = match_stats(matches, stats, aliases)
    assert played[ars] == [Played(DAY, 1.4, 2, 0.6, 1)]
    assert played[lee] == [Played(DAY, 0.6, 1, 1.4, 2)]
    # Two days apart is another match; the sides swapped is another match.
    assert match_stats(matches, [stat(1, DAY + timedelta(days=2), ars, lee, 1.4, 0.6)],
                       aliases) == {}  # fmt: skip
    assert match_stats(matches, [stat(1, DAY, lee, ars, 1.4, 0.6)], aliases) == {}
    # A name the bridge does not hold is a gap, never matched by likeness.
    assert match_stats([stored("E0", DAY, "Arsenal", "Chelsea", 2, 1)],
                       [stat(1, DAY, ars, che, 1.4, 0.6)], aliases) == {}  # fmt: skip
    # The same spelling in another division is not bridged by E0's line.
    assert match_stats([stored("E1", DAY, "Arsenal", "Leeds", 2, 1)], stats, aliases) == {}


def test_our_records_name_a_club_by_its_team_id() -> None:
    a, b = tid(1), tid(2)
    assert team_id_of({}, "IR1", a) == a
    assert team_id_of({}, "IR1", "Esteghlal") is None
    played = match_stats([stored("XL", DAY, a, b, 0, 0)], [stat(1, DAY, a, b, 0.9, 1.1)], {})
    assert played[a] == [Played(DAY, 0.9, 0, 1.1, 0)]


def test_the_nearest_date_wins_and_an_ambiguous_match_is_a_gap() -> None:
    a, b = tid(1), tid(2)
    matches = [stored("IR1", DAY, a, b, 1, 0)]
    nearest = match_stats(
        matches, [stat(1, DAY + timedelta(days=1), a, b, 3.0, 3.0), stat(2, DAY, a, b, 1.2, 0.3)],
        {},
    )  # fmt: skip
    assert nearest[a] == [Played(DAY, 1.2, 1, 0.3, 0)]
    # A day before and a day after, equally near: neither.
    both = [stat(1, DAY - timedelta(days=1), a, b, 1.0, 1.0),
            stat(2, DAY + timedelta(days=1), a, b, 2.0, 2.0)]  # fmt: skip
    assert match_stats(matches, both, {}) == {}
    # One figure row claimed by two stored rows (the same pair a day apart): neither.
    twice = [stored("IR1", DAY, a, b, 1, 0), stored("XL", DAY + timedelta(days=1), a, b, 2, 2)]
    assert match_stats(twice, [stat(1, DAY, a, b, 1.0, 1.0)], {}) == {}


# --- the harness -------------------------------------------------------------

TEAMS = [tid(i + 1) for i in range(20)]
START = date(2023, 8, 1)


def simulate(effect: float, seed: int) -> tuple[list[BacktestMatch], XgHistory]:
    """Three matches a day between six of twenty clubs drawn at random. Each
    match's xG is its true rate; the goals are Poisson around it, moved by
    ``effect`` times the side's features (own attack, the opponent's defence) read
    from the matches before the day."""
    rng = np.random.default_rng(seed)
    strength = {t: float(rng.normal(0, 0.3)) for t in TEAMS}
    played: dict[str, list[Played]] = {t: [] for t in TEAMS}
    matches: list[BacktestMatch] = []
    for d in range(360):
        day = START + timedelta(days=d)
        order = rng.permutation(TEAMS)
        today: list[tuple[str, str, float, float, int, int]] = []
        for k in range(3):
            home, away = str(order[2 * k]), str(order[2 * k + 1])
            xh = math.exp(0.35 + strength[home] - strength[away])
            xa = math.exp(0.1 + strength[away] - strength[home])
            fh = form(played[home], [p.date for p in played[home]], day)
            fa = form(played[away], [p.date for p in played[away]], day)
            th = ta = 0.0
            if fh is not None and fa is not None:
                th = effect * (fh.attack + fa.defence)
                ta = effect * (fa.attack + fh.defence)
            hg, ag = int(rng.poisson(xh * math.exp(th))), int(rng.poisson(xa * math.exp(ta)))
            matches.append(BacktestMatch(day, home, away, hg, ag))
            today.append((home, away, xh, xa, hg, ag))
        for home, away, xh, xa, hg, ag in today:
            played[home].append(Played(day, xh, hg, xa, ag))
            played[away].append(Played(day, xa, ag, xh, hg))
    return matches, XgHistory(played, {})


@pytest.mark.parametrize(("effect", "verdict"), [(1.0, "passed"), (0.0, "failed")])
def test_a_planted_effect_passes_and_none_fails(effect: float, verdict: str) -> None:
    matches, history = simulate(effect, seed=7)
    candidate = replace(BASELINE, version="0.9.0", xi=0.004, ridge=0.1)
    window = (matches[360].date, matches[-1].date)
    division = run("T9", "football_data", matches, window, candidate=candidate,
                   model_input=xg_form_input(history), refit_every_days=28)  # fmt: skip
    assert sum(1 for s in division.scores if s.applied) >= 300
    _, groups = judge([division])
    assert groups[0].verdict == verdict, groups[0].reasons


# --- the store ---------------------------------------------------------------

STORE_DAY = date(1997, 3, 1)


def row(division: str, day: date, home: str, away: str, hg: int, ag: int) -> MatchRow:
    result = "H" if hg > ag else "D" if hg == ag else "A"
    return MatchRow(
        division, day, home, away, hg, ag, result, None, None, None, None, None, None,
        None, None, None, None,
    )  # fmt: skip


@pytest.fixture
def world() -> Iterator[tuple[TrainingStore, str, str]]:
    assert DATABASE_URL
    store = TrainingStore.connect(DATABASE_URL)
    alpha, beta = str(uuid.uuid4()), str(uuid.uuid4())
    fixtures = [str(uuid.uuid4()) for _ in range(4)]
    with store.conn.cursor() as cur:
        for team, name in ((alpha, "T7 Alpha"), (beta, "T7 Beta")):
            cur.execute(
                "INSERT INTO team (id, name, kind, gender) VALUES (%s, %s, 'club', 'men')",
                (team, name),
            )
        cur.execute(
            "INSERT INTO training.team_alias (team_id, division, training_name) VALUES"
            " (%s, 'T7', 'Alpha'), (%s, 'T7', 'Beta')",
            (alpha, beta),
        )
    store.conn.commit()
    load = store.open_load(FOOTBALL_DATA, "T7 1996/97", "test")
    d0 = STORE_DAY - timedelta(days=21)
    store.upsert_matches(
        load,
        "1996/97",
        [
            row("T7", d0, "Alpha", "Beta", 3, 0),
            row("T7", d0 + timedelta(days=7), "Beta", "Alpha", 0, 2),
            row("T7", d0 + timedelta(days=14), "Alpha", "Beta", 1, 1),
            row("T7", STORE_DAY + timedelta(days=1), "Beta", "Alpha", 5, 0),  # after the day
        ],
    )
    store.close_load(load, content_sha256="test", row_count=4)
    stats_load = store.open_load(OUR_RECORDS, "t1652-test", "test")
    comp = str(uuid.uuid4())
    with store.conn.cursor() as cur:
        # Our dates a day after the site's (UTC), the last one after the day.
        for fixture, day, home, away, hx, ax in (
            (fixtures[0], d0 + timedelta(days=1), alpha, beta, 1.0, 1.0),
            (fixtures[1], d0 + timedelta(days=8), beta, alpha, 1.5, 0.5),
            (fixtures[2], d0 + timedelta(days=15), alpha, beta, 2.0, 0.2),
            (fixtures[3], STORE_DAY + timedelta(days=2), beta, alpha, 0.1, 0.1),
        ):
            cur.execute(
                "INSERT INTO training.fixture_stat (fixture_id, source_load_id, source,"
                " competition_id, competition_kind, competition_scope, division, season,"
                " match_date, home_team_id, away_team_id, home_xg, away_xg)"
                " VALUES (%s, %s, 'api_football', %s, 'league', 'domestic', 'T7', '1996/97',"
                " %s, %s, %s, %s, %s)",
                (fixture, stats_load, comp, day, home, away, hx, ax),
            )
    store.close_load(stats_load, content_sha256="test", row_count=4)
    store.conn.commit()
    yield store, alpha, beta
    store.conn.rollback()
    with store.conn.cursor() as cur:
        cur.execute("DELETE FROM training.fixture_stat WHERE fixture_id = ANY(%s::uuid[])",
                    (fixtures,))  # fmt: skip
        cur.execute("DELETE FROM training.match WHERE division = 'T7'")
        cur.execute("DELETE FROM training.source_load WHERE scope IN ('T7 1996/97', 't1652-test')")
        cur.execute("DELETE FROM training.team_alias WHERE division = 'T7'")
        cur.execute("DELETE FROM team WHERE id = ANY(%s::uuid[])", ([alpha, beta],))
    store.conn.commit()
    store.close()


@needs_db
def test_the_store_is_read_through_the_bridge_up_to_the_day(
    world: tuple[TrainingStore, str, str],
) -> None:
    store, alpha, beta = world
    assert DATABASE_URL
    with psycopg.connect(DATABASE_URL) as conn:
        history = read_history(conn, STORE_DAY)
    # Three matches before the day, each matched a day apart; the one after is not read.
    assert [p.goals_for for p in history.played[alpha]] == [3, 2, 1]
    assert [p.xg_for for p in history.played[alpha]] == [1.0, 0.5, 2.0]
    assert history.form("T7", "Alpha", STORE_DAY) is not None
    assert history.form("T7", "Beta", STORE_DAY) is not None
    assert history.form("T7", "Gamma", STORE_DAY) is None
