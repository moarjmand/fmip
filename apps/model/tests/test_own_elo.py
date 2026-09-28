"""Our own Elo (T-921, D-111): the rules, the bridge, and a day recomputed from the store.

The pure tests need nothing. The store tests need DATABASE_URL and migration
1764850000000; they write divisions T8 and T9 in 1999, so they never meet real
loads, and remove everything afterwards.
"""

import os
import uuid
from collections.abc import Iterator
from datetime import date, timedelta
from decimal import Decimal

import psycopg
import pytest

from fmip_model.model.own_elo import (
    RULES,
    EloMatch,
    compute,
    for_division,
    goal_multiplier,
    matches_digest,
    ordered,
)
from fmip_model.training.football_data import MatchRow
from fmip_model.training.own_elo import (
    compute_day,
    differences,
    main,
    ratings_on,
    store_run,
    stored_run,
)
from fmip_model.training.sources import FOOTBALL_DATA
from fmip_model.training.store import TrainingStore

DATABASE_URL = os.environ.get("DATABASE_URL")
needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")

D = date(2025, 8, 16)


def m(day: int, home: str, away: str, hg: int, ag: int, division: str = "E0") -> EloMatch:
    return EloMatch(division, D + timedelta(days=day), home, away, hg, ag)


def test_a_win_moves_both_sides_by_the_same_amount_and_home_advantage_counts() -> None:
    run = compute([m(0, "a", "b", 1, 0)], D)
    a, b = run.ratings["a"].elo, run.ratings["b"].elo
    assert a > RULES.start > b
    assert round(a - RULES.start, 2) == round(RULES.start - b, 2)
    # Equal clubs, the home side expected to win: a home draw costs it points.
    draw = compute([m(0, "a", "b", 1, 1)], D)
    assert draw.ratings["a"].elo < RULES.start < draw.ratings["b"].elo


def test_a_bigger_margin_moves_more() -> None:
    assert goal_multiplier(0) == goal_multiplier(1) == 1.0
    assert goal_multiplier(2) == 1.5
    assert goal_multiplier(-4) == (11 + 4) / 8
    narrow = compute([m(0, "a", "b", 1, 0)], D).ratings["a"].elo
    wide = compute([m(0, "a", "b", 4, 0)], D).ratings["a"].elo
    assert wide > narrow


def test_only_matches_on_or_before_the_day_are_read_and_clubs_without_one_are_absent() -> None:
    matches = [m(0, "a", "b", 2, 0), m(1, "c", "a", 0, 0), m(5, "d", "e", 1, 0)]
    run = compute(matches, D + timedelta(days=1))
    assert set(run.ratings) == {"a", "b", "c"}  # d and e play later: no row, not 1500
    assert run.match_count == 2
    assert run.first_match_date == D and run.last_match_date == D + timedelta(days=1)
    assert run.ratings["a"].matches == 2
    assert run.ratings["a"].last_match_date == D + timedelta(days=1)


def test_the_order_is_fixed_so_the_same_matches_give_the_same_ratings_and_hash() -> None:
    matches = [m(0, "a", "b", 2, 0), m(0, "c", "d", 0, 1), m(3, "a", "c", 1, 1)]
    one = compute(matches, D + timedelta(days=10))
    two = compute(list(reversed(matches)), D + timedelta(days=10))
    assert one.ratings == two.ratings
    assert one.matches_sha256 == two.matches_sha256 == matches_digest(ordered(matches))
    changed = compute([*matches[:2], m(3, "a", "c", 2, 1)], D + timedelta(days=10))
    assert changed.matches_sha256 != one.matches_sha256


def test_a_division_reads_clubs_through_the_bridge_and_never_by_name() -> None:
    team = "11111111-1111-4111-8111-111111111111"
    ratings = {team: 1600.0, "E0:Everton": 1480.0, "SP1:Everton": 1400.0, "E0:Luton": 1390.0}
    got = for_division(ratings, "E0", {team: "Liverpool"})
    assert got == {"Liverpool": 1600.0, "Everton": 1480.0, "Luton": 1390.0}
    # The same spelling in another division is another club.
    assert for_division(ratings, "SP1", {}) == {"Everton": 1400.0}


# --- the store ---------------------------------------------------------------

DAY = date(1999, 12, 31)


def row(division: str, day: date, home: str, away: str, hg: int, ag: int) -> MatchRow:
    result = "H" if hg > ag else "D" if hg == ag else "A"
    return MatchRow(
        division, day, home, away, hg, ag, result, None, None, None, None, None, None,
        None, None, None, None,
    )  # fmt: skip


@pytest.fixture
def world() -> Iterator[tuple[TrainingStore, str]]:
    assert DATABASE_URL
    store = TrainingStore.connect(DATABASE_URL)
    team = str(uuid.uuid4())
    with store.conn.cursor() as cur:
        cur.execute(
            "INSERT INTO team (id, name, kind, gender) VALUES (%s, 'T9 Alpha', 'club', 'men')",
            (team,),
        )
        cur.execute(
            "INSERT INTO training.team_alias (team_id, division, training_name) VALUES"
            " (%s, 'T9', 'Alpha'), (%s, 'T8', 'Alpha Club')",
            (team, team),
        )
    store.conn.commit()
    load = store.open_load(FOOTBALL_DATA, "T9 1999/00", "test")
    d0 = date(1999, 8, 1)
    store.upsert_matches(
        load,
        "1999/00",
        [
            row("T9", d0, "Alpha", "Gamma", 2, 0),
            row("T9", d0 + timedelta(days=7), "Gamma", "Beta", 1, 1),
            # The same club in another division, through the bridge; and a
            # second "Gamma" there, which is another club.
            row("T8", d0 + timedelta(days=3), "Gamma", "Alpha Club", 0, 3),
            row("T9", DAY + timedelta(days=1), "Beta", "Alpha", 5, 0),  # after the day
        ],
    )
    store.conn.commit()
    store.close_load(load, content_sha256="test", row_count=4)
    yield store, team
    store.conn.rollback()
    with store.conn.cursor() as cur:
        cur.execute("DELETE FROM training.own_elo_run WHERE day <= %s", (DAY,))
        cur.execute("DELETE FROM training.match WHERE division IN ('T8', 'T9')")
        cur.execute("DELETE FROM training.source_load WHERE scope = 'T9 1999/00'")
        cur.execute("DELETE FROM team WHERE id = %s", (team,))
    store.conn.commit()
    store.close()


@needs_db
def test_a_day_is_stored_with_its_matches_and_recomputed_from_the_store(
    world: tuple[TrainingStore, str],
) -> None:
    store, team = world
    run = compute_day(store.conn, DAY)
    # One club through the bridge in both divisions; each Gamma its own.
    assert set(run.ratings) == {team, "T9:Gamma", "T9:Beta", "T8:Gamma"}
    assert run.ratings[team].matches == 2
    assert run.match_count == 3  # the match after the day is not read
    store_run(store.conn, run)

    stored = stored_run(store.conn, DAY)
    assert stored is not None and stored.match_count == 3
    assert stored.matches_sha256 == run.matches_sha256
    # The recomputation: the same stored results give the same day.
    assert differences(stored, compute_day(store.conn, DAY)) == []
    assert main(["verify", "--day", DAY.isoformat()]) == 0

    # Storing the day again replaces its run rather than adding a second.
    store_run(store.conn, compute_day(store.conn, DAY))
    with store.conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM training.own_elo_run WHERE day = %s", (DAY,))
        count = cur.fetchone()
    assert count is not None and count[0] == 1

    # A result that changes under a stored day is found, not absorbed.
    with store.conn.cursor() as cur:
        cur.execute(
            "UPDATE training.match SET home_goals = 0, result = 'D'"
            " WHERE division = 'T9' AND match_date = %s",
            (date(1999, 8, 1),),
        )
    store.conn.commit()
    assert differences(stored, compute_day(store.conn, DAY)) != []
    assert main(["verify", "--day", DAY.isoformat()]) == 1


@needs_db
def test_the_service_computes_the_day_once_and_a_division_reads_it_by_training_name(
    world: tuple[TrainingStore, str],
) -> None:
    from fmip_model.service.store_source import PostgresTrainingSource

    store, team = world
    assert DATABASE_URL
    source = PostgresTrainingSource(DATABASE_URL, clubelo_refresh=False)
    t9 = source.own_elo(DAY, "T9")
    assert set(t9) == {"Alpha", "Gamma", "Beta"}
    assert set(source.own_elo(DAY, "T8")) == {"Alpha Club", "Gamma"}
    assert source.own_elo(DAY, "T8")["Alpha Club"] == t9["Alpha"]
    with psycopg.connect(DATABASE_URL) as conn:
        ratings = ratings_on(conn, DAY)
    assert ratings is not None and Decimal(str(ratings[team])) == Decimal(str(t9["Alpha"]))
