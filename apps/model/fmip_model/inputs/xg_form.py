"""Expected-goals form: what a side's recent results owe to finishing and luck (T-1652, D-312).

The model reads goals only, so a side that has scored more than its chances
is fitted as a better attack than it is, and one whose opponents missed theirs
as a better defence. For each side of a match, from its stored matches with
both sides' expected goals strictly before the match's day:

- **attack**: the time-weighted mean of ``xG for - goals for`` over its last
  ``WINDOW`` such matches, shrunk toward zero. Above zero, the side scored
  fewer than its chances: the goals-based fit underrates its attack.
- **defence**: the same of ``xG against - goals against``. Above zero, it
  conceded fewer than the chances against it: the fit overrates its defence.

Each match weighs ``0.5 ** (age / HALF_LIFE_DAYS)`` and the mean is shrunk by
``PSEUDO_MATCHES`` matches of zero, ``sum(w * d) / (sum(w) + PSEUDO_MATCHES)``,
so a few matches move it little. The home side's features are ``[home attack,
away defence]``, the away side's ``[away attack, home defence]``;
``FeatureInput`` fits the two coefficients by time-weighted Poisson likelihood
with the model's expected goals as offsets. The constants were fixed in D-312
before any run and are not tuned.

**A side's matches with xG** are every ``training.match`` row, in any
division, with its clubs keyed through ``training.team_alias`` (our records
name a club by its team id, taken as it is where no alias row names it),
matched to a ``training.fixture_stat`` row with both sides' xG: the same home
and away team ids, the date within ``DATE_SLACK_DAYS`` (ours is the kick-off's
UTC date, football-data's the local one). The nearest date wins; two rows
equally near, or one figure row matched to two stored rows, is a gap, never a
guess. The match's day is the ``training.match`` row's, and only days strictly
before a match's day are ever read for it.

A side with fewer than ``MIN_MATCHES`` matches with xG before the day gives
the match no value (rule 3): the candidate's forecast stands and the match is
outside the sample.
"""

from __future__ import annotations

import math
import uuid
from bisect import bisect_left
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg

from ..model.dixon_coles import MatchObservation
from ..training.own_elo import Conn
from . import FeatureInput, Features, InputContext, Scheduled

#: The side's last matches with xG that are read.
WINDOW = 10
#: Fewer matches with xG than this before the day: no value.
MIN_MATCHES = 3
#: A match 120 days old counts half as much as one today.
HALF_LIFE_DAYS = 120
#: Matches of zero added to the weights: few matches move the form little.
PSEUDO_MATCHES = 5.0
#: Our date (the kick-off's in UTC) and football-data's (local) may differ by this.
DATE_SLACK_DAYS = 1

Aliases = Mapping[str, Mapping[str, str]]


@dataclass(frozen=True)
class StoredMatch:
    """A ``training.match`` row: its division, day, training names and score."""

    division: str
    date: date
    home: str
    away: str
    home_goals: int
    away_goals: int


@dataclass(frozen=True)
class StatRow:
    """A ``training.fixture_stat`` row with both sides' expected goals."""

    fixture_id: str
    date: date
    home_team_id: str
    away_team_id: str
    home_xg: float
    away_xg: float


@dataclass(frozen=True)
class Played:
    """One side's match with xG, from its own view."""

    date: date
    xg_for: float
    goals_for: int
    xg_against: float
    goals_against: int


@dataclass(frozen=True)
class Form:
    attack: float
    defence: float
    matches: int


def team_id_of(aliases: Aliases, division: str, name: str) -> str | None:
    """A training name's team id: the bridge's, else the name itself when it is a
    team id (our records), else none -- never a match by likeness."""
    found = aliases.get(division, {}).get(name)
    if found:
        return found
    try:
        return str(uuid.UUID(name))
    except ValueError:
        return None


def match_stats(
    matches: Iterable[StoredMatch], stats: Iterable[StatRow], aliases: Aliases
) -> dict[str, list[Played]]:
    """Each team id's matches with xG, oldest first."""
    by_pair: dict[tuple[str, str], list[StatRow]] = {}
    for s in stats:
        by_pair.setdefault((s.home_team_id, s.away_team_id), []).append(s)
    claims: dict[str, list[tuple[StoredMatch, StatRow]]] = {}
    for m in matches:
        home = team_id_of(aliases, m.division, m.home)
        away = team_id_of(aliases, m.division, m.away)
        if home is None or away is None or home == away:
            continue
        near = sorted(
            (
                (abs((s.date - m.date).days), s)
                for s in by_pair.get((home, away), ())
                if abs((s.date - m.date).days) <= DATE_SLACK_DAYS
            ),
            key=lambda found: found[0],
        )
        if not near or (len(near) > 1 and near[0][0] == near[1][0]):
            continue
        best = near[0][1]
        claims.setdefault(best.fixture_id, []).append((m, best))
    played: dict[str, list[Played]] = {}
    for claimed in claims.values():
        if len(claimed) != 1:
            continue
        m, s = claimed[0]
        played.setdefault(s.home_team_id, []).append(
            Played(m.date, s.home_xg, m.home_goals, s.away_xg, m.away_goals)
        )
        played.setdefault(s.away_team_id, []).append(
            Played(m.date, s.away_xg, m.away_goals, s.home_xg, m.home_goals)
        )
    for rows in played.values():
        rows.sort(key=lambda p: p.date)
    return played


def form(played: Sequence[Played], dates: Sequence[date], day: date) -> Form | None:
    """The shrunk, time-weighted form over the last ``WINDOW`` matches strictly before
    ``day`` (``dates`` is ``played``'s, oldest first); ``None`` below ``MIN_MATCHES``."""
    end = bisect_left(dates, day)
    recent = played[max(0, end - WINDOW) : end]
    if len(recent) < MIN_MATCHES:
        return None
    rate = math.log(2) / HALF_LIFE_DAYS
    weights = attack = defence = 0.0
    for p in recent:
        w = math.exp(-rate * (day - p.date).days)
        weights += w
        attack += w * (p.xg_for - p.goals_for)
        defence += w * (p.xg_against - p.goals_against)
    shrunk = weights + PSEUDO_MATCHES
    return Form(attack / shrunk, defence / shrunk, len(recent))


class XgHistory:
    """Every team id's matches with xG, and the bridge to reach them from a division."""

    def __init__(self, played: Mapping[str, Sequence[Played]], aliases: Aliases) -> None:
        self.played = {team: list(rows) for team, rows in played.items()}
        self.dates = {team: [p.date for p in rows] for team, rows in self.played.items()}
        self.aliases = aliases

    def form(self, division: str, name: str, day: date) -> Form | None:
        team = team_id_of(self.aliases, division, name)
        if team is None or team not in self.played:
            return None
        return form(self.played[team], self.dates[team], day)


def features_from(history: XgHistory) -> Features:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[list[float], list[float]] | None:
        home = history.form(division, match.home, match.date)
        away = history.form(division, match.away, match.date)
        if home is None or away is None:
            return None
        return [home.attack, away.defence], [away.attack, home.defence]

    return features


DESCRIPTION = (
    f"Expected-goals form (D-312): each side's xG minus goals, for and against, over its "
    f"last {WINDOW} stored matches with both sides' xG (training.fixture_stat, any division, "
    f"clubs keyed through team_alias, the date within {DATE_SLACK_DAYS} day), half-life "
    f"{HALF_LIFE_DAYS} days, shrunk by {PSEUDO_MATCHES:g} matches of zero; a side with fewer "
    f"than {MIN_MATCHES} is not read. Features: own attack and the opponent's defence."
)


def xg_form_input(history: XgHistory) -> FeatureInput:
    return FeatureInput("xg_form", DESCRIPTION, features_from(history))


def _day(value: object) -> date:
    if not isinstance(value, date):
        raise TypeError(f"expected a date, got {value!r}")
    return value


def read_history(conn: Conn, until: date) -> XgHistory:
    """The stored matches on or before ``until``, the figure rows up to a day after it
    (the UTC date) and the bridge, as training and serving both read them."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT division, match_date, home_team, away_team, home_goals, away_goals
              FROM training.match
             WHERE match_date <= %s AND home_goals IS NOT NULL AND away_goals IS NOT NULL
            """,
            (until,),
        )
        matches = [
            StoredMatch(str(r[0]), _day(r[1]), str(r[2]), str(r[3]), int(str(r[4])), int(str(r[5])))
            for r in cur.fetchall()
        ]
        cur.execute(
            """
            SELECT fixture_id::text, match_date, home_team_id::text, away_team_id::text,
                   home_xg, away_xg
              FROM training.fixture_stat
             WHERE match_date <= %s AND home_xg IS NOT NULL AND away_xg IS NOT NULL
            """,
            (until + timedelta(days=DATE_SLACK_DAYS),),
        )
        stats = [
            StatRow(str(r[0]), _day(r[1]), str(r[2]), str(r[3]), float(str(r[4])), float(str(r[5])))
            for r in cur.fetchall()
        ]
        cur.execute("SELECT division, training_name, team_id::text FROM training.team_alias")
        aliases: dict[str, dict[str, str]] = {}
        for division, name, team_id in cur.fetchall():
            aliases.setdefault(str(division), {})[str(name)] = str(team_id)
    return XgHistory(match_stats(matches, stats, aliases), aliases)


def build(context: InputContext) -> FeatureInput:
    if context.database_url is None:
        raise LookupError("the xg_form input reads training.fixture_stat: DATABASE_URL is needed")
    with psycopg.connect(context.database_url) as conn:
        history = read_history(conn, context.until)
    return xg_form_input(history)
