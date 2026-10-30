"""Past seasons' absences as training data (T-1650, D-306).

The pure half needs nothing. The load needs DATABASE_URL, the catalogue and
both the public and training schemas; it writes a competition kept out of
training (D-304) with one finished match and two absences, and removes all of
it afterwards.
"""

import os
import uuid
from collections.abc import Iterator
from datetime import date
from typing import NamedTuple

import pytest

from fmip_model.training import absences as absence_history
from fmip_model.training.absences import RecordedAbsence, as_text
from fmip_model.training.fixture_detail import Conn, connect_reader
from fmip_model.training.load import load_absences, main
from fmip_model.training.store import TrainingStore

DATABASE_URL = os.environ.get("DATABASE_URL")


def absence(person: str | None, provider_person: str, status: str = "out") -> RecordedAbsence:
    return RecordedAbsence(
        fixture_id="f",
        competition_id="c",
        season="2023/24",
        match_date=date(2023, 9, 2),
        team_id="t",
        person_id=person,
        provider_person_id=provider_person,
        status=status,
        kind="injury",
    )


def test_the_content_hash_reads_the_absences_and_tells_a_mapped_player_apart() -> None:
    rows = [absence(None, "627")]
    assert as_text(rows) == as_text(list(rows))
    assert as_text(rows) != as_text([absence(None, "627", status="doubtful")])
    # Mapping the player later is a different load of the same history.
    assert as_text(rows) != as_text([absence("p", "627")])
    assert as_text(rows).splitlines()[1].endswith(",627,out,injury")


def test_the_command_takes_no_scope() -> None:
    with pytest.raises(SystemExit):
        main(["records-absences", "--divisions", "E0"])


needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")


class World(NamedTuple):
    store: TrainingStore
    reader: Conn
    ids: dict[str, str]


def one(store: TrainingStore, sql: str, *args: object) -> list[tuple[object, ...]]:
    with store.conn.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall()


@pytest.fixture
def world() -> Iterator[World]:
    assert DATABASE_URL
    s = TrainingStore.connect(DATABASE_URL)
    keys = ("comp", "season", "home", "away", "person", "fixture")
    ids = {k: str(uuid.uuid4()) for k in keys}
    with s.conn.cursor() as cur:
        cur.execute(
            "INSERT INTO competition (id, name, kind, scope, gender, model_training)"
            " VALUES (%s, 'Z8 absences test', 'league', 'continental', 'men', false)",
            (ids["comp"],),
        )
        cur.execute(
            "INSERT INTO season (id, competition_id, label, start_date, end_date)"
            " VALUES (%s, %s, '2023/24', '2023-08-01', '2024-05-31')",
            (ids["season"], ids["comp"]),
        )
        cur.execute(
            "INSERT INTO team (id, name, kind, gender) VALUES"
            " (%s, 'Z8 Home', 'club', 'men'), (%s, 'Z8 Away', 'club', 'men')",
            (ids["home"], ids["away"]),
        )
        cur.execute("INSERT INTO person (id, full_name) VALUES (%s, 'Z8 Mapped')", (ids["person"],))
        # 23:30 in UTC: the match's date is the UTC one, as the records loader reads it.
        cur.execute(
            "INSERT INTO fixture (id, season_id, kickoff_at, status)"
            " VALUES (%s, %s, '2023-09-02T23:30:00Z', 'finished')",
            (ids["fixture"], ids["season"]),
        )
        cur.execute(
            "INSERT INTO absence_history (provider, fixture_id, season_id, team_id, person_id,"
            " provider_person_id, status, kind, reason, fetched_at) VALUES"
            " ('api_football', %s, %s, %s, %s, 'z8-1', 'out', 'suspension', 'Red Card', now()),"
            " ('api_football', %s, %s, %s, NULL, 'z8-2', 'doubtful', NULL, NULL, now())",
            (
                ids["fixture"],
                ids["season"],
                ids["home"],
                ids["person"],
                ids["fixture"],
                ids["season"],
                ids["away"],
            ),
        )
    s.conn.commit()
    reader = connect_reader(DATABASE_URL)
    yield World(s, reader, ids)
    reader.close()
    s.conn.rollback()
    with s.conn.cursor() as cur:
        cur.execute("DELETE FROM training.absence WHERE fixture_id = %s", (ids["fixture"],))
        cur.execute(
            "DELETE FROM training.absence WHERE source_load_id IN"
            " (SELECT id FROM training.source_load WHERE source = 'our_absences')"
        )
        cur.execute("DELETE FROM training.source_load WHERE source = 'our_absences'")
        cur.execute("DELETE FROM fixture WHERE id = %s", (ids["fixture"],))  # its absences go too
        cur.execute("DELETE FROM person WHERE id = %s", (ids["person"],))
        cur.execute("DELETE FROM team WHERE id = ANY(%s::uuid[])", ([ids["home"], ids["away"]],))
        cur.execute("DELETE FROM season WHERE id = %s", (ids["season"],))
        cur.execute("DELETE FROM competition WHERE id = %s", (ids["comp"],))
    s.conn.commit()
    s.close()


@needs_db
def test_the_history_is_copied_under_our_ids_and_the_published_store_is_untouched(
    world: World,
) -> None:
    store, _reader, ids = world
    matches_before = store.count("match")
    first = load_absences(store, world.reader)
    second = load_absences(store, world.reader)
    assert [r.status for r in first + second] == ["succeeded", "succeeded"]
    assert first[0].content_sha256 == second[0].content_sha256
    assert (first[0].source, first[0].scope) == ("our_absences", "absences")

    rows = one(
        store,
        "SELECT competition_id::text, season, match_date, team_id::text, person_id::text,"
        " provider_person_id, status, kind FROM training.absence"
        " WHERE fixture_id = %s ORDER BY provider_person_id",
        ids["fixture"],
    )
    assert rows == [
        (
            ids["comp"],
            "2023/24",
            date(2023, 9, 2),
            ids["home"],
            ids["person"],
            "z8-1",
            "out",
            "suspension",
        ),
        (ids["comp"], "2023/24", date(2023, 9, 2), ids["away"], None, "z8-2", "doubtful", None),
    ]
    # Every row points at the newest load; nothing the published version reads moved.
    assert one(
        store,
        "SELECT DISTINCT source_load_id::text FROM training.absence WHERE fixture_id = %s",
        ids["fixture"],
    ) == [(second[0].load_id,)]
    assert store.count("match") == matches_before
    load = one(
        store,
        "SELECT licence_url, url FROM training.source_load WHERE id = %s",
        second[0].load_id,
    )
    assert load == [("https://api-sports.io/terms", "records:public.absence_history")]


@needs_db
def test_a_row_the_history_lost_leaves_the_copy(world: World) -> None:
    store, _reader, ids = world
    load_absences(store, world.reader)
    with store.conn.cursor() as cur:
        cur.execute(
            "DELETE FROM absence_history WHERE fixture_id = %s AND provider_person_id = 'z8-2'",
            (ids["fixture"],),
        )
    store.conn.commit()
    load_absences(store, world.reader)
    held = one(
        store,
        "SELECT provider_person_id FROM training.absence WHERE fixture_id = %s",
        ids["fixture"],
    )
    assert held == [("z8-1",)]


@needs_db
def test_an_empty_history_is_refused_and_the_refusal_recorded(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, _reader, _ids = world
    monkeypatch.setattr(absence_history, "recorded_absences", lambda _conn: [])
    with pytest.raises(ValueError, match="absence_history holds no row"):
        load_absences(store, world.reader)
    failed = one(
        store,
        "SELECT status FROM training.source_load WHERE source = 'our_absences'"
        " ORDER BY started_at DESC LIMIT 1",
    )
    assert failed == [("failed",)]
