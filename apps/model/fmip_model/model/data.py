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


def every_match_before(
    conn: Connection[tuple[object, ...]], fit_date: date, *, since: date
) -> list[tuple[str, MatchObservation]]:
    """Every division's completed matches in ``(since, fit_date]``, clubs named by catalogue id.

    For the fit across leagues (T-533): a club with an alias is its catalogue
    id in every division it played in, so its domestic and cup matches are one
    club's; a name with no alias stays its division's own (``E0:Name``), a
    club the catalogue does not hold.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.division, m.match_date,
                   coalesce(ah.team_id::text, m.division || ':' || m.home_team),
                   coalesce(aa.team_id::text, m.division || ':' || m.away_team),
                   m.home_goals, m.away_goals
              FROM training.match m
              LEFT JOIN training.team_alias ah
                ON ah.division = m.division AND ah.training_name = m.home_team
              LEFT JOIN training.team_alias aa
                ON aa.division = m.division AND aa.training_name = m.away_team
             WHERE m.match_date <= %s AND m.match_date > %s
             ORDER BY m.match_date
            """,
            (fit_date, since),
        )
        rows = cur.fetchall()
    return [
        (
            str(row[0]),
            MatchObservation(
                date=row[1],  # type: ignore[arg-type]
                home=str(row[2]),
                away=str(row[3]),
                home_goals=int(str(row[4])),
                away_goals=int(str(row[5])),
            ),
        )
        for row in rows
    ]
