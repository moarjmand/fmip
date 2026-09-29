"""The second leg of a tie (T-1121, D-144): the first leg's score as an input to the second.

A **two-legged tie** is two fixtures of one cup season in the same round
(its round label, else its stage's name), between the same two clubs with the
sides reversed, on different days, outside any group -- the pairing the
bracket's ``tieOf`` makes (T-630). A domestic cup's round counts only when its
stage says two legs (``stage.legs = 2``): a domestic replay is the same pair,
reversed, in the same round, and is not a second leg. A continental round is
taken as two-legged when it holds the pair twice, as the bracket takes it.
A single-leg round (a final, a domestic tie) has one fixture and no second
leg.

For the second leg, ``d`` is the first leg's goal difference from the
second leg's home side's view (it was the away side then), capped at 3 either
way. Home goals move by ``exp(b1 * d + b2 * |d|)``, away goals by
``exp(-b1 * d + b2 * |d|)``: ``b1`` is what a lead does to a side's own
scoring, ``b2`` what a lopsided tie does to both.

Nothing is read for a first leg, or a second leg, that is not a tie by this
rule, nor when the first leg's result is not among what the forecast knows
(matches strictly before the second leg's day): a tie whose legs share a day
gives no value. The pairing is read in ``build`` from ``fixture`` (rounds
and sides are fixed by the draw, before either leg); the first leg's score is
only ever read from the harness's ``known``. football-data.co.uk carries no
cup, so only our records' cross-league division (``XL``, T-533) has second
legs.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date

import psycopg

from ..model.dixon_coles import MatchObservation
from . import FeatureInput, InputContext, Scheduled

Key = tuple[date, str, str]

#: Rounds that are not knockout ties even when a pair meets twice in them.
NOT_A_TIE = re.compile(r"group|league (stage|phase)|regular season", re.IGNORECASE)
CAP = 3


@dataclass(frozen=True)
class CupFixture:
    season: str
    round: str | None
    group: str | None
    legs: int | None
    continental: bool
    date: date
    home: str
    away: str


def pair_legs(fixtures: Iterable[CupFixture]) -> dict[Key, Key]:
    """Each second leg's (day, home, away) -> its first leg's."""
    rounds: dict[tuple[str, str, frozenset[str]], list[CupFixture]] = {}
    for f in fixtures:
        if f.round is None or f.group is not None or NOT_A_TIE.search(f.round):
            continue
        if not f.continental and f.legs != 2:
            continue
        rounds.setdefault((f.season, f.round, frozenset((f.home, f.away))), []).append(f)
    out: dict[Key, Key] = {}
    for legs in rounds.values():
        if len(legs) != 2:
            continue
        first, second = sorted(legs, key=lambda f: f.date)
        if first.date == second.date or (first.home, first.away) != (second.away, second.home):
            continue
        out[(second.date, second.home, second.away)] = (first.date, first.home, first.away)
    return out


def first_leg_difference(
    pairs: Mapping[Key, Key], match: Scheduled, known: Sequence[MatchObservation]
) -> int | None:
    """The first leg's goal difference for the second leg's home side, or None."""
    first = pairs.get((match.date, match.home, match.away))
    if first is None or first[0] >= match.date:
        return None
    for m in reversed(known):
        if m.date < first[0]:
            break
        if (m.date, m.home, m.away) == first:
            return max(-CAP, min(CAP, m.away_goals - m.home_goals))
    return None


def second_leg_input(pairs: Mapping[Key, Key]) -> FeatureInput:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[list[float], list[float]] | None:
        d = first_leg_difference(pairs, match, known)
        if d is None:
            return None
        return [float(d), float(abs(d))], [float(-d), float(abs(d))]

    return FeatureInput(
        "second_leg",
        "The second leg of a tie (T-1121, D-144): the first leg's goal difference, from our "
        "records' cup ties, moving each side's goals by its lead and by how lopsided the tie is.",
        features,
    )


CUP_FIXTURES_SQL = """
SELECT f.season_id::text, COALESCE(f.round, st.name), f.group_name, st.legs,
       c.scope <> 'domestic', (f.kickoff_at AT TIME ZONE 'UTC')::date,
       h.team_id::text, a.team_id::text
  FROM fixture f
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  LEFT JOIN stage st ON st.id = f.stage_id
  JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
  JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
 WHERE c.kind <> 'league' AND f.status <> 'cancelled'
"""


def read_pairs(database_url: str) -> dict[Key, Key]:
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(CUP_FIXTURES_SQL)
        return pair_legs(
            CupFixture(
                str(season),
                None if label is None else str(label),
                None if group is None else str(group),
                None if legs is None else int(str(legs)),
                bool(continental),
                day,
                str(home),
                str(away),
            )
            for season, label, group, legs, continental, day, home, away in cur.fetchall()
        )


def build(context: InputContext) -> FeatureInput:
    if context.database_url is None:
        raise ValueError("second_leg reads the cup ties' pairing from the store")
    return second_leg_input(read_pairs(context.database_url))
