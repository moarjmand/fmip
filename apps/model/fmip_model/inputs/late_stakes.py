"""Late-season stakes as an input (T-1659, D-311): what each side can still win or lose.

Only the **last eight rounds** of a domestic league season: a match is read
when each side has at most ``ROUNDS`` league matches left, this one included.

**The season and its table** are D-143's and D-171's: the season's stored
fixture list is a complete double round robin; the table is computed from
stored results strictly before the match's day (3/1/0, D-038, no deductions);
no result of the season before the day is missing; the committed zones
(``_zones``) have a ``complete`` entry for the season whose club count equals
the list's. Any other season gives no value (rule 3), never a zone-free guess.

**Finishes** are D-171's: best is one plus the sides already out of reach,
worst one plus the other sides that can still end level with it or above (a
level finish counted against it). Each side's **state**:

- **up**: it can still win the title or a prize place it is not yet sure of
  (place 1, and the last place of every listed zone that is not a relegation
  one): ``best <= place < worst``;
- **danger**: it can still fall into a relegation place or the relegation
  play-off and is not yet sure to (the first place of every relegation zone):
  ``best < place <= worst``;
- **nothing**: neither -- safe with nothing to win, already sure of its prize,
  or already down.

A side can be up and in danger at once. The vectors are ``[up, danger,
nothing]`` own then opponent's: six coefficients fitted by ``FeatureInput``,
read only when fitted on enough matches (``_lab.MinimumFit``). Every read match
has a non-zero vector, so the sample is every read match of the last eight
rounds. Our records' fixture lists are read from ``_lab.records_url``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import psycopg

from ..model.dixon_coles import MatchObservation
from . import FeatureInput, InputContext, Scheduled
from ._lab import MinimumFit, records_url
from ._zones import SeasonZones, read
from .league_stakes import FOOTBALL_DATA_LIST, OUR_RECORDS_LIST, Listed, Schedule, SeasonList

#: The last rounds read: each side has at most this many league matches left, this one included.
ROUNDS = 8
COEFFICIENTS = 6


@dataclass(frozen=True)
class State:
    """What a side can still win or lose in the table."""

    up: bool
    danger: bool

    @property
    def nothing(self) -> bool:
        return not (self.up or self.danger)

    def vector(self) -> tuple[float, float, float]:
        return float(self.up), float(self.danger), float(self.nothing)


def cuts(zones: SeasonZones) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """The places a prize is decided at (each prize's last place, 1 for the title), and a drop."""
    prize = {1} | {last for kind, _, last in zones.zones if not kind.startswith("relegation")}
    drop = {first for kind, first, _ in zones.zones if kind.startswith("relegation")}
    return tuple(sorted(prize)), tuple(sorted(drop))


def finishes(team: str, points: Mapping[str, int], left: Mapping[str, int]) -> tuple[int, int]:
    """The best and worst places ``team`` can still finish in (D-171)."""
    mine, reach = points[team], 3 * left[team]
    others = [u for u in points if u != team]
    best = 1 + sum(1 for u in others if points[u] > mine + reach)
    worst = 1 + sum(1 for u in others if points[u] + 3 * left[u] >= mine)
    return best, worst


def state(
    team: str,
    points: Mapping[str, int],
    left: Mapping[str, int],
    prize: Sequence[int],
    drop: Sequence[int],
) -> State:
    best, worst = finishes(team, points, left)
    return State(
        up=any(best <= place < worst for place in prize),
        danger=any(best < place <= worst for place in drop),
    )


def table(
    season: SeasonList, match: Scheduled, known: Sequence[MatchObservation]
) -> tuple[dict[str, int], dict[str, int]] | None:
    """(points, matches left) before ``match``'s day, or None when a result is missing."""
    results = [m for m in known if m.date < match.date and (m.date, m.home, m.away) in season.keys]
    seen = {(m.date, m.home, m.away) for m in results}
    if any(k[0] < match.date and k not in seen for k in season.played):
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
    return points, {t: season.totals[t] - played[t] for t in season.totals}


def late_states(
    schedule: Schedule,
    zones: Mapping[tuple[str, str], SeasonZones],
    division: str,
    match: Scheduled,
    known: Sequence[MatchObservation],
) -> tuple[State, State] | None:
    """(home state, away state) in the last eight rounds, or None when not read."""
    label = schedule.label_of(division, match)
    if label is None:
        return None
    season = schedule.seasons[(division, label)]
    entry = zones.get((division, label))
    if entry is None or not entry.complete or not season.complete:
        return None
    if len(season.totals) != entry.teams:
        return None
    read_ = table(season, match, known)
    if read_ is None:
        return None
    points, left = read_
    if left[match.home] > ROUNDS or left[match.away] > ROUNDS:
        return None
    prize, drop = cuts(entry)
    return (
        state(match.home, points, left, prize, drop),
        state(match.away, points, left, prize, drop),
    )


def late_stakes_input(
    schedule: Schedule, zones: Mapping[tuple[str, str], SeasonZones]
) -> MinimumFit:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[Sequence[float], Sequence[float]] | None:
        read_ = late_states(schedule, zones, division, match, known)
        if read_ is None:
            return None
        home, away = read_[0].vector(), read_[1].vector()
        return (*home, *away), (*away, *home)

    covered = sorted(f"{d} {s}" for (d, s), z in zones.items() if z.complete)
    return MinimumFit(
        FeatureInput(
            "late_stakes",
            f"Late-season stakes (T-1659, D-311): in the last {ROUNDS} rounds of a league "
            f"season, each side up (the title or a prize place still open), in danger (a "
            f"relegation place still open) or with nothing to play for, from the table the day "
            f"before and the committed zones; own and opponent's states fitted by FeatureInput. "
            f"Seasons with complete zones: {', '.join(covered) or 'none'}.",
            features,
        ),
        COEFFICIENTS,
    )


OURS_SQL = """
SELECT DISTINCT m.division FROM training.match m
  JOIN training.source_load l ON l.id = m.source_load_id
 WHERE m.division = ANY(%s) AND l.source = 'our_records'
"""


def read_lists(database_url: str, records: str, divisions: Sequence[str]) -> Schedule:
    """The season lists as ``league_stakes.read_schedule`` reads them, ours from ``records``."""
    lists: dict[tuple[str, str], list[Listed]] = {}
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(OURS_SQL, (list(divisions),))
        ours = [str(r[0]) for r in cur.fetchall()]
        cur.execute(FOOTBALL_DATA_LIST, ([d for d in divisions if d not in ours],))
        for division, season, day, home, away in cur.fetchall():
            lists.setdefault((str(division), str(season)), []).append(
                Listed(day, str(home), str(away))
            )
    if ours:
        with psycopg.connect(records) as conn, conn.cursor() as cur:
            cur.execute(OUR_RECORDS_LIST, (ours,))
            for division, season, day, home, away, played in cur.fetchall():
                lists.setdefault((str(division), str(season)), []).append(
                    Listed(day, str(home), str(away), bool(played))
                )
    return Schedule(lists)


def build(context: InputContext) -> MinimumFit:
    if context.database_url is None:
        raise LookupError("late_stakes reads the season's fixture list: DATABASE_URL is needed")
    schedule = read_lists(
        context.database_url, records_url(context.database_url), context.divisions
    )
    return late_stakes_input(schedule, read())
