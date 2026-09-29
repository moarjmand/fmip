"""Head-to-head after current strength (T-1140, D-148).

Blueprint 6.3 admits head-to-head only as what is left of past meetings once
current strength is in the fit. So the feature is a residual, not a record:
for a match between ``home`` and ``away``, every earlier meeting of the two
(either venue, in the division) is scored against the *fitted model's*
expected goals for that meeting's venue, and the residual goal difference
from ``home``'s side,

    r = (goals of home - expected) - (goals of away - expected),

is averaged with time weights (half-life ``HALF_LIFE_DAYS``) and shrunk
toward zero by ``PSEUDO_MEETINGS`` meetings of zero residual:

    x = sum(w * r) / (sum(w) + PSEUDO_MEETINGS).

The home side's log expected goals move by ``beta * x``, the away side's by
``-beta * x``; ``beta`` is fitted per refit by time-weighted Poisson
likelihood with the model's expected goals as offsets (``fit_coefficients``,
as every feature input). The constants were fixed before any run and are not
tuned, so the verdict is not chosen on its own window.

Meetings are read from the harness's ``known`` and, when a database is given,
from the division's whole stored history in ``training.match`` (football-data
back to the first season loaded), always strictly before the match's day and
no older than ``MAX_AGE_DAYS``. Two sides that never met in that span give no
value: the candidate's forecast stands and the match is outside the sample.

What members see as head-to-head (``head_to_head``, T-033) is not this and is
unchanged.
"""

from __future__ import annotations

import math
from bisect import bisect_left
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import psycopg

from ..model.dixon_coles import FittedModel, MatchObservation
from . import InputContext, LogShift, Scheduled, before, fit_coefficients

#: A meeting two years old counts half as much as one today.
HALF_LIFE_DAYS = 730
#: Meetings older than this are not read at all.
MAX_AGE_DAYS = 3650
#: Zero-residual meetings added to the average: one meeting moves x by a third.
PSEUDO_MEETINGS = 2.0
#: |beta| per goal of residual difference.
BOUND = 1.0

Pair = tuple[str, str]


def _pair(a: str, b: str) -> Pair:
    return (a, b) if a < b else (b, a)


class Meetings:
    """Every stored meeting of each pair of sides, per division, oldest first."""

    def __init__(self) -> None:
        self._by: dict[tuple[str, Pair], list[MatchObservation]] = {}
        self._seen: set[tuple[str, date, str, str]] = set()
        self._fed: dict[str, int] = {}

    def feed(self, division: str, ordered: Sequence[MatchObservation]) -> None:
        """Add the harness's rows. They are always a prefix of the same ordered list
        (``history`` and ``known``), so only the part not yet fed is read."""
        fed = self._fed.get(division, 0)
        if len(ordered) > fed:
            self.add(division, ordered[fed:])
            self._fed[division] = len(ordered)

    def add(self, division: str, matches: Sequence[MatchObservation]) -> None:
        touched: set[tuple[str, Pair]] = set()
        for m in matches:
            key = (division, m.date, m.home, m.away)
            if key in self._seen:
                continue
            self._seen.add(key)
            pair = (division, _pair(m.home, m.away))
            self._by.setdefault(pair, []).append(m)
            touched.add(pair)
        for pair in touched:
            self._by[pair].sort(key=lambda m: m.date)

    def between(self, division: str, a: str, b: str, day: date) -> Sequence[MatchObservation]:
        """The meetings of ``a`` and ``b`` strictly before ``day`` and within ``MAX_AGE_DAYS``."""
        ordered = self._by.get((division, _pair(a, b)), [])
        start = bisect_left([m.date for m in ordered], day - timedelta(days=MAX_AGE_DAYS))
        return before(ordered[start:], day)


def residual(
    model: FittedModel, home: str, away: str, day: date, meetings: Sequence[MatchObservation]
) -> float | None:
    """The shrunk, time-weighted residual goal difference from ``home``'s side."""
    if home not in model.attack or away not in model.attack or not meetings:
        return None
    rate = math.log(2) / HALF_LIFE_DAYS
    total = weights = 0.0
    for m in meetings:
        lam, mu = model.expected_goals(m.home, m.away)
        r = (m.home_goals - lam) - (m.away_goals - mu)
        if m.home != home:
            r = -r
        w = math.exp(-rate * (day - m.date).days)
        total += w * r
        weights += w
    return total / (weights + PSEUDO_MEETINGS)


@dataclass(frozen=True)
class HeadToHeadTerm:
    division: str
    model: FittedModel
    beta: float
    samples: int
    meetings: Meetings

    def feature(self, match: Scheduled, known: Sequence[MatchObservation]) -> float | None:
        self.meetings.feed(self.division, known)
        found = self.meetings.between(self.division, match.home, match.away, match.date)
        return residual(self.model, match.home, match.away, match.date, found)

    def shift(self, match: Scheduled, known: Sequence[MatchObservation]) -> LogShift | None:
        if self.samples == 0:
            return None
        x = self.feature(match, known)
        if x is None:
            return None
        return self.beta * x, -self.beta * x


class HeadToHead:
    name = "head_to_head"
    description = (
        "Head-to-head after current strength: the residual goal difference of past "
        f"meetings against the fitted model, half-life {HALF_LIFE_DAYS} days, shrunk by "
        f"{PSEUDO_MEETINGS:g} zero meetings, one fitted coefficient (T-1140, D-148)."
    )

    def __init__(self, meetings: Meetings) -> None:
        self.meetings = meetings

    def fit(
        self,
        division: str,
        history: Sequence[MatchObservation],
        fit_date: date,
        model: FittedModel,
    ) -> HeadToHeadTerm:
        self.meetings.feed(division, history)
        unfitted = HeadToHeadTerm(division, model, 0.0, 0, self.meetings)
        rows: list[tuple[float, float, float, float, float]] = []
        xs: list[float] = []
        for m in history:
            x = unfitted.feature(m, ())
            if x is None:
                continue
            lam, mu = model.expected_goals(m.home, m.away)
            weight = math.exp(-model.xi * (fit_date - m.date).days)
            rows.append((lam, mu, float(m.home_goals), float(m.away_goals), weight))
            xs.append(x)
        if not rows:
            return unfitted
        column = np.array(xs, dtype=np.float64)[:, None]
        beta = fit_coefficients(np.array(rows), column, -column, BOUND)
        return HeadToHeadTerm(division, model, float(beta[0]), len(rows), self.meetings)


def stored_meetings(database_url: str, divisions: Sequence[str], until: date) -> Meetings:
    """The divisions' every stored result up to ``until`` (a match is only ever read
    for a later day, so nothing here reaches a forecast early)."""
    meetings = Meetings()
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT division, match_date, home_team, away_team, home_goals, away_goals
              FROM training.match
             WHERE division = ANY(%s) AND match_date <= %s
               AND home_goals IS NOT NULL AND away_goals IS NOT NULL
             ORDER BY match_date
            """,
            (list(divisions), until),
        )
        rows = cur.fetchall()
    per: dict[str, list[MatchObservation]] = {}
    for division, day, home, away, hg, ag in rows:
        per.setdefault(str(division), []).append(
            MatchObservation(day, str(home), str(away), int(str(hg)), int(str(ag)))
        )
    for division, matches in per.items():
        meetings.add(division, matches)
    return meetings


def build(context: InputContext) -> HeadToHead:
    if context.database_url is None:
        return HeadToHead(Meetings())
    return HeadToHead(stored_meetings(context.database_url, context.divisions, context.until))
