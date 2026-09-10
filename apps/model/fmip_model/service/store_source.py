"""The training store as the forecaster's source."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date

import psycopg

from ..model.data import elo_on, matches_before
from ..model.dixon_coles import MatchObservation
from .forecaster import TrainingSource


class PostgresTrainingSource(TrainingSource):
    """One short-lived connection per call: the service fits rarely and reads little."""

    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def aliases(self, division: str) -> Mapping[str, str]:
        with psycopg.connect(self.database_url) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT team_id::text, training_name FROM training.team_alias WHERE division = %s",
                (division,),
            )
            return {str(row[0]): str(row[1]) for row in cur.fetchall()}

    def matches(self, division: str, since: date, until: date) -> Sequence[MatchObservation]:
        with psycopg.connect(self.database_url) as conn:
            return matches_before(conn, until, [division], since=since)

    def elo(self, day: date) -> Mapping[str, float]:
        with psycopg.connect(self.database_url) as conn:
            return elo_on(conn, day)
