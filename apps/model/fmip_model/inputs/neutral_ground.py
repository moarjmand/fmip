"""Neutral ground (T-1122, D-145): a match on neither club's usual ground has no home advantage.

A club's **usual ground** is the venue of most of its home league matches in
the league season that contains the match's day (the latest one that ended in
the year before it, for a match after the league's last day, such as a cup
final in May). A tie for "most" gives the club every venue in it, so a ground
two clubs share is either club's usual ground. A match is on **neutral
ground** when its stored venue is neither side's usual ground; it is then
forecast without the fitted home advantage: the home side's log expected
goals lose ``home_advantage``, the away side's are unchanged.

Nothing is read for a match with no stored venue, or where either club has no
usual ground (a club whose league we do not carry): the candidate's forecast,
with today's home advantage, stands, and the match is outside the input's
sample. football-data.co.uk carries no ground, so only our records' divisions
are read.

The venues are read in ``build`` from ``fixture`` (a match's ground is fixed
when it is scheduled, not by its result); nothing here reads a score.
``fixture.is_neutral_venue`` is not used: ingestion always writes it false.
"""

from __future__ import annotations

from bisect import bisect_right
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg

from ..model.dixon_coles import FittedModel, MatchObservation
from . import InputContext, LogShift, Scheduled

Key = tuple[date, str, str]

#: A league season that ended longer ago than this before the match says nothing of its ground.
STALE_AFTER = timedelta(days=365)


@dataclass(frozen=True)
class Fixture:
    date: date
    home: str
    away: str
    venue: str | None
    league: bool
    season: str


@dataclass(frozen=True)
class GroundSeason:
    start: date
    end: date
    venues: frozenset[str]


class Grounds:
    """Each match's venue, and each club's usual ground by league season."""

    def __init__(self, fixtures: Iterable[Fixture]) -> None:
        rows = list(fixtures)
        self.venue_of: dict[Key, str] = {
            (f.date, f.home, f.away): f.venue for f in rows if f.venue is not None
        }
        homes: dict[tuple[str, str], list[Fixture]] = {}
        for f in rows:
            if f.league and f.venue is not None:
                homes.setdefault((f.home, f.season), []).append(f)
        by_club: dict[str, list[GroundSeason]] = {}
        for (club, _), played in homes.items():
            counts = Counter(f.venue for f in played if f.venue is not None)
            top = max(counts.values())
            by_club.setdefault(club, []).append(
                GroundSeason(
                    min(f.date for f in played),
                    max(f.date for f in played),
                    frozenset(v for v, n in counts.items() if n == top),
                )
            )
        self.seasons = {club: sorted(s, key=lambda g: g.start) for club, s in by_club.items()}

    def usual(self, club: str, day: date) -> frozenset[str] | None:
        """The club's usual ground on ``day``, or None when no league season tells it."""
        seasons = self.seasons.get(club)
        if not seasons:
            return None
        started = seasons[: bisect_right([s.start for s in seasons], day)]
        containing = [s for s in started if s.end >= day]
        if containing:
            return frozenset().union(*(s.venues for s in containing))
        ended = [s for s in started if day - s.end <= STALE_AFTER]
        return ended[-1].venues if ended else None

    def neutral(self, match: Scheduled) -> bool | None:
        """Whether ``match`` is on neutral ground; None when it cannot be told."""
        venue = self.venue_of.get((match.date, match.home, match.away))
        if venue is None:
            return None
        home, away = self.usual(match.home, match.date), self.usual(match.away, match.date)
        if home is None or away is None:
            return None
        return venue not in home and venue not in away


@dataclass(frozen=True)
class NeutralTerm:
    home_advantage: float
    grounds: Grounds

    def shift(self, match: Scheduled, known: Sequence[MatchObservation]) -> LogShift | None:
        if not self.grounds.neutral(match):
            return None  # not neutral, or not known to be: the candidate's forecast stands
        return -self.home_advantage, 0.0


class NeutralGround:
    name = "neutral_ground"
    description = (
        "Neutral ground (T-1122, D-145): a match whose stored venue is neither club's usual "
        "ground (the venue of most of its home league matches that season) is forecast "
        "without the fitted home advantage."
    )

    def __init__(self, grounds: Grounds) -> None:
        self.grounds = grounds

    def fit(
        self,
        division: str,
        history: Sequence[MatchObservation],
        fit_date: date,
        model: FittedModel,
    ) -> NeutralTerm:
        return NeutralTerm(model.home_advantage, self.grounds)


FIXTURES_SQL = """
SELECT (f.kickoff_at AT TIME ZONE 'UTC')::date, h.team_id::text, a.team_id::text,
       f.venue_id::text, c.kind = 'league', f.season_id::text
  FROM fixture f
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
  JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
 WHERE f.status <> 'cancelled'
"""


def read_grounds(database_url: str) -> Grounds:
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(FIXTURES_SQL)
        return Grounds(
            Fixture(
                day,
                str(home),
                str(away),
                None if venue is None else str(venue),
                bool(league),
                str(season),
            )
            for day, home, away, venue, league, season in cur.fetchall()
        )


def build(context: InputContext) -> NeutralGround:
    if context.database_url is None:
        raise ValueError("neutral_ground reads the fixtures' venues from the store")
    return NeutralGround(read_grounds(context.database_url))
