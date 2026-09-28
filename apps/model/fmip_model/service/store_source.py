"""The training store as the forecaster's source."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, date, datetime, timedelta

import psycopg

from ..model.cross_league import CROSS_LEAGUE
from ..model.data import elo_on, every_match_before, matches_before
from ..model.dixon_coles import MatchObservation
from ..training.load import Fetch, fetch_text, load_clubelo, load_records
from ..training.sources import CLUB_ELO, OUR_RECORDS
from ..training.store import TrainingStore
from .contract import EloSourceState
from .forecaster import TrainingSource

log = logging.getLogger(__name__)

#: How long after one ask of Club Elo the next may be made (T-920). Four a day
#: at most, whatever the watchdog's tick: a free API is asked politely.
CLUBELO_ASK_INTERVAL = timedelta(hours=6)
#: The service's own ask gives up sooner than the loader's CLI default: it runs
#: beside forecasts, and a source that hangs is a source that did not answer.
CLUBELO_TIMEOUT_SECONDS = 20.0


def _clubelo_fetch(url: str) -> str:
    return fetch_text(url, timeout=CLUBELO_TIMEOUT_SECONDS)


class PostgresTrainingSource(TrainingSource):
    """One short-lived connection per call: the service fits rarely and reads little.

    A division of our own records (D-083) changes every match day, so it is
    refreshed through the loader once a day, before the day's first read of it.
    A refresh that fails is recorded as a failed load by the loader, logged
    here, and the copy already held is used.
    """

    def __init__(
        self,
        database_url: str,
        today: Callable[[], date] = lambda: datetime.now(UTC).date(),
        *,
        clubelo_refresh: bool = True,
        clubelo_fetch: Fetch = _clubelo_fetch,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.database_url = database_url
        self.today = today
        self.clubelo_refresh = clubelo_refresh
        self.clubelo_fetch = clubelo_fetch
        self.clock = clock
        self._refreshed: dict[str, date] = {}
        self._lock = threading.Lock()
        self._elo_lock = threading.Lock()
        self._elo_asked_at: datetime | None = None

    def aliases(self, division: str) -> Mapping[str, str]:
        self.refresh(division)
        with psycopg.connect(self.database_url) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT team_id::text, training_name FROM training.team_alias WHERE division = %s",
                (division,),
            )
            return {str(row[0]): str(row[1]) for row in cur.fetchall()}

    def matches(self, division: str, since: date, until: date) -> Sequence[MatchObservation]:
        self.refresh(division)
        with psycopg.connect(self.database_url) as conn:
            return matches_before(conn, until, [division], since=since)

    def elo(self, day: date) -> Mapping[str, float]:
        with psycopg.connect(self.database_url) as conn:
            return elo_on(conn, day)

    def every_match(self, since: date, until: date) -> Sequence[tuple[str, MatchObservation]]:
        self.refresh(CROSS_LEAGUE)
        with psycopg.connect(self.database_url) as conn:
            return every_match_before(conn, until, since=since)

    def elo_source(self) -> EloSourceState:
        """Club Elo as ``training.source_load`` recorded it: newest success, newest failure."""
        try:
            with psycopg.connect(self.database_url) as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    WITH loads AS (
                      SELECT scope, status, error, finished_at FROM training.source_load
                       WHERE source = %s AND status IN ('succeeded', 'failed')
                    ),
                    ok AS (
                      SELECT scope, finished_at FROM loads WHERE status = 'succeeded'
                       ORDER BY finished_at DESC LIMIT 1
                    ),
                    bad AS (
                      SELECT error, finished_at FROM loads WHERE status = 'failed'
                       ORDER BY finished_at DESC LIMIT 1
                    )
                    SELECT (SELECT scope FROM ok), (SELECT finished_at FROM ok),
                           (SELECT error FROM bad), (SELECT finished_at FROM bad),
                           (SELECT min(finished_at) FROM loads
                             WHERE status = 'failed'
                               AND finished_at > coalesce((SELECT finished_at FROM ok),
                                                          '-infinity'))
                    """,
                    (CLUB_ELO.id,),
                )
                row = cur.fetchone()
        except Exception as problem:  # noqa: BLE001 - health reports it, never raises
            return EloSourceState(
                refresh=self.clubelo_refresh,
                state="unreadable",
                detail=f"{type(problem).__name__}: {problem}"[:300],
            )
        assert row is not None
        day, succeeded_at, error, failed_at, first_failure = row
        return EloSourceState(
            refresh=self.clubelo_refresh,
            state="recorded",
            last_succeeded_day=None if day is None else date.fromisoformat(str(day)),
            last_succeeded_at=succeeded_at,
            last_error=None if error is None else str(error),
            last_error_at=failed_at,
            unanswered_since=succeeded_at if succeeded_at is not None else first_failure,
        )

    def ask_elo(self) -> None:
        """Start one background ask of Club Elo when it is due (T-920)."""
        if not self._elo_due():
            return
        threading.Thread(target=self.refresh_clubelo, name="clubelo-ask", daemon=True).start()

    def _elo_due(self) -> bool:
        if not self.clubelo_refresh:
            return False
        asked = self._elo_asked_at
        return asked is None or self.clock() - asked >= CLUBELO_ASK_INTERVAL

    def refresh_clubelo(self) -> None:
        """Load yesterday's Club Elo snapshot once, unless it is already held.

        Yesterday's, because a fit's date is the day before the match (and never
        later than yesterday), and a snapshot rates each club as of its day. A
        failure is recorded by the loader as a failed load -- the row the
        watchdog counts days from -- and logged here; it never reaches a forecast.
        """
        with self._elo_lock:
            if not self._elo_due():
                return
            self._elo_asked_at = self.clock()
            day = (self.today() - timedelta(days=1)).isoformat()
            try:
                store = TrainingStore.connect(self.database_url)
            except Exception:  # noqa: BLE001 - no store, nothing to record into
                log.exception("the training store did not answer; Club Elo not asked")
                return
            try:
                if store.loaded_from(day, CLUB_ELO.id):
                    return
                load_clubelo(store, [day], fetch=self.clubelo_fetch)
            except Exception:  # noqa: BLE001 - the loader recorded it; the held ratings stand
                log.exception("asking Club Elo for %s failed", day)
            finally:
                store.close()

    def refresh(self, division: str) -> None:
        today = self.today()
        with self._lock:
            if self._refreshed.get(division) == today:
                return
            self._refreshed[division] = today
            store = TrainingStore.connect(self.database_url)
            try:
                if store.loaded_from(division, OUR_RECORDS.id):
                    load_records(store, [division])
            except Exception:  # noqa: BLE001 - the loader recorded it; the held copy stands
                log.exception("refreshing %s from our records failed", division)
            finally:
                store.close()
