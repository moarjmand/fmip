"""Coach changes read from our stored line-ups (T-1130, D-147).

    python -m fmip_model.training.coaches count

A club's line-ups are its sides of finished matches, in every competition we
carry, that have a line-up row or a named coach (the same test as the team
page's manager, D-119), in kick-off order. The coach is the person the feed
named on that line-up (``fixture_participant.coach_id``): a person id, never a
name (rule 1).

- A line-up that names no coach is a **gap**: never a change, and the coach
  before it is never carried into it (D-119).
- A **change** is recorded where two consecutive line-ups that name a coach
  name different people. Gaps between them are skipped and counted on the
  change, so a reader can tell a change seen from one match to the next from
  one seen across unnamed line-ups.
- A caretaker is a person the feed named, so a caretaker's arrival and the
  next appointment are two changes like any other. A return (A, B, A) is two
  changes.
- Matches under the current coach are counted from their first stored
  line-up: the spell's first named line-up is match 1, and a gap is no match
  under anyone. A club's first stored coach did not start with a change we
  saw, and says so (``after_change`` is false).

``public`` is only read here. Coaching spells from the feed are not read
(Phase 11's N-4).
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime

import psycopg
from psycopg import Connection

Conn = Connection[tuple[object, ...]]

LINEUPS_SQL = """
SELECT p.team_id::text, f.id::text, f.kickoff_at, s.label, p.coach_id::text
  FROM fixture_participant p
  JOIN fixture f ON f.id = p.fixture_id
  JOIN season s ON s.id = f.season_id
 WHERE f.status = 'finished'
   AND (p.coach_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM lineup l WHERE l.participant_id = p.id))
 ORDER BY p.team_id, f.kickoff_at, f.id
"""


@dataclass(frozen=True)
class LineUp:
    team_id: str
    fixture_id: str
    kickoff_at: datetime
    season: str
    coach_id: str | None


@dataclass(frozen=True)
class CoachChange:
    team_id: str
    fixture_id: str
    kickoff_at: datetime
    season: str
    previous_coach_id: str
    coach_id: str
    # Line-ups naming no coach between the two named ones.
    gaps_between: int


@dataclass(frozen=True)
class CoachContext:
    """What a line-up says about the club's coach at that match."""

    team_id: str
    fixture_id: str
    coach_id: str | None
    # 1 for the spell's first named line-up; None for a gap.
    match_under_coach: int | None
    # True when the spell began with a change we saw; False for the club's
    # first stored coach (the spell may be years old) and for a gap.
    after_change: bool


def _ordered(lineups: Iterable[LineUp]) -> dict[str, list[LineUp]]:
    by_team: dict[str, list[LineUp]] = {}
    for lu in sorted(lineups, key=lambda x: (x.team_id, x.kickoff_at, x.fixture_id)):
        by_team.setdefault(lu.team_id, []).append(lu)
    return by_team


def coach_changes(lineups: Iterable[LineUp]) -> list[CoachChange]:
    """Every change of coach the stored line-ups show, by club then kick-off."""
    changes: list[CoachChange] = []
    for team_lineups in _ordered(lineups).values():
        previous: str | None = None
        gaps = 0
        for lu in team_lineups:
            if lu.coach_id is None:
                gaps += 1
                continue
            if previous is not None and lu.coach_id != previous:
                changes.append(
                    CoachChange(
                        team_id=lu.team_id,
                        fixture_id=lu.fixture_id,
                        kickoff_at=lu.kickoff_at,
                        season=lu.season,
                        previous_coach_id=previous,
                        coach_id=lu.coach_id,
                        gaps_between=gaps,
                    )
                )
            previous = lu.coach_id
            gaps = 0
    return changes


def coach_contexts(lineups: Iterable[LineUp]) -> list[CoachContext]:
    """Each line-up's coach and its match number under that coach (T-1131's input)."""
    out: list[CoachContext] = []
    for team_lineups in _ordered(lineups).values():
        current: str | None = None
        count = 0
        after_change = False
        for lu in team_lineups:
            if lu.coach_id is None:
                out.append(CoachContext(lu.team_id, lu.fixture_id, None, None, False))
                continue
            if lu.coach_id != current:
                after_change = current is not None
                current = lu.coach_id
                count = 0
            count += 1
            out.append(CoachContext(lu.team_id, lu.fixture_id, current, count, after_change))
    return out


def read_lineups(conn: Conn) -> list[LineUp]:
    with conn.cursor() as cur:
        cur.execute(LINEUPS_SQL)
        rows = cur.fetchall()
    return [
        LineUp(
            team_id=str(r[0]),
            fixture_id=str(r[1]),
            kickoff_at=r[2],  # type: ignore[arg-type]
            season=str(r[3]),
            coach_id=None if r[4] is None else str(r[4]),
        )
        for r in rows
    ]


@dataclass(frozen=True)
class Summary:
    clubs: int
    lineups: int
    named: int
    gaps: int
    changes: int
    clubs_with_a_change: int
    changes_across_a_gap: int
    changes_by_season: dict[str, int]


def summarise(lineups: Sequence[LineUp]) -> Summary:
    changes = coach_changes(lineups)
    named = sum(1 for lu in lineups if lu.coach_id is not None)
    return Summary(
        clubs=len({lu.team_id for lu in lineups}),
        lineups=len(lineups),
        named=named,
        gaps=len(lineups) - named,
        changes=len(changes),
        clubs_with_a_change=len({c.team_id for c in changes}),
        changes_across_a_gap=sum(1 for c in changes if c.gaps_between > 0),
        changes_by_season=dict(sorted(Counter(c.season for c in changes).items())),
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.training.coaches", description=__doc__)
    parser.add_argument("action", choices=["count"])
    parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    with psycopg.connect(database_url) as conn:
        s = summarise(read_lineups(conn))
    print(
        f"line-ups {s.lineups} of {s.clubs} clubs: {s.named} name a coach, {s.gaps} gaps; "
        f"{s.changes} changes at {s.clubs_with_a_change} clubs, "
        f"{s.changes_across_a_gap} across a gap"
    )
    for season, n in s.changes_by_season.items():
        print(f"  {season}: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
