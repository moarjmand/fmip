"""Rest days and fixture congestion as a model input (T-1110, D-141).

For each side of a match, from the stored schedule:

- **rest**: days since the club's previous match, strictly before the match's
  day. ``short = clip((7 - rest) / 4, 0, 1)``: a week or more of rest is 0,
  three days or fewer is 1.
- **congestion**: the club's matches in the 14 days before the match's day.
  ``extra = max(n - 2, 0)``: the matches beyond one a week.

A side's feature vector is ``[short, short of the opponent, extra, extra of
the opponent]``; ``FeatureInput`` fits one coefficient for each by
time-weighted Poisson likelihood with the model's expected goals as offsets,
as the line-up term does (D-086), so a tired side can both score less and
concede more.

**The schedule** is every row of ``training.match`` on or before the
harness's last day, with clubs keyed through the bridge (``team_alias``,
D-080) exactly as our own Elo reads them (``training.own_elo.read_matches``):
football-data's league matches, our records' divisions and the cross-league
matches of our records (``XL``: cups and continental matches of the
competitions we carry). A domestic cup we do not carry is invisible, and
football-data holds league matches only, so a club of a football-data
division with no bridge is seen in its league matches alone. Serving reads
the same rows through ``read_schedule`` (so a forecast never sees a wider
schedule than its fit did); only dates strictly before a match's day are
ever read for it.

A club with no earlier match in the store has no rest value: the term is not
applied to that match (the candidate's forecast stands), never a default.
"""

from __future__ import annotations

from bisect import bisect_left
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, timedelta

import psycopg

from ..model.dixon_coles import MatchObservation
from ..training.own_elo import Conn, read_matches
from . import FeatureInput, Features, InputContext, Scheduled

#: A week of rest or more carries no penalty; three days or fewer the whole of it.
FULL_REST_DAYS = 7
SHORT_REST_SPAN = 4
#: The congestion window and the matches in it that are one a week.
CONGESTION_DAYS = 14
NORMAL_IN_WINDOW = 2


class Schedule:
    """Each club's distinct match days, oldest first, keyed as ``read_matches`` keys them."""

    def __init__(self, rows: Iterable[tuple[str, date]]) -> None:
        days: dict[str, set[date]] = {}
        for club, day in rows:
            days.setdefault(club, set()).add(day)
        self.days = {club: sorted(d) for club, d in days.items()}

    def rest(self, club: str, day: date) -> tuple[int, int] | None:
        """(days since the previous match, matches in the 14 days before ``day``),
        from the club's matches strictly before ``day``; ``None`` with none."""
        days = self.days.get(club, [])
        i = bisect_left(days, day)
        if i == 0:
            return None
        recent = i - bisect_left(days, day - timedelta(days=CONGESTION_DAYS))
        return (day - days[i - 1]).days, recent


def short_rest(days: int) -> float:
    return min(max((FULL_REST_DAYS - days) / SHORT_REST_SPAN, 0.0), 1.0)


def extra_matches(in_window: int) -> float:
    return float(max(in_window - NORMAL_IN_WINDOW, 0))


class ClubKeys:
    """A division's training name to the schedule's key: the bridge's team id, else
    ``<division>:<name>`` (the key ``read_matches`` gives an unbridged club)."""

    def __init__(self, aliases: Mapping[str, Mapping[str, str]]) -> None:
        self.aliases = aliases

    def __call__(self, division: str, name: str) -> str:
        return self.aliases.get(division, {}).get(name) or f"{division}:{name}"


def features_from(schedule: Schedule, keys: ClubKeys) -> Features:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[list[float], list[float]] | None:
        home = schedule.rest(keys(division, match.home), match.date)
        away = schedule.rest(keys(division, match.away), match.date)
        if home is None or away is None:
            return None
        sh, sa = short_rest(home[0]), short_rest(away[0])
        eh, ea = extra_matches(home[1]), extra_matches(away[1])
        return [sh, sa, eh, ea], [sa, sh, ea, eh]

    return features


DESCRIPTION = (
    "Rest and congestion (D-141): each side's days since its previous stored match "
    "(short rest: under a week) and its stored matches in the 14 days before, beyond "
    "two; clubs keyed through team_alias. football-data holds league matches only and "
    "a domestic cup we do not carry is invisible."
)


def rest_input(schedule: Schedule, keys: ClubKeys) -> FeatureInput:
    return FeatureInput("rest", DESCRIPTION, features_from(schedule, keys))


def read_schedule(conn: Conn, until: date) -> tuple[Schedule, ClubKeys]:
    """The schedule and the bridge, as training and serving both read them."""
    matches = read_matches(conn, until)
    rows: list[tuple[str, date]] = []
    for m in matches:
        rows += [(m.home, m.date), (m.away, m.date)]
    aliases: dict[str, dict[str, str]] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT division, training_name, team_id::text FROM training.team_alias")
        for division, name, team_id in cur.fetchall():
            aliases.setdefault(str(division), {})[str(name)] = str(team_id)
    return Schedule(rows), ClubKeys(aliases)


def build(context: InputContext) -> FeatureInput:
    if context.database_url is None:
        raise LookupError("the rest input reads the stored schedule: DATABASE_URL is needed")
    with psycopg.connect(context.database_url) as conn:
        schedule, keys = read_schedule(conn, context.until)
    return rest_input(schedule, keys)
