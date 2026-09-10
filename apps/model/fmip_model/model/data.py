"""Reading the training store into model inputs."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from psycopg import Connection

from .dixon_coles import MatchObservation


def matches_before(
    conn: Connection[tuple[object, ...]],
    fit_date: date,
    divisions: Sequence[str],
    *,
    since: date | None = None,
) -> list[MatchObservation]:
    """Completed matches in ``divisions`` on or before ``fit_date`` (and after ``since``).

    Strictly before the fit date's future: a backtest that read a result from
    the day it was predicting would be a leak, so the boundary is inclusive of
    ``fit_date`` only for matches already played by then, which the caller
    controls by passing the day before a fixture's kick-off.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT match_date, home_team, away_team, home_goals, away_goals
              FROM training.match
             WHERE division = ANY(%s) AND match_date <= %s AND (%s::date IS NULL OR match_date > %s)
             ORDER BY match_date
            """,
            (list(divisions), fit_date, since, since),
        )
        rows = cur.fetchall()
    return [
        MatchObservation(
            date=row[0],  # type: ignore[arg-type]
            home=str(row[1]),
            away=str(row[2]),
            home_goals=int(str(row[3])),
            away_goals=int(str(row[4])),
        )
        for row in rows
    ]


def elo_on(conn: Connection[tuple[object, ...]], day: date) -> dict[str, float]:
    """Each club's Elo valid on ``day``, by club name as Club Elo spells it."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT club, elo FROM training.elo WHERE from_date <= %s AND to_date >= %s",
            (day, day),
        )
        rows = cur.fetchall()
    return {str(row[0]): float(str(row[1])) for row in rows}
