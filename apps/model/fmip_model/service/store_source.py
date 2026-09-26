"""The training store as the forecaster's source."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, date, datetime

import psycopg

from ..model.cross_league import CROSS_LEAGUE
from ..model.data import elo_on, every_match_before, matches_before
from ..model.dixon_coles import MatchObservation
from ..training.load import load_records
from ..training.sources import OUR_RECORDS
from ..training.store import TrainingStore
from .forecaster import TrainingSource

log = logging.getLogger(__name__)


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
    ) -> None:
        self.database_url = database_url
        self.today = today
        self._refreshed: dict[str, date] = {}
        self._lock = threading.Lock()

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
