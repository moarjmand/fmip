"""Our own records as training data (T-512, D-083).

The pure half needs nothing. The load needs DATABASE_URL, the catalogue and
the training schema; it writes a competition set to the test division ``Z9``
with two clubs and three fixtures, and removes all of it afterwards.
"""

import os
import uuid
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import NamedTuple

import pytest

from fmip_model.service.store_source import PostgresTrainingSource
from fmip_model.training.load import load_football_data, load_records
from fmip_model.training.records import RecordedMatch, as_text, by_season, team_ids
from fmip_model.training.store import TrainingStore

DATABASE_URL = os.environ.get("DATABASE_URL")
FOOTBALL_DATA_HEAD = Path(__file__).parent / "fixtures" / "football-data_E0_2425_head.csv"


def match(season: str, day: str, home: str, away: str, hg: int, ag: int) -> RecordedMatch:
    return RecordedMatch(season, date.fromisoformat(day), home, away, hg, ag)


def test_rows_carry_what_the_records_hold_and_nothing_else() -> None:
    matches = [
        match("2024/25", "2024-08-20", "a", "b", 2, 1),
        match("2024/25", "2024-08-27", "b", "a", 0, 0),
        match("2025/26", "2025-08-19", "a", "c", 0, 3),
    ]
    seasons = by_season("IR1", matches)
    assert sorted(seasons) == ["2024/25", "2025/26"]
    assert [r.result for r in seasons["2024/25"]] == ["H", "D"]
    assert seasons["2025/26"][0].result == "A"
    row = seasons["2025/26"][0]
    assert (row.division, row.home_team, row.away_team) == ("IR1", "a", "c")
    # No odds, no shots, no half-time: the records do not carry them here.
    assert row.odds_home is None and row.home_shots is None and row.ht_home_goals is None
    assert team_ids(matches) == ["a", "b", "c"]


def test_the_content_hash_reads_the_matches_not_the_moment() -> None:
    matches = [match("2024/25", "2024-08-20", "a", "b", 2, 1)]
    assert as_text(matches) == as_text(list(matches))
    assert as_text(matches) != as_text([match("2024/25", "2024-08-20", "a", "b", 2, 2)])


needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


class World(NamedTuple):
    store: TrainingStore
    ids: dict[str, str]


@pytest.fixture
def world() -> Iterator[World]:
    assert DATABASE_URL
    s = TrainingStore.connect(DATABASE_URL)
    ids = {k: str(uuid.uuid4()) for k in ("comp", "season", "home", "away", "f1", "f2", "f3")}
    with s.conn.cursor() as cur:
        cur.execute(
            "INSERT INTO competition (id, name, kind, scope, gender, football_data_division)"
            " VALUES (%s, 'Z9 records test', 'league', 'continental', 'men', 'Z9')",
            (ids["comp"],),
        )
        cur.execute(
            "INSERT INTO season (id, competition_id, label, start_date, end_date)"
            " VALUES (%s, %s, '2024/25', '2024-08-01', '2025-05-31')",
            (ids["season"], ids["comp"]),
        )
        cur.execute(
            "INSERT INTO team (id, name, kind, gender) VALUES"
            " (%s, 'Z9 Home', 'club', 'men'), (%s, 'Z9 Away', 'club', 'men')",
            (ids["home"], ids["away"]),
        )
        for fixture, status, kickoff in (
            (ids["f1"], "finished", "2024-08-20T15:00:00Z"),
            (ids["f2"], "scheduled", "2025-05-20T15:00:00Z"),
            (ids["f3"], "finished", "2024-09-01T15:00:00Z"),  # finished, but no full-time score
        ):
            cur.execute(
                "INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES (%s, %s, %s, %s)",
                (fixture, ids["season"], kickoff, status),
            )
            cur.execute(
                "INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES"
                " (%s, %s, 'home'), (%s, %s, 'away')",
                (fixture, ids["home"], fixture, ids["away"]),
            )
        cur.execute(
            "INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES"
            " (%s, 'half_time', 1, 0), (%s, 'full_time', 2, 1), (%s, 'extra_time', 3, 1)",
            (ids["f1"], ids["f1"], ids["f1"]),
        )
    s.conn.commit()
    yield World(s, ids)
    with s.conn.cursor() as cur:
        cur.execute("DELETE FROM training.match WHERE division IN ('Z9', 'T0')")
        cur.execute("DELETE FROM training.team_alias WHERE division = 'Z9'")
        cur.execute("DELETE FROM training.source_load WHERE scope IN ('Z9', 'T0 2024/25')")
        for table in ("fixture_score", "fixture_participant"):
            cur.execute(
                f"DELETE FROM {table} WHERE fixture_id = ANY(%s::uuid[])",  # noqa: S608
                ([ids["f1"], ids["f2"], ids["f3"]],),
            )
        cur.execute(
            "DELETE FROM fixture WHERE id = ANY(%s::uuid[])", ([ids["f1"], ids["f2"], ids["f3"]],)
        )
        cur.execute("DELETE FROM season WHERE id = %s", (ids["season"],))
        cur.execute("DELETE FROM competition WHERE id = %s", (ids["comp"],))
        cur.execute("DELETE FROM team WHERE id = ANY(%s::uuid[])", ([ids["home"], ids["away"]],))
    s.conn.commit()
    s.close()


def one(store: TrainingStore, sql: str, *args: object) -> list[tuple[object, ...]]:
    with store.conn.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall()


@needs_db
def test_a_finished_match_is_learned_under_our_ids_and_their_aliases_are_themselves(
    world: World,
) -> None:
    store, ids = world
    first = load_records(store, ["Z9"])
    second = load_records(store, ["Z9"])
    assert [r.status for r in first + second] == ["succeeded", "succeeded"]
    assert first[0].row_count == 1 and first[0].content_sha256 == second[0].content_sha256

    rows = one(
        store,
        "SELECT season, match_date, home_team, away_team, home_goals, away_goals, odds_home"
        " FROM training.match WHERE division = 'Z9'",
    )
    # The full-time score: not the extra-time one, and the scheduled and
    # unscored fixtures are not results.
    assert rows == [("2024/25", date(2024, 8, 20), ids["home"], ids["away"], 2, 1, None)]
    aliases = one(
        store,
        "SELECT team_id::text, training_name FROM training.team_alias"
        " WHERE division = 'Z9' ORDER BY training_name",
    )
    assert sorted(aliases) == sorted([(ids["home"], ids["home"]), (ids["away"], ids["away"])])
    load = one(
        store,
        "SELECT source, licence_url FROM training.source_load WHERE scope = 'Z9' LIMIT 1",
    )
    assert load == [("our_records", "https://api-sports.io/terms")]


@needs_db
def test_a_division_another_source_holds_is_refused_and_the_refusal_recorded(
    world: World,
) -> None:
    store, ids = world
    text = FOOTBALL_DATA_HEAD.read_text(encoding="utf-8").replace("E0,", "T0,")
    load_football_data(store, ["2425"], ["T0"], fetch=lambda _url: text)
    with store.conn.cursor() as cur:
        cur.execute(
            "UPDATE competition SET football_data_division = 'T0' WHERE id = %s",
            (ids["comp"],),
        )
    store.conn.commit()
    with pytest.raises(ValueError, match="already holds football_data_co_uk rows"):
        load_records(store, ["T0"])
    failed = one(
        store,
        "SELECT status FROM training.source_load WHERE source = 'our_records' AND scope = 'T0'",
    )
    assert failed == [("failed",)]
    with store.conn.cursor() as cur:
        cur.execute(
            "DELETE FROM training.source_load WHERE source = 'our_records' AND scope = 'T0'"
        )
    store.conn.commit()


@needs_db
def test_the_service_refreshes_a_division_of_our_records_once_a_day(world: World) -> None:
    assert DATABASE_URL
    store = world.store
    load_records(store, ["Z9"])
    day = [date(2026, 9, 26)]
    source = PostgresTrainingSource(DATABASE_URL, today=lambda: day[0])

    def loads() -> int:
        return len(one(store, "SELECT 1 FROM training.source_load WHERE scope = 'Z9'"))

    before = loads()
    source.matches("Z9", date(2024, 1, 1), date(2026, 9, 25))
    source.aliases("Z9")
    assert loads() == before + 1  # once, however many reads
    day[0] = date(2026, 9, 27)
    assert len(source.matches("Z9", date(2024, 1, 1), date(2026, 9, 26))) == 1
    assert loads() == before + 2
