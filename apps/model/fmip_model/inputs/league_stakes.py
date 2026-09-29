"""League stakes (T-1120, D-143): a side whose place in the table is locked.

Before a league match, a side is **locked** when, with the matches it and
every other side have left, no side above it can be caught and no side below
it can catch it: for every other side ``U``, either ``U`` is out of reach
(``points(U) > points(T) + 3 * left(T)``) or ``T`` is out of ``U``'s reach
(``points(T) > points(U) + 3 * left(U)``). A tie on points is never locked,
because goal difference could still turn it. The rule needs no qualification
or relegation places (those are not stored; question N-2): a locked side has
nothing left to win or lose in the table, wherever it stands.

The table is computed from stored results as the product's is (D-038: three
points for a win), from the season's matches strictly before the match's day.
Point deductions are not stored, so they are not applied.

**The fixture list.** The matches each side has left are the season's stored
fixture list minus the matches it has played. The list is read in ``build``
for sides and days only, never scores: for a football-data.co.uk division it
is the season's rows in ``training.match`` (a season's pairings are published
before it starts), for one of our records' divisions the league's fixtures in
``fixture`` whatever their status, except cancelled. A season gives no value
unless its list is a complete double round robin (every side meets every other
once at home and once away) -- a split league, a play-off, or a season still
being loaded is "incomplete" -- and a match gives no value when a result of
its season before its day is missing from what the forecast knows.

**The features.** Home goals move by ``exp(b1 * home locked + b2 * away
locked)``, away goals by ``exp(b1 * away locked + b2 * home locked)``: ``b1``
is what being locked does to a side's own scoring, ``b2`` what facing a
locked side does. A match where neither side is locked has nothing to read
(the term would be zero) and is outside the input's sample.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date

import psycopg

from ..model.dixon_coles import MatchObservation
from . import FeatureInput, InputContext, Scheduled

Key = tuple[date, str, str]


@dataclass(frozen=True)
class Listed:
    """A fixture of a season's list: its day and sides, and whether it has been played."""

    date: date
    home: str
    away: str
    played: bool = True


@dataclass(frozen=True)
class SeasonList:
    keys: frozenset[Key]
    #: The matches each side plays in the season.
    totals: Mapping[str, int]
    #: Every side meets every other once at home and once away.
    complete: bool
    #: The played fixtures, oldest first, to check what a forecast knows.
    played: tuple[Key, ...]


def season_list(fixtures: Iterable[Listed]) -> SeasonList:
    rows = list(fixtures)
    keys = frozenset((f.date, f.home, f.away) for f in rows)
    teams = {f.home for f in rows} | {f.away for f in rows}
    pairs = [(f.home, f.away) for f in rows]
    n = len(teams)
    complete = n >= 2 and len(pairs) == n * (n - 1) and len(set(pairs)) == len(pairs)
    totals: dict[str, int] = dict.fromkeys(teams, 0)
    for f in rows:
        totals[f.home] += 1
        totals[f.away] += 1
    played = tuple(sorted((f.date, f.home, f.away) for f in rows if f.played))
    return SeasonList(keys, totals, complete, played)


class Schedule:
    """The season lists of the divisions, and which season a match is in."""

    def __init__(self, lists: Mapping[tuple[str, str], Iterable[Listed]]) -> None:
        self.seasons: dict[tuple[str, str], SeasonList] = {}
        self._of: dict[tuple[str, date, str, str], SeasonList] = {}
        self._label: dict[tuple[str, date, str, str], str] = {}
        for (division, season), fixtures in lists.items():
            built = season_list(fixtures)
            self.seasons[(division, season)] = built
            for key in built.keys:
                self._of[(division, *key)] = built
                self._label[(division, *key)] = season

    def season_of(self, division: str, match: Scheduled) -> SeasonList | None:
        return self._of.get((division, match.date, match.home, match.away))

    def label_of(self, division: str, match: Scheduled) -> str | None:
        """The season's label (``2025/26``) of a listed match (T-1167)."""
        return self._label.get((division, match.date, match.home, match.away))


def locked(team: str, points: Mapping[str, int], left: Mapping[str, int]) -> bool:
    """No other side can end level with or pass ``team`` in either direction."""
    mine, reach = points[team], 3 * left[team]
    return all(
        points[other] > mine + reach or mine > points[other] + 3 * left[other]
        for other in points
        if other != team
    )


def stakes(
    schedule: Schedule, division: str, match: Scheduled, known: Sequence[MatchObservation]
) -> tuple[bool, bool] | None:
    """(home locked, away locked) before ``match``, or None when it cannot be read."""
    season = schedule.season_of(division, match)
    if season is None or not season.complete:
        return None
    results = [m for m in known if m.date < match.date and (m.date, m.home, m.away) in season.keys]
    seen = {(m.date, m.home, m.away) for m in results}
    if any(key[0] < match.date and key not in seen for key in season.played):
        return None  # a result of the season before this day is not in what we know
    points = dict.fromkeys(season.totals, 0)
    played = dict.fromkeys(season.totals, 0)
    for m in results:
        played[m.home] += 1
        played[m.away] += 1
        if m.home_goals > m.away_goals:
            points[m.home] += 3
        elif m.home_goals < m.away_goals:
            points[m.away] += 3
        else:
            points[m.home] += 1
            points[m.away] += 1
    left = {t: season.totals[t] - played[t] for t in season.totals}
    return locked(match.home, points, left), locked(match.away, points, left)


def league_stakes_input(schedule: Schedule) -> FeatureInput:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[list[float], list[float]] | None:
        read = stakes(schedule, division, match, known)
        if read is None or not any(read):
            return None
        home, away = float(read[0]), float(read[1])
        return [home, away], [away, home]

    return FeatureInput(
        "league_stakes",
        "League stakes (T-1120, D-143): whether each side's place in the table is locked "
        "with the matches left, from stored results and the season's stored fixture list; "
        "a fitted term for a locked side's own scoring and for facing one.",
        features,
    )


FOOTBALL_DATA_LIST = """
SELECT m.division, m.season, m.match_date, m.home_team, m.away_team
  FROM training.match m JOIN training.source_load l ON l.id = m.source_load_id
 WHERE m.division = ANY(%s) AND l.source <> 'our_records'
"""

# Our records: the league's fixtures, played or not, by the team ids the
# training rows carry as names (T-512). Sides and days only.
OUR_RECORDS_LIST = """
SELECT c.football_data_division, s.label, (f.kickoff_at AT TIME ZONE 'UTC')::date,
       h.team_id::text, a.team_id::text, f.status = 'finished'
  FROM fixture f
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
  JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
 WHERE c.kind = 'league' AND c.football_data_division = ANY(%s) AND f.status <> 'cancelled'
"""


def read_schedule(database_url: str, divisions: Sequence[str]) -> Schedule:
    lists: dict[tuple[str, str], list[Listed]] = {}
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT m.division FROM training.match m
              JOIN training.source_load l ON l.id = m.source_load_id
             WHERE m.division = ANY(%s) AND l.source = 'our_records'
            """,
            (list(divisions),),
        )
        ours = [str(r[0]) for r in cur.fetchall()]
        cur.execute(FOOTBALL_DATA_LIST, ([d for d in divisions if d not in ours],))
        for division, season, day, home, away in cur.fetchall():
            lists.setdefault((str(division), str(season)), []).append(
                Listed(day, str(home), str(away))
            )
        if ours:
            cur.execute(OUR_RECORDS_LIST, (ours,))
            for division, season, day, home, away, played in cur.fetchall():
                lists.setdefault((str(division), str(season)), []).append(
                    Listed(day, str(home), str(away), bool(played))
                )
    return Schedule(lists)


def build(context: InputContext) -> FeatureInput:
    if context.database_url is None:
        raise ValueError("league_stakes reads the season's fixture list from the store")
    return league_stakes_input(read_schedule(context.database_url, context.divisions))
