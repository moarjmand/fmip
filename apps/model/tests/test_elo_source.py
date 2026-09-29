"""Club Elo's state as the service reports it (T-920, D-111).

Integration: needs DATABASE_URL and the ``training`` schema; skipped, visibly,
without it. The service's own ask is driven with a fake fetch, first failing
the way Club Elo has since 2026-09-25, then answering. Loads are for the day
2000-01-01 so they never collide with real ones, and are removed afterwards.
"""

import os
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from fmip_model.service.app import create_app
from fmip_model.service.store_source import CLUBELO_ASK_INTERVAL, PostgresTrainingSource

DATABASE_URL = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")

TODAY = date(2000, 1, 2)
SNAPSHOT = (
    "Rank,Club,Country,Level,Elo,From,To\nNone,T0 Test Club,ZZZ,9,1234.5,2000-01-01,2000-01-02\n"
)


def cleanup() -> None:
    assert DATABASE_URL
    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM training.elo WHERE country = 'ZZZ'")
        cur.execute(
            "DELETE FROM training.source_load WHERE source = 'clubelo' AND scope = '2000-01-01'"
        )


@pytest.fixture(autouse=True)
def clean() -> Iterator[None]:
    cleanup()
    yield
    cleanup()


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2000, 1, 2, 6, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


class Feed:
    """Club Elo as a function: 502 until told to answer."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.answering = False

    def __call__(self, url: str) -> str:
        self.calls.append(url)
        if not self.answering:
            request = httpx.Request("GET", url)
            raise httpx.HTTPStatusError(
                "Server error '502 Bad Gateway'",
                request=request,
                response=httpx.Response(502, request=request),
            )
        return SNAPSHOT


def source(feed: Feed, clock: Clock, *, refresh: bool = True) -> PostgresTrainingSource:
    assert DATABASE_URL
    return PostgresTrainingSource(
        DATABASE_URL,
        today=lambda: TODAY,
        clubelo_refresh=refresh,
        clubelo_fetch=feed,
        clock=clock,
    )


def test_a_failing_source_is_recorded_asked_at_most_every_six_hours_then_recovers() -> None:
    feed, clock = Feed(), Clock()
    src = source(feed, clock)

    src.refresh_clubelo()
    failed = src.elo_source()
    assert feed.calls == ["http://api.clubelo.com/2000-01-01"]  # yesterday's snapshot
    assert failed.state == "recorded"
    assert failed.last_error is not None and "502" in failed.last_error
    assert failed.last_error_at is not None
    # Never answered here: the count runs from the first failed ask.
    if failed.last_succeeded_at is None:
        assert failed.unanswered_since is not None

    # The watchdog's minute-by-minute health checks do not become requests.
    clock.now += timedelta(minutes=5)
    src.refresh_clubelo()
    assert len(feed.calls) == 1

    clock.now += CLUBELO_ASK_INTERVAL
    feed.answering = True
    src.refresh_clubelo()
    answered = src.elo_source()
    assert len(feed.calls) == 2
    assert answered.last_succeeded_day == date(2000, 1, 1)
    assert answered.unanswered_since == answered.last_succeeded_at
    # The last error stays on record beside the success, for the System page.
    assert answered.last_error is not None and "502" in answered.last_error

    # A snapshot already held is not asked for again.
    clock.now += CLUBELO_ASK_INTERVAL
    src.refresh_clubelo()
    assert len(feed.calls) == 2


def test_off_means_never_asked_and_said_so() -> None:
    feed, clock = Feed(), Clock()
    src = source(feed, clock, refresh=False)
    src.refresh_clubelo()
    src.ask_elo()
    assert feed.calls == []
    assert src.elo_source().refresh is False


def test_health_carries_the_state_and_an_unreadable_store_is_said_not_raised() -> None:
    feed, clock = Feed(), Clock()
    src = source(feed, clock)
    src.refresh_clubelo()
    body = TestClient(create_app(src, read_candidates=False)).get("/health").json()
    assert body["elo_source"]["source"] == "clubelo"
    assert "502" in body["elo_source"]["last_error"]

    broken = PostgresTrainingSource(
        "postgresql://nobody:nothing@127.0.0.1:1/none",
        clubelo_refresh=False,
    )
    state = broken.elo_source()
    assert state.state == "unreadable"
    assert state.detail
