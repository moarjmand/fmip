"""Rest with what comes next as a model input (T-1656, D-307).

D-141's ``rest`` read only the days before a match, and failed on a store of
league matches alone. This input adds what comes after, now that the lab store
holds the clubs' European and domestic cup matches (``XL``, T-1649, D-304). For
each side of a match on day ``d``, from the stored schedule:

- **short rest**, as D-141: ``short = clip((7 - rest) / 4, 0, 1)``;
- **congestion**, as D-141: ``extra = max(n - 2, 0)``, ``n`` its stored matches
  in the 14 days before ``d``;
- **European next**: 1 when the store holds a European (UEFA or continental
  cup) match of the side on ``d + 1`` to ``d + 4``, else 0;
- **cup next**: 1 when it holds a domestic cup match of the side on those days.

A side's vector is its own four and its opponent's; ``FeatureInput`` fits the
eight coefficients.

**The schedule** is ``rest.py``'s: every row of ``training.match``, clubs keyed
through ``team_alias`` (``training.own_elo.read_matches``), read to the run's
last day plus the look-ahead. Only days and clubs are kept; a score is never
read. Fixture lists are published ahead, so the day and opponent of the next
match are known before kick-off: reading them is this input's one departure
from the harness's boundary, and it reaches four days ahead, no further. The
store holds a match on the day it was played, so a match postponed after a
forecast was made reads here as no match (D-307: this blurs an effect, it does
not create one).

**European or domestic cup.** ``training.match`` does not name an ``XL`` row's
competition, so its kind is read from the clubs' countries (``countries``): a
club's country is that of its league matches (the division code without its
last character); a club with no league match takes the one country of the
clubs it met in ``XL``, or plays abroad when they are of several. Two countries
or a club abroad: European; one country: a domestic cup; a club of no country:
unclassified.

**Not read** (``None``: the candidate's forecast stands, never a default): a
match of ``XL`` (its next match can depend on its result); a side not bridged
to a team id; a side with no earlier stored match; a side with no country; a
match within four days of the store's end; a side whose country has no
European or no domestic cup match stored in the season (from 1 July) of the
day; a side with an unclassified ``XL`` match in the four days after.
"""

from __future__ import annotations

import re
from bisect import bisect_right
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg

from ..model.cross_league import CROSS_LEAGUE
from ..model.dixon_coles import MatchObservation
from ..training.own_elo import Conn, read_matches
from . import FeatureInput, Features, InputContext, Scheduled
from .rest import ClubKeys, Schedule, extra_matches, short_rest

#: A European or domestic cup match on ``d + 1`` to ``d + 4`` is what comes next.
LOOKAHEAD_DAYS = 4
#: A season runs from 1 July, for the store's coverage of a country's cups.
SEASON_START_MONTH = 7
#: The catalogue's division format: a country's one or two letters, then its level.
DIVISION_CODE = re.compile(r"^([A-Z]{1,2})[0-9C]$")
#: The country of a club seen only in ``XL``, against clubs of several countries.
ABROAD = "abroad"

EUROPEAN = "european"
CUP = "cup"


@dataclass(frozen=True)
class StoredMatch:
    """A stored match as this input reads it: its division, day and clubs, no score."""

    division: str
    date: date
    home: str
    away: str


def division_country(division: str) -> str | None:
    """``E0`` and ``E1`` are ``E``, ``SC0`` is ``SC``; ``XL`` and any other code: none."""
    if division == CROSS_LEAGUE:
        return None
    code = DIVISION_CODE.match(division)
    return None if code is None else code.group(1)


def season_of(day: date) -> int:
    """The year a season starts in, the season running from 1 July."""
    return day.year if day.month >= SEASON_START_MONTH else day.year - 1


def countries(matches: Sequence[StoredMatch]) -> dict[str, str | None]:
    """Each club's country (``None`` when it cannot be told; ``ABROAD`` for a club
    seen only in ``XL`` against clubs of several countries).

    A country is a fixed attribute of a club, not a result, so every stored
    match is read for it, whatever its day.
    """
    leagues: dict[str, set[str]] = {}
    met: dict[str, list[str]] = {}
    for m in matches:
        if m.division == CROSS_LEAGUE:
            met.setdefault(m.home, []).append(m.away)
            met.setdefault(m.away, []).append(m.home)
            continue
        country = division_country(m.division)
        if country is not None:
            for club in (m.home, m.away):
                leagues.setdefault(club, set()).add(country)
    own = {club: next(iter(c)) if len(c) == 1 else None for club, c in leagues.items()}
    result: dict[str, str | None] = dict(own)
    for club, opponents in met.items():
        if club in leagues:
            continue
        # Only opponents' own league countries, never an inferred one: no chains.
        seen = {c for o in opponents if (c := own.get(o)) is not None}
        result[club] = seen.pop() if len(seen) == 1 else ABROAD if seen else None
    return result


def kind_of(home: str | None, away: str | None) -> str | None:
    """An ``XL`` match's kind from its clubs' countries; ``None`` is unclassified."""
    if home is None or away is None:
        return None
    if home == ABROAD or away == ABROAD or home != away:
        return EUROPEAN
    return CUP


class NextSchedule:
    """Each club's days before a match (``rest``) and its ``XL`` matches after it, by kind."""

    def __init__(self, matches: Iterable[StoredMatch], horizon: date) -> None:
        stored = list(matches)
        #: The last day the store is known to cover; the look-ahead never passes it.
        self.horizon = horizon
        self.rest = Schedule([(club, m.date) for m in stored for club in (m.home, m.away)])
        self.countries = countries(stored)
        self.kinds: Counter[str] = Counter()
        ahead: dict[str, list[tuple[date, str | None]]] = {}
        covered: dict[tuple[str, str], set[int]] = {}
        for m in stored:
            if m.division != CROSS_LEAGUE:
                continue
            kind = kind_of(self.countries.get(m.home), self.countries.get(m.away))
            self.kinds[kind or "unclassified"] += 1
            for club in (m.home, m.away):
                ahead.setdefault(club, []).append((m.date, kind))
                country = self.countries.get(club)
                if kind is not None and country not in (None, ABROAD):
                    covered.setdefault((str(country), kind), set()).add(season_of(m.date))
        self._days: dict[str, list[date]] = {}
        self._kinds: dict[str, list[str | None]] = {}
        for club, rows in ahead.items():
            rows.sort(key=lambda row: row[0])
            self._days[club] = [day for day, _ in rows]
            self._kinds[club] = [kind for _, kind in rows]
        self.covered: Mapping[tuple[str, str], set[int]] = covered

    def is_covered(self, country: str, day: date) -> bool:
        """The store holds the country's European and domestic cup matches in the day's season."""
        season = season_of(day)
        return all(season in self.covered.get((country, kind), set()) for kind in (EUROPEAN, CUP))

    def next_matches(self, club: str, day: date) -> tuple[float, float] | None:
        """(a European match on ``day + 1`` to ``day + 4``, a domestic cup match on
        those days), each 1 or 0; ``None`` where the store cannot say."""
        if day + timedelta(days=LOOKAHEAD_DAYS) > self.horizon:
            return None
        country = self.countries.get(club)
        if country is None or country == ABROAD or not self.is_covered(country, day):
            return None
        days = self._days.get(club, [])
        start = bisect_right(days, day)
        end = bisect_right(days, day + timedelta(days=LOOKAHEAD_DAYS))
        european = cup = 0.0
        for kind in self._kinds.get(club, [])[start:end]:
            if kind is None:
                return None  # a cup or European match, not known which
            if kind == EUROPEAN:
                european = 1.0
            else:
                cup = 1.0
        return european, cup

    def seasons_read(self, country: str) -> list[int]:
        """The seasons in which the country's sides can be read."""
        return sorted(
            self.covered.get((country, EUROPEAN), set()) & self.covered.get((country, CUP), set())
        )


def features_from(schedule: NextSchedule, keys: ClubKeys) -> Features:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[list[float], list[float]] | None:
        if division == CROSS_LEAGUE:
            return None  # a cup match's next match can depend on its result
        sides: list[tuple[float, float, float, float]] = []
        for name in (match.home, match.away):
            club = keys.aliases.get(division, {}).get(name)
            if club is None:
                return None  # not bridged: its cups and European matches are not seen
            before = schedule.rest.rest(club, match.date)
            after = schedule.next_matches(club, match.date)
            if before is None or after is None:
                return None
            sides.append((short_rest(before[0]), extra_matches(before[1]), *after))
        (sh, xh, eh, ch), (sa, xa, ea, ca) = sides
        return [sh, sa, xh, xa, eh, ea, ch, ca], [sa, sh, xa, xh, ea, eh, ca, ch]

    return features


def season_runs(seasons: Sequence[int]) -> str:
    """``[2020, 2021, 2024]`` as ``2020/21-2021/22, 2024/25``."""
    runs: list[tuple[int, int]] = []
    for s in seasons:
        if runs and s == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], s)
        else:
            runs.append((s, s))

    def label(s: int) -> str:
        return f"{s}/{(s + 1) % 100:02d}"

    return ", ".join(label(a) if a == b else f"{label(a)}-{label(b)}" for a, b in runs) or "none"


def describe(schedule: NextSchedule, divisions: Sequence[str]) -> str:
    kinds = schedule.kinds
    read = sorted({c for d in divisions if (c := division_country(d)) is not None})
    seasons = "; ".join(f"{c} {season_runs(schedule.seasons_read(c))}" for c in read)
    return (
        "Rest with what comes next (T-1656, D-307): each side's short rest and congestion as "
        f"D-141, and a European or a domestic cup match stored in the {LOOKAHEAD_DAYS} days "
        "after, own and opponent's, eight coefficients fitted by FeatureInput. An XL match's "
        "kind is read from its clubs' countries (their league matches' division codes). Stored "
        f"XL matches: {kinds[EUROPEAN]} European, {kinds[CUP]} domestic cup, "
        f"{kinds['unclassified']} unclassified. Seasons read by country: {seasons or 'none'}. "
        "Not read: XL matches, unbridged sides, a side with no earlier match, a season whose "
        f"cups or European matches are not stored, the store's last {LOOKAHEAD_DAYS} days."
    )


def rest_next_input(
    schedule: NextSchedule, keys: ClubKeys, divisions: Sequence[str] = ()
) -> FeatureInput:
    return FeatureInput("rest_next", describe(schedule, divisions), features_from(schedule, keys))


def read_schedule(conn: Conn, until: date) -> tuple[NextSchedule, ClubKeys]:
    """The schedule to ``until`` plus the look-ahead, and the bridge, as ``rest`` reads them."""
    through = until + timedelta(days=LOOKAHEAD_DAYS)
    stored = [StoredMatch(m.division, m.date, m.home, m.away) for m in read_matches(conn, through)]
    aliases: dict[str, dict[str, str]] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT max(match_date) FROM training.match")
        row = cur.fetchone()
        last = row[0] if row is not None and isinstance(row[0], date) else until
        cur.execute("SELECT division, training_name, team_id::text FROM training.team_alias")
        for division, name, team_id in cur.fetchall():
            aliases.setdefault(str(division), {})[str(name)] = str(team_id)
    return NextSchedule(stored, min(last, through)), ClubKeys(aliases)


def build(context: InputContext) -> FeatureInput:
    if context.database_url is None:
        raise LookupError("the rest_next input reads the stored schedule: DATABASE_URL is needed")
    with psycopg.connect(context.database_url) as conn:
        schedule, keys = read_schedule(conn, context.until)
    return rest_next_input(schedule, keys, context.divisions)
