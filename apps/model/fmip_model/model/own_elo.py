"""Our own Elo, computed from the training store's results (T-921, D-111).

Club Elo (D-016) has been the model's long-term prior (D-029); when it does not
answer, the fit has none. This is the same kind of number computed from what
we already hold: every result in ``training.match``, football-data.co.uk's
divisions and our own records of the licensed feed (D-083), and nothing else.

A pure function of an ordered list of matches and a day. The matches name
clubs by their key -- the catalogue id where the committed bridge names the
club (D-080), else ``<division>:<name>`` -- so a club's league and cup matches
are one club's, and two sources' spellings are never matched by likeness.

The rules are the World Football Elo ones, frozen per version:

- expected score of the home side ``1 / (1 + 10^(-(R_home + H - R_away) / 400))``;
- the change ``K * G * (S - E)``, added to the home side, taken from the away;
- ``G`` grows with the goal difference: 1 for a draw or one goal, 1.5 for two,
  ``(11 + d) / 8`` for three or more;
- a club enters at ``start`` on its first match. A club with no match has no
  rating at all: it is left out, not given ``start`` (rule 3).
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class EloRules:
    name: str
    version: str
    k: float
    home_advantage: float
    start: float

    @property
    def id(self) -> str:
        return f"{self.name}@{self.version}"


#: The rules the service computes and stores daily. A changed constant is a
#: new version, and a new run beside the old one (``own_elo_run.rules``).
RULES = EloRules(name="own-elo", version="1.0.0", k=20.0, home_advantage=60.0, start=1500.0)


@dataclass(frozen=True)
class EloMatch:
    division: str
    date: date
    home: str
    away: str
    home_goals: int
    away_goals: int


@dataclass(frozen=True)
class ClubElo:
    club: str
    #: The division of the club's newest match.
    division: str
    elo: float
    matches: int
    last_match_date: date


@dataclass(frozen=True)
class EloComputation:
    day: date
    rules: EloRules
    match_count: int
    first_match_date: date | None
    last_match_date: date | None
    matches_sha256: str
    ratings: Mapping[str, ClubElo]


def ordered(matches: Iterable[EloMatch]) -> list[EloMatch]:
    """The order the ratings are moved in: by day, then division and clubs, for ties."""
    return sorted(matches, key=lambda m: (m.date, m.division, m.home, m.away))


def matches_digest(matches: Sequence[EloMatch]) -> str:
    """sha256 over the matches as applied: what a recomputation must read again."""
    h = hashlib.sha256()
    for m in matches:
        h.update(
            f"{m.division}|{m.date.isoformat()}|{m.home}|{m.away}|{m.home_goals}|{m.away_goals}\n".encode()
        )
    return h.hexdigest()


def goal_multiplier(difference: int) -> float:
    d = abs(difference)
    if d <= 1:
        return 1.0
    if d == 2:
        return 1.5
    return (11 + d) / 8


def compute(matches: Iterable[EloMatch], day: date, rules: EloRules = RULES) -> EloComputation:
    """Every club's rating after every match on or before ``day``, and what was read."""
    applied = ordered(m for m in matches if m.date <= day)
    elo: dict[str, float] = {}
    played: dict[str, int] = {}
    last: dict[str, tuple[date, str]] = {}
    for m in applied:
        rh = elo.get(m.home, rules.start)
        ra = elo.get(m.away, rules.start)
        expected = 1.0 / (1.0 + 10.0 ** (-(rh + rules.home_advantage - ra) / 400.0))
        diff = m.home_goals - m.away_goals
        score = 1.0 if diff > 0 else 0.5 if diff == 0 else 0.0
        change = rules.k * goal_multiplier(diff) * (score - expected)
        elo[m.home] = rh + change
        elo[m.away] = ra - change
        for club in (m.home, m.away):
            played[club] = played.get(club, 0) + 1
            last[club] = (m.date, m.division)
    ratings = {
        club: ClubElo(
            club=club,
            division=last[club][1],
            elo=round(value, 2),
            matches=played[club],
            last_match_date=last[club][0],
        )
        for club, value in elo.items()
    }
    return EloComputation(
        day=day,
        rules=rules,
        match_count=len(applied),
        first_match_date=applied[0].date if applied else None,
        last_match_date=applied[-1].date if applied else None,
        matches_sha256=matches_digest(applied),
        ratings=ratings,
    )


def for_division(
    ratings: Mapping[str, float], division: str, aliases: Mapping[str, str]
) -> dict[str, float]:
    """The ratings a fit of ``division`` can read, by its training names.

    ``aliases`` is the division's bridge, catalogue id to training name. A club
    the bridge names is found under its id; one it does not is found under
    ``<division>:<name>``. Nothing else is matched.
    """
    out: dict[str, float] = {}
    for team_id, name in aliases.items():
        if team_id in ratings:
            out[name] = ratings[team_id]
    prefix = f"{division}:"
    for club, value in ratings.items():
        if club.startswith(prefix):
            out.setdefault(club[len(prefix) :], value)
    return out
