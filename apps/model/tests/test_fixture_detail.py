"""Our records' team statistics and line-ups in the training store (T-1647, T-1648, D-305).

The pure half needs nothing. The loads need DATABASE_URL, the catalogue and
the training schema; they write a cup kept out of the training store's results
(D-304) with two clubs, three fixtures and their statistics and line-ups, and
remove all of it afterwards. A load replaces every row of its table, so the
assertions read the test's fixtures only.
"""

import os
import uuid
from collections.abc import Iterator
from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import NamedTuple

import pytest
from psycopg.conninfo import conninfo_to_dict

from fmip_model.training.fixture_detail import (
    LINEUPS,
    STATS,
    Conn,
    Coverage,
    connect_reader,
    content_line,
    format_coverage,
    read_coverage,
    share,
    total,
)
from fmip_model.training.load import load_records_detail, target_database
from fmip_model.training.store import TrainingStore

DATABASE_URL = os.environ.get("DATABASE_URL")


def test_a_figure_not_supplied_and_a_zero_are_different_content() -> None:
    fixture = uuid.UUID("00000000-0000-4000-8000-000000000001")
    line = content_line((fixture, None, 0, Decimal("1.85"), True, date(2024, 8, 21)))
    assert line == f"{fixture}\t\t0\t1.85\tTrue\t2024-08-21\n"
    assert content_line((None,)) != content_line((0,))


def test_the_tables_columns_are_the_loads_columns() -> None:
    # Each SELECT feeds a COPY in this order: one name per selected value.
    assert len(STATS.columns) == 16 and STATS.columns[0] == "fixture_id"
    assert len(LINEUPS.columns) == 14 and LINEUPS.columns[:3] == (
        "fixture_id",
        "team_id",
        "person_id",
    )
    # A scope is never a division code, so the records refresh never reads it as one.
    assert all("_" in d.scope for d in (STATS, LINEUPS))


def test_coverage_counts_against_finished_matches_and_says_when_there_are_none() -> None:
    rows = [
        Coverage("League", "E0", "2024/25", 380, 370, 250, 360, 375, 300),
        Coverage("Cup", None, "2024/25", 0, 0, 0, 0, 0, 0),
    ]
    assert share(250, 380) == "66%" and share(0, 0) == "-"
    everything = total(rows)
    assert (everything.finished, everything.with_xg, everything.with_minutes) == (380, 250, 300)
    lines = format_coverage(rows).splitlines()
    assert lines[0].split("\t") == [
        "competition",
        "division",
        "season",
        "finished",
        "stats",
        "xg",
        "shots",
        "lineups",
        "minutes",
    ]
    assert lines[1].split("\t")[:6] == ["League", "E0", "2024/25", "380", "370 (97%)", "250 (66%)"]
    assert lines[2].split("\t")[1:5] == ["-", "2024/25", "0", "0 (-)"]
    assert lines[3].startswith("all\t-\t-\t380\t")


def test_a_load_into_the_lab_keeps_the_server_and_names_the_lab() -> None:
    url = "postgresql://fmip:secret@postgres:5432/fmip"
    assert target_database(url, None) == url
    lab = conninfo_to_dict(target_database(url, "fmip_lab"))
    assert (lab["dbname"], lab["host"], lab["port"], lab["user"]) == (
        "fmip_lab",
        "postgres",
        "5432",
        "fmip",
    )


needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


class World(NamedTuple):
    store: TrainingStore
    reader: Conn
    ids: dict[str, str]


KEYS = (
    "comp",
    "season",
    "home",
    "away",
    "f1",
    "f2",
    "f3",
    "f1h",
    "f1a",
    "f2h",
    "f2a",
    "f3h",
    "f3a",
    "keeper",
    "sub_on",
    "sub_unused",
    "away_starter",
)


@pytest.fixture
def world() -> Iterator[World]:
    assert DATABASE_URL
    s = TrainingStore.connect(DATABASE_URL)
    reader = connect_reader(DATABASE_URL)
    ids = {k: str(uuid.uuid4()) for k in KEYS}
    fixtures = [ids["f1"], ids["f2"], ids["f3"]]
    people = [ids["keeper"], ids["sub_on"], ids["sub_unused"], ids["away_starter"]]
    with s.conn.cursor() as cur:
        cur.execute("SELECT id::text FROM training.source_load")
        loads_before = [str(r[0]) for r in cur.fetchall()]
        # A cup kept out of the training store's results (D-304): the lab still gets it.
        cur.execute(
            "INSERT INTO competition (id, name, kind, scope, gender, model_training)"
            " VALUES (%s, 'Z6 detail test', 'cup', 'continental', 'men', false)",
            (ids["comp"],),
        )
        cur.execute(
            "INSERT INTO season (id, competition_id, label, start_date, end_date)"
            " VALUES (%s, %s, '2024/25', '2024-08-01', '2025-05-31')",
            (ids["season"], ids["comp"]),
        )
        cur.execute(
            "INSERT INTO team (id, name, kind, gender) VALUES"
            " (%s, 'Z6 Home', 'club', 'men'), (%s, 'Z6 Away', 'club', 'men')",
            (ids["home"], ids["away"]),
        )
        for person in people:
            cur.execute("INSERT INTO person (id, full_name) VALUES (%s, 'Z6 player')", (person,))
        for fixture, status, kickoff in (
            # 23:30 in Buenos Aires is the next day in UTC.
            (ids["f1"], "finished", "2024-08-20T23:30:00-03:00"),
            (ids["f2"], "finished", "2024-08-27T19:00:00Z"),
            (ids["f3"], "scheduled", "2025-05-20T19:00:00Z"),
        ):
            cur.execute(
                "INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES (%s, %s, %s, %s)",
                (fixture, ids["season"], kickoff, status),
            )
        for key in ("f1", "f2", "f3"):
            cur.execute(
                "INSERT INTO fixture_participant (id, fixture_id, team_id, side) VALUES"
                " (%s, %s, %s, 'home'), (%s, %s, %s, 'away')",
                (ids[f"{key}h"], ids[key], ids["home"], ids[f"{key}a"], ids[key], ids["away"]),
            )
        for participant, metric, value in (
            (ids["f1h"], "expected_goals", 1.85),
            (ids["f1h"], "shots", 14),
            (ids["f1h"], "shots_on_target", 5),
            (ids["f1h"], "possession_pct", 55),
            # The away side: shots, none on target (a zero), and no xG supplied.
            (ids["f1a"], "shots", 9),
            (ids["f1a"], "shots_on_target", 0),
            (ids["f1a"], "possession_pct", 45),
            # Possession alone: none of the three figures, so no row.
            (ids["f2h"], "possession_pct", 50),
            (ids["f2a"], "possession_pct", 50),
            # Not finished: no row.
            (ids["f3h"], "expected_goals", 0.4),
        ):
            cur.execute(
                "INSERT INTO fixture_stat (participant_id, metric, value) VALUES (%s, %s, %s)",
                (participant, metric, value),
            )
        for participant, person, role, position in (
            (ids["f1h"], ids["keeper"], "starter", "goalkeeper"),
            (ids["f1h"], ids["sub_on"], "bench", "forward"),
            (ids["f1h"], ids["sub_unused"], "bench", "defender"),
            (ids["f1a"], ids["away_starter"], "starter", None),
            (ids["f3h"], ids["keeper"], "starter", "goalkeeper"),
        ):
            cur.execute(
                "INSERT INTO lineup (participant_id, person_id, role, position)"
                " VALUES (%s, %s, %s, %s)",
                (participant, person, role, position),
            )
        # Minutes for the home side only; the unused substitute has none.
        for person, minutes in ((ids["keeper"], 90), (ids["sub_on"], 20)):
            cur.execute(
                "INSERT INTO fixture_player_stat (participant_id, person_id, metric, value)"
                " VALUES (%s, %s, 'minutes', %s), (%s, %s, 'rating', 7.1)",
                (ids["f1h"], person, minutes, ids["f1h"], person),
            )
    s.conn.commit()
    yield World(s, reader, ids)
    reader.close()
    with s.conn.cursor() as cur:
        cur.execute(
            "SELECT id::text FROM training.source_load"
            " WHERE scope IN ('fixture_stat', 'fixture_lineup') AND NOT (id::text = ANY(%s))",
            (loads_before,),
        )
        loads = [str(r[0]) for r in cur.fetchall()]
        for table in ("fixture_stat", "fixture_lineup"):
            cur.execute(
                f"DELETE FROM training.{table} WHERE source_load_id = ANY(%s::uuid[])",  # noqa: S608
                (loads,),
            )
        cur.execute("DELETE FROM training.source_load WHERE id = ANY(%s::uuid[])", (loads,))
        # The participants, statistics and line-ups go with their fixtures.
        cur.execute("DELETE FROM fixture WHERE id = ANY(%s::uuid[])", (fixtures,))
        cur.execute("DELETE FROM season WHERE id = %s", (ids["season"],))
        cur.execute("DELETE FROM competition WHERE id = %s", (ids["comp"],))
        cur.execute("DELETE FROM team WHERE id = ANY(%s::uuid[])", ([ids["home"], ids["away"]],))
        cur.execute("DELETE FROM person WHERE id = ANY(%s::uuid[])", (people,))
    s.conn.commit()
    s.close()


def rows_of(store: TrainingStore, sql: str, *args: object) -> list[tuple[object, ...]]:
    with store.conn.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall()


@needs_db
def test_team_statistics_are_copied_with_gaps_and_zeros_as_they_are(world: World) -> None:
    store, reader, ids = world
    first = load_records_detail(store, reader, STATS)
    second = load_records_detail(store, reader, STATS)
    assert (first.status, first.source, first.scope) == ("succeeded", "our_records", "fixture_stat")
    assert first.content_sha256 == second.content_sha256 and first.row_count >= 1

    rows = rows_of(
        store,
        "SELECT fixture_id::text, source, competition_id::text, competition_kind,"
        " competition_scope, division, season, match_date, home_team_id::text,"
        " away_team_id::text, home_xg, away_xg, home_shots, away_shots,"
        " home_shots_on_target, away_shots_on_target, source_load_id::text"
        " FROM training.fixture_stat WHERE competition_id = %s",
        ids["comp"],
    )
    # One row: f2 had possession alone and f3 is not finished. The away xG was
    # not supplied (None) and its shots on target were none (0).
    assert rows == [
        (
            ids["f1"],
            "api_football",
            ids["comp"],
            "cup",
            "continental",
            None,
            "2024/25",
            date(2024, 8, 21),
            ids["home"],
            ids["away"],
            Decimal("1.85"),
            None,
            14,
            9,
            5,
            0,
            second.load_id,
        )
    ]
    load = rows_of(
        store,
        "SELECT source, url, licence_url, row_count FROM training.source_load WHERE id = %s",
        second.load_id,
    )
    # The feed's terms, as every load of our records names them (D-083).
    assert load == [
        (
            "our_records",
            "records:public.fixture_stat",
            "https://api-sports.io/terms",
            second.row_count,
        )
    ]

    # The records change: the next load replaces the row, and its hash differs.
    with store.conn.cursor() as cur:
        cur.execute(
            "DELETE FROM fixture_stat WHERE participant_id = %s AND metric = 'expected_goals'",
            (ids["f1h"],),
        )
    store.conn.commit()
    third = load_records_detail(store, reader, STATS)
    assert third.content_sha256 != second.content_sha256
    assert rows_of(
        store,
        "SELECT home_xg, home_shots FROM training.fixture_stat WHERE fixture_id = %s",
        ids["f1"],
    ) == [(None, 14)]


@needs_db
def test_line_ups_are_copied_player_by_player_and_a_match_without_one_is_a_gap(
    world: World,
) -> None:
    store, reader, ids = world
    result = load_records_detail(store, reader, LINEUPS)
    assert (result.status, result.scope) == ("succeeded", "fixture_lineup")
    rows = rows_of(
        store,
        "SELECT fixture_id::text, team_id::text, person_id::text, side, competition_kind,"
        " season, match_date, started, minutes, position, source"
        " FROM training.fixture_lineup WHERE competition_id = %s ORDER BY side, minutes",
        ids["comp"],
    )
    day = date(2024, 8, 21)
    # f1 only: f2 has no line-up (no rows, not a default XI), f3 is not finished.
    assert rows == [
        (ids["f1"], ids["away"], ids["away_starter"], "away", "cup", "2024/25", day)
        + (True, None, None, "api_football"),
        (ids["f1"], ids["home"], ids["sub_on"], "home", "cup", "2024/25", day)
        + (False, 20, "forward", "api_football"),
        (ids["f1"], ids["home"], ids["keeper"], "home", "cup", "2024/25", day)
        + (True, 90, "goalkeeper", "api_football"),
        # Did not come on: no minutes in our records, so none here, not 0.
        (ids["f1"], ids["home"], ids["sub_unused"], "home", "cup", "2024/25", day)
        + (False, None, "defender", "api_football"),
    ]


@needs_db
def test_a_load_that_finds_nothing_is_refused_and_keeps_the_rows_held(world: World) -> None:
    store, reader, ids = world
    load_records_detail(store, reader, STATS)
    nothing = replace(STATS, select=STATS.select + " LIMIT 0")
    with pytest.raises(ValueError, match="no finished match with team statistics"):
        load_records_detail(store, reader, nothing)
    failed = rows_of(
        store,
        "SELECT status FROM training.source_load WHERE scope = 'fixture_stat'"
        " ORDER BY started_at DESC LIMIT 1",
    )
    assert failed == [("failed",)]
    held = rows_of(
        store, "SELECT count(*) FROM training.fixture_stat WHERE fixture_id = %s", ids["f1"]
    )
    assert held == [(1,)]


@needs_db
def test_coverage_counts_a_match_only_when_both_sides_have_the_figure(world: World) -> None:
    store, reader, ids = world
    load_records_detail(store, reader, STATS)
    load_records_detail(store, reader, LINEUPS)
    ours = [c for c in read_coverage(store.conn) if c.competition == "Z6 detail test"]
    # Two finished matches (f3 is scheduled); f1 has statistics, shots and both
    # line-ups, but xG and minutes for one side only.
    assert ours == [Coverage("Z6 detail test", None, "2024/25", 2, 1, 0, 1, 1, 0)]
    assert [c for c in read_coverage(store.conn, "2025") if c.competition == "Z6 detail test"] == []
