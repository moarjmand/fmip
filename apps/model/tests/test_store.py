"""Integration tests for the training store. Need DATABASE_URL and the
``training`` schema (migration 1758300000000); skipped, visibly, without it.

Rows are written under the test division ``T0`` so they never collide with
real loads, and are removed afterwards.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

from fmip_model.training.load import load_clubelo, load_football_data
from fmip_model.training.store import TrainingStore

DATABASE_URL = os.environ.get("DATABASE_URL")
FIXTURE = Path(__file__).parent / "fixtures" / "football-data_E0_2425_head.csv"

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")

CLUBELO_SYNTHETIC = (
    "Rank,Club,Country,Level,Elo,From,To\nNone,T0 Test Club,ZZZ,9,1234.5,2000-01-01,2000-01-02\n"
)


@pytest.fixture
def store() -> Iterator[TrainingStore]:
    assert DATABASE_URL
    s = TrainingStore.connect(DATABASE_URL)
    yield s
    with s.conn.cursor() as cur:
        cur.execute("DELETE FROM training.match WHERE division = 'T0'")
        cur.execute("DELETE FROM training.elo WHERE country = 'ZZZ'")
        cur.execute(
            "DELETE FROM training.source_load WHERE scope LIKE 'T0 %' OR scope = '2000-01-01'"
        )
    s.conn.commit()
    s.close()


def fixture_as_t0() -> str:
    return FIXTURE.read_text(encoding="utf-8").replace("E0,", "T0,")


def count_t0(store: TrainingStore) -> int:
    with store.conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM training.match WHERE division = 'T0'")
        row = cur.fetchone()
    assert row is not None
    return int(str(row[0]))


def test_load_is_repeatable_and_versioned(store: TrainingStore) -> None:
    text = fixture_as_t0()

    first = load_football_data(store, ["2425"], ["T0"], fetch=lambda _url: text)
    second = load_football_data(store, ["2425"], ["T0"], fetch=lambda _url: text)

    assert [r.status for r in first + second] == ["succeeded", "succeeded"]
    assert first[0].row_count == second[0].row_count == 5
    assert first[0].content_sha256 == second[0].content_sha256
    assert first[0].load_id != second[0].load_id
    # Repeatable: the same file twice is five rows, not ten.
    assert count_t0(store) == 5

    with store.conn.cursor() as cur:
        cur.execute(
            """
            SELECT status, row_count, licence_url, url
              FROM training.source_load WHERE id = %s
            """,
            (second[0].load_id,),
        )
        row = cur.fetchone()
        assert row == (
            "succeeded",
            5,
            "https://www.football-data.co.uk/notes.txt",
            "https://www.football-data.co.uk/mmz4281/2425/T0.csv",
        )
        # Every row now points at the newer load.
        cur.execute(
            "SELECT count(*) FROM training.match WHERE division = 'T0' AND source_load_id = %s",
            (second[0].load_id,),
        )
        pointed = cur.fetchone()
        assert pointed is not None and int(str(pointed[0])) == 5


def test_a_failed_download_is_recorded_and_writes_nothing(store: TrainingStore) -> None:
    def broken(_url: str) -> str:
        raise RuntimeError("HTTP 502 from the source")

    with pytest.raises(RuntimeError):
        load_football_data(store, ["2425"], ["T0"], fetch=broken)

    assert count_t0(store) == 0
    with store.conn.cursor() as cur:
        cur.execute(
            "SELECT status, error FROM training.source_load"
            " WHERE scope = 'T0 2024/25' ORDER BY started_at DESC LIMIT 1"
        )
        row = cur.fetchone()
    assert row is not None
    assert row[0] == "failed"
    assert "502" in str(row[1])


def test_a_malformed_file_is_recorded_as_failed(store: TrainingStore) -> None:
    bad = "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\nT0,01/09/2024,A,B,2,0,A\n"
    with pytest.raises(Exception, match="disagrees"):
        load_football_data(store, ["2425"], ["T0"], fetch=lambda _url: bad)
    assert count_t0(store) == 0


def test_clubelo_load(store: TrainingStore) -> None:
    [result] = load_clubelo(store, ["2000-01-01"], fetch=lambda _url: CLUBELO_SYNTHETIC)
    [again] = load_clubelo(store, ["2000-01-01"], fetch=lambda _url: CLUBELO_SYNTHETIC)

    assert result.row_count == again.row_count == 1
    with store.conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM training.elo WHERE country = 'ZZZ'")
        row = cur.fetchone()
    assert row is not None and int(str(row[0])) == 1
