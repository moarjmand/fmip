"""Regulars missing from the XI as a model input (T-1655, D-313).

For each side of a match, from ``training.fixture_lineup`` (T-1648, D-305):

- **the index**: over the side's window (below), the share of its minutes
  played by players who are not in this match's starting XI. Rotation and
  absence count alike: a regular rested, injured, suspended, sold or dropped
  to the bench is missing all the same. A side starting its usual XI is near 0
  (its substitutes' minutes are the floor), six changes near one half.
- **the goalkeeper flag**: 1 when the goalkeeper with the most minutes over
  the window does not start (keepers level on minutes: 1 only when none of
  them starts), else 0.

**The window** is the side's newest ``WINDOW`` earlier line-ups: any
competition and division but friendlies, strictly before the match's day (the
earlier of the training row's date and the own fixture's UTC date, the own
fixture never), at most ``MAX_AGE_DAYS`` before it, each complete (exactly
``XI_SIZE`` starters, every one with minutes). A NULL on a substitute is one
who did not come on and adds nothing; a starter without minutes means partial
statistics, and that line-up is skipped, never filled in.

A side's vector is ``[own index, opponent's index, own flag, opponent's
flag]``; ``FeatureInput`` fits the four coefficients by time-weighted Poisson
likelihood with the candidate's expected goals as offsets (D-086's method),
and a term fitted on fewer than 25 matches per coefficient is not read
(``_lab.MinimumFit``, as D-310 and D-311's inputs).

**When it applies.** The index reads the match's own starting XI, so it
belongs to the forecast made once both line-ups are confirmed (the
``lineups_confirmed`` snapshot), as D-121's term did with both XIs measured.
Everything else is read strictly before the match's day.

**Matching.** A training row's clubs become team ids through
``training.team_alias`` (identity rows for our records, the bridge for
football-data's), and its match is the one stored fixture where both team ids
have a line-up within one day of the row's date (ours is the kick-off's UTC
date, the site's the local one).

**Not read** (rule 3), and the candidate's forecast stands: a club the bridge
does not name, no such fixture or more than one, a stored XI of other than
``XI_SIZE`` starters, fewer than ``MIN_EARLIER`` line-ups in a side's window, or
no goalkeeper with minutes in it. The constants are fixed in D-313 before any
run, not tuned.
"""

from __future__ import annotations

import argparse
import os
import sys
from bisect import bisect_left, bisect_right
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg

from ..model.dixon_coles import MatchObservation
from ..training.own_elo import Conn
from . import FeatureInput, Features, InputContext, Scheduled
from ._lab import MinimumFit

#: The side's newest earlier line-ups the index is read over ...
WINDOW = 10
#: ... at least this many of them, or the side is not read ...
MIN_EARLIER = 5
#: ... none older than this before the match's day.
MAX_AGE_DAYS = 365
#: A complete XI: the match's own, and every line-up of a window.
XI_SIZE = 11
#: Our records date a match by its UTC kick-off, football-data by the local day.
DATE_TOLERANCE_DAYS = 1
#: Not a selection: a friendly's line-up is never in a window.
FRIENDLY = "friendly"
GOALKEEPER = "goalkeeper"


@dataclass(frozen=True, slots=True)
class Appearance:
    """One row of ``training.fixture_lineup``: a player named on a side's line-up."""

    fixture: str
    team: str
    person: str
    day: date
    started: bool
    minutes: int | None
    position: str | None


@dataclass(frozen=True, slots=True, eq=False)
class SideLineup:
    """A side's line-up of one match: its starters, the minutes held, its keepers."""

    fixture: str
    day: date
    starters: frozenset[str]
    #: The players with minutes; a substitute who did not come on has none.
    minutes: Mapping[str, int]
    keepers: frozenset[str]

    @property
    def complete(self) -> bool:
        """Exactly an XI, every starter with minutes: a line-up a window may read."""
        return len(self.starters) == XI_SIZE and all(p in self.minutes for p in self.starters)


@dataclass(frozen=True)
class SideIndex:
    #: The share of the window's minutes played by players not in today's XI.
    missing: float
    #: 1.0 when the window's most-used goalkeeper does not start, else 0.0.
    keeper_out: float
    #: The earlier line-ups read.
    window: int


class Lineups:
    """Every stored side line-up, by fixture and by team (oldest first)."""

    def __init__(self, rows: Iterable[Appearance]) -> None:
        # Each row is folded into its side as it comes, so a stream of a million
        # rows is never held whole.
        grouped: dict[tuple[str, str], tuple[date, set[str], dict[str, int], set[str]]] = {}
        for r in rows:
            key = (r.fixture, r.team)
            if key not in grouped:
                grouped[key] = (r.day, set(), {}, set())
            _, starters, minutes, keepers = grouped[key]
            if r.started:
                starters.add(r.person)
            if r.minutes is not None:
                minutes[r.person] = r.minutes
            if r.position == GOALKEEPER:
                keepers.add(r.person)
        self.by_fixture: dict[str, dict[str, SideLineup]] = {}
        by_team: dict[str, list[SideLineup]] = {}
        for (fixture, team), (day, starters, minutes, keepers) in grouped.items():
            side = SideLineup(fixture, day, frozenset(starters), minutes, frozenset(keepers))
            self.by_fixture.setdefault(fixture, {})[team] = side
            by_team.setdefault(team, []).append(side)
        self.by_team = {t: sorted(s, key=lambda x: (x.day, x.fixture)) for t, s in by_team.items()}
        self.days = {t: [x.day for x in s] for t, s in self.by_team.items()}

    def own_fixture(self, home: str, away: str, day: date) -> tuple[SideLineup, SideLineup] | None:
        """Both sides' line-ups of the one stored fixture of the two clubs within a day of
        ``day``; ``None`` with none or several (never guessed)."""
        days = self.days.get(home, [])
        sides = self.by_team.get(home, [])
        lo = bisect_left(days, day - timedelta(days=DATE_TOLERANCE_DAYS))
        hi = bisect_right(days, day + timedelta(days=DATE_TOLERANCE_DAYS))
        found = [
            (side, other)
            for side in sides[lo:hi]
            if (other := self.by_fixture[side.fixture].get(away)) is not None
        ]
        return found[0] if len(found) == 1 else None

    def window(self, team: str, own: SideLineup, boundary: date) -> list[SideLineup]:
        """The team's newest ``WINDOW`` complete line-ups strictly before ``boundary``,
        none older than ``MAX_AGE_DAYS`` and never the own fixture."""
        days = self.days.get(team, [])
        sides = self.by_team.get(team, [])
        lo = bisect_left(days, boundary - timedelta(days=MAX_AGE_DAYS))
        out: list[SideLineup] = []
        for side in reversed(sides[lo : bisect_left(days, boundary)]):
            if side.fixture == own.fixture or not side.complete:
                continue
            out.append(side)
            if len(out) == WINDOW:
                break
        return out

    def side_index(self, team: str, own: SideLineup, boundary: date) -> SideIndex | None:
        if len(own.starters) != XI_SIZE:
            return None  # an incomplete XI would count its missing starters as rotation
        window = self.window(team, own, boundary)
        if len(window) < MIN_EARLIER:
            return None
        played: dict[str, int] = {}
        keepers: set[str] = set()
        for side in window:
            for person, minutes in side.minutes.items():
                played[person] = played.get(person, 0) + minutes
            keepers |= side.keepers
        total = sum(played.values())
        top = max((played.get(k, 0) for k in keepers), default=0)
        if total == 0 or top == 0:
            return None  # no minutes, or no goalkeeper with minutes: never guessed
        missing = sum(m for person, m in played.items() if person not in own.starters)
        regular_keepers = {k for k in keepers if played.get(k, 0) == top}
        keeper_out = 0.0 if regular_keepers & own.starters else 1.0
        return SideIndex(missing / total, keeper_out, len(window))


class TeamIds:
    """A division's training name to our team id, through ``training.team_alias`` only."""

    def __init__(self, aliases: Mapping[str, Mapping[str, str]]) -> None:
        self.aliases = aliases

    def __call__(self, division: str, name: str) -> str | None:
        return self.aliases.get(division, {}).get(name)


def match_indices(
    lineups: Lineups, keys: TeamIds, division: str, match: Scheduled
) -> tuple[SideIndex, SideIndex] | None:
    """Both sides' indices for a training row, or ``None`` when either cannot be read."""
    home, away = keys(division, match.home), keys(division, match.away)
    if home is None or away is None:
        return None
    own = lineups.own_fixture(home, away, match.date)
    if own is None:
        return None
    boundary = min(match.date, own[0].day)
    h = lineups.side_index(home, own[0], boundary)
    a = lineups.side_index(away, own[1], boundary)
    if h is None or a is None:
        return None
    return h, a


def features_from(lineups: Lineups, keys: TeamIds) -> Features:
    def features(
        division: str, match: Scheduled, known: Sequence[MatchObservation]
    ) -> tuple[list[float], list[float]] | None:
        both = match_indices(lineups, keys, division, match)
        if both is None:
            return None
        h, a = both
        return (
            [h.missing, a.missing, h.keeper_out, a.keeper_out],
            [a.missing, h.missing, a.keeper_out, h.keeper_out],
        )

    return features


#: Own and opponent's index, own and opponent's flag.
COEFFICIENTS = 4


def regulars_missing_input(lineups: Lineups, keys: TeamIds) -> MinimumFit:
    sides = sum(len(s) for s in lineups.by_team.values())
    features = FeatureInput(
        "regulars_missing",
        f"Regulars missing (T-1655, D-313): per side, the share of its minutes over its last "
        f"{WINDOW} complete stored line-ups (every competition but friendlies, within "
        f"{MAX_AGE_DAYS} days, strictly before the day) played by players not in this match's "
        f"XI, and a flag when its most-used goalkeeper does not start; own and opponent's, "
        f"fitted by FeatureInput. Reads the match's own XI: the lineups_confirmed forecast. "
        f"Not read with fewer than {MIN_EARLIER} earlier line-ups or without both stored XIs. "
        f"Side line-ups read: {sides}.",
        features_from(lineups, keys),
    )
    return MinimumFit(features, COEFFICIENTS)


LINEUPS_SQL = """
SELECT fixture_id::text, team_id::text, person_id::text, match_date, started, minutes, position
  FROM training.fixture_lineup
 WHERE match_date <= %s
   AND competition_kind <> %s
 ORDER BY team_id, match_date, fixture_id
"""


def read_lineups(conn: Conn, until: date) -> Iterator[Appearance]:
    """Every non-friendly stored line-up row dated on or before ``until``, streamed
    through a server-side cursor (the table is about a million rows)."""
    with conn.cursor(name="regulars_missing_lineups") as cur:
        cur.itersize = 10_000
        cur.execute(LINEUPS_SQL, (until, FRIENDLY))
        for fixture, team, person, day, started, minutes, position in cur:
            if not isinstance(day, date):
                raise TypeError(f"match_date is not a date: {day!r}")
            yield Appearance(
                fixture=sys.intern(str(fixture)),
                team=sys.intern(str(team)),
                person=sys.intern(str(person)),
                day=day,
                started=bool(started),
                minutes=minutes if isinstance(minutes, int) else None,
                position=None if position is None else str(position),
            )


def read_team_ids(conn: Conn) -> TeamIds:
    aliases: dict[str, dict[str, str]] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT division, training_name, team_id::text FROM training.team_alias")
        for division, name, team_id in cur.fetchall():
            aliases.setdefault(str(division), {})[str(name)] = str(team_id)
    return TeamIds(aliases)


def build(context: InputContext) -> MinimumFit:
    if context.database_url is None:
        raise LookupError(
            "the regulars_missing input reads the stored line-ups: DATABASE_URL is needed"
        )
    # The own XI of a late kick-off may carry the next UTC date; every other row is
    # read strictly before its match's day by ``Lineups.window``.
    until = context.until + timedelta(days=DATE_TOLERANCE_DAYS)
    with psycopg.connect(context.database_url) as conn:
        lineups = Lineups(read_lineups(conn, until))
        keys = read_team_ids(conn)
    return regulars_missing_input(lineups, keys)


@dataclass(frozen=True)
class Fixture:
    """A training row's day and sides, as ``Scheduled`` asks."""

    date: date
    home: str
    away: str


def explain(lineups: Lineups, keys: TeamIds, division: str, match: Scheduled) -> str:
    """One match's indices as the input reads them: T-1655's check on a named match."""
    head = f"{division} {match.date.isoformat()} {match.home} v {match.away}"
    both = match_indices(lineups, keys, division, match)
    if both is None:
        return (
            f"{head}: not read (a club the bridge does not name, no single stored fixture "
            f"with both line-ups within a day, an XI of other than {XI_SIZE}, fewer than "
            f"{MIN_EARLIER} earlier line-ups, or no goalkeeper with minutes)"
        )
    return f"{head}: " + "; ".join(
        f"{name} index {s.missing:.3f}, keeper out {s.keeper_out:.0f}, {s.window} line-ups"
        for name, s in zip(("home", "away"), both, strict=True)
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="fmip_model.inputs.regulars_missing",
        description="One match's regulars index and goalkeeper flag, as the input reads "
        "them (T-1655, D-313). Reads DATABASE_URL's training store.",
    )
    parser.add_argument("--division", required=True, help="the training row's division")
    parser.add_argument("--date", type=date.fromisoformat, required=True)
    parser.add_argument("--home", required=True, help="the training row's home name")
    parser.add_argument("--away", required=True, help="the training row's away name")
    args = parser.parse_args(argv)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    match = Fixture(args.date, args.home, args.away)
    until = match.date + timedelta(days=DATE_TOLERANCE_DAYS)
    with psycopg.connect(database_url) as conn:
        lineups = Lineups(read_lineups(conn, until))
        keys = read_team_ids(conn)
    print(explain(lineups, keys, args.division, match))
    return 0


if __name__ == "__main__":
    sys.exit(main())
