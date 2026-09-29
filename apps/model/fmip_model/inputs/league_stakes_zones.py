"""League stakes read with zones (T-1167, D-171): a side with nothing left to play for.

D-143's ``league_stakes`` calls a side locked only when its exact place is
settled, which is rare (1.5% of matches). With the season's zones from the
committed list (``packages/contracts/zones/league-zones.json``), a side is
**settled** when its best and its worst possible finish fall in the same
band of places: the champion's place, a listed zone (Champions League,
promotion, a play-off, relegation), or a run of places between zones. A
mid-table side that can no longer reach Europe nor drop into the relegation
places is settled; so is a side already down.

- **Best finish**: one plus the sides already out of its reach
  (``points(U) > points(T) + 3 * left(T)``).
- **Worst finish**: one plus the other sides that can still end level with it
  or above (``points(U) + 3 * left(U) >= points(T)``) -- a level finish may go
  either way (goal difference), so it counts against the side.

Everything else is ``league_stakes``'s: the table from stored results strictly
before the match's day (3/1/0, no deductions), the matches left from the
season's stored fixture list, a season read only when that list is a complete
double round robin, and no value when a result of the season before the day
is missing. A season is read only when the list has a **complete** entry for
it whose club count matches the fixture list's; any other season gives no
value (rule 3), never a zone-free fallback.

Features and fit as ``league_stakes``: own settled and opponent settled,
fitted by ``FeatureInput``; a match where neither side is settled is not read.
The zones are the places the regulations fix before the season (UEFA's
European Performance Spot and the cups' places are not in the list), so the
input sees nothing decided after the match's day.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from ..model.dixon_coles import MatchObservation
from . import FeatureInput, InputContext, Scheduled
from ._zones import SeasonZones, read
from .league_stakes import Schedule, read_schedule


def settled(
    team: str, points: Mapping[str, int], left: Mapping[str, int], bands: Sequence[int]
) -> bool:
    """Whether ``team``'s best and worst possible finish are in the same band."""
    mine, reach = points[team], 3 * left[team]
    others = [u for u in points if u != team]
    best = 1 + sum(1 for u in others if points[u] > mine + reach)
    worst = 1 + sum(1 for u in others if points[u] + 3 * left[u] >= mine)
    return bands[best - 1] == bands[worst - 1]


def zone_stakes(
    schedule: Schedule,
    zones: Mapping[tuple[str, str], SeasonZones],
    division: str,
    match: Scheduled,
    known: Sequence[MatchObservation],
) -> tuple[bool, bool] | None:
    """(home settled, away settled) before ``match``, or None when it cannot be read."""
    label = schedule.label_of(division, match)
    if label is None:
        return None
    key = (division, label)
    season = schedule.seasons[key]
    entry = zones.get(key)
    if entry is None or not entry.complete or not season.complete:
        return None
    if len(season.totals) != entry.teams:
        return None
    results = [m for m in known if m.date < match.date and (m.date, m.home, m.away) in season.keys]
    seen = {(m.date, m.home, m.away) for m in results}
    if any(k[0] < match.date and k not in seen for k in season.played):
        return None
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
    bands = entry.bands()
    return settled(match.home, points, left, bands), settled(match.away, points, left, bands)


def league_stakes_zones_input(
    schedule: Schedule, zones: Mapping[tuple[str, str], SeasonZones]
) -> FeatureInput:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[list[float], list[float]] | None:
        read_ = zone_stakes(schedule, zones, division, match, known)
        if read_ is None or not any(read_):
            return None
        home, away = float(read_[0]), float(read_[1])
        return [home, away], [away, home]

    return FeatureInput(
        "league_stakes_zones",
        "League stakes with zones (T-1167, D-171): whether each side's finish is settled "
        "within one band of the season's committed zones, from stored results and the "
        "season's stored fixture list; a fitted term for a settled side's own scoring and "
        "for facing one.",
        features,
    )


def build(context: InputContext) -> FeatureInput:
    if context.database_url is None:
        raise ValueError("league_stakes_zones reads the season's fixture list from the store")
    return league_stakes_zones_input(read_schedule(context.database_url, context.divisions), read())
