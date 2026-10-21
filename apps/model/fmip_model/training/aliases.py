"""Proposing a football-data division's aliases from results (T-1442, D-233).

    python -m fmip_model.training.aliases propose --division AT1 [--provider api_football]

The bridge from our clubs to a division's training names (``training.team_alias``,
T-063, D-080) is a committed list, ``packages/db/scripts/data/training-aliases.csv``,
written by ``catalog --alias-training``. A name is never matched to a club by
likeness (rule 1), so this proposes the list's lines from results instead:
every stored result of the division is set beside our own fixtures of the
competitions set to it, played within a day of it with the same score, and
each such fixture is a vote that the result's home name is the fixture's home
club and its away name the away club. A name is proposed for the club with
the most votes only when that club's most votes are for that name too, the
votes are at least ``MIN_AGREEING`` and at least ``MIN_SHARE`` of the name's
checkable results -- those of the seasons in which we hold fixtures of that
club, since a season we have not backfilled checks nothing. Everything else
is reported as unresolved, never guessed.

The output is the list's own format, for the operator to read and append;
``catalog --alias-training`` then checks the newest season's results again.
Reads ``training`` and ``public``; writes nothing.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg

#: Votes below this are too few to tell a club from chance.
MIN_AGREEING = 5
#: The share of a name's checkable results that must line up with the club's fixtures.
#: On 2026-10-21 a wrong pair agreed on at most 18%, a right one on 64% at least
#: (partial seasons, and Argentina's league cup, which the file carries and our
#: competition does not).
MIN_SHARE = 0.6


@dataclass(frozen=True)
class NamedResult:
    """A result as the training store holds it, clubs by the source's names."""

    season: str
    day: date
    home: str
    away: str
    home_goals: int
    away_goals: int


@dataclass(frozen=True)
class OurFixture:
    """One of our fixtures with a full-time score, clubs by catalogue id."""

    season: str
    day: date
    home: str
    away: str
    home_goals: int
    away_goals: int


@dataclass(frozen=True)
class Proposal:
    training_name: str
    team_id: str
    #: Results whose name lined up with one of the club's fixtures.
    agreeing: int
    #: The name's results in the seasons we hold fixtures of the club in.
    checkable: int


@dataclass(frozen=True)
class Unresolved:
    training_name: str
    checkable: int
    #: The club with the most votes, if any, and its votes.
    best: str | None
    votes: int
    why: str


def propose(
    results: Iterable[NamedResult],
    fixtures: Iterable[OurFixture],
    *,
    min_agreeing: int = MIN_AGREEING,
    min_share: float = MIN_SHARE,
) -> tuple[list[Proposal], list[Unresolved]]:
    """Each name's club by the fixtures that agree with its results; see the module."""
    by_score: dict[tuple[date, int, int], list[OurFixture]] = defaultdict(list)
    seasons_of: dict[str, set[str]] = defaultdict(set)
    for f in fixtures:
        by_score[(f.day, f.home_goals, f.away_goals)].append(f)
        seasons_of[f.home].add(f.season)
        seasons_of[f.away].add(f.season)

    played: dict[str, Counter[str]] = defaultdict(Counter)  # name -> season -> results
    votes: dict[str, Counter[str]] = defaultdict(Counter)
    for r in results:
        played[r.home][r.season] += 1
        played[r.away][r.season] += 1
        for shift in (-1, 0, 1):
            for f in by_score.get((r.day + timedelta(days=shift), r.home_goals, r.away_goals), ()):
                votes[r.home][f.home] += 1
                votes[r.away][f.away] += 1

    def best_of(counter: Counter[str]) -> tuple[str | None, int, bool]:
        """The leader, its count, and whether it leads alone."""
        ranked = counter.most_common(2)
        if not ranked:
            return None, 0, False
        alone = len(ranked) == 1 or ranked[0][1] > ranked[1][1]
        return ranked[0][0], ranked[0][1], alone

    by_team: dict[str, Counter[str]] = defaultdict(Counter)
    for voted_name, counter in votes.items():
        for club, club_votes in counter.items():
            by_team[club][voted_name] += club_votes

    proposals: list[Proposal] = []
    unresolved: list[Unresolved] = []
    for name in sorted(played):
        team, count, alone = best_of(votes.get(name, Counter()))
        checkable = 0
        if team is not None:
            held = seasons_of[team]
            checkable = sum(n for season, n in played[name].items() if season in held)
        why = ""
        if team is None:
            why = "no fixture of ours agrees with any of its results"
        elif not alone:
            why = "two clubs share the most votes"
        elif count < min_agreeing:
            why = f"fewer than {min_agreeing} agreeing results"
        elif count < min_share * checkable:
            why = f"under {min_share:.0%} of its checkable results agree"
        else:
            back, _, back_alone = best_of(by_team[team])
            if back != name or not back_alone:
                why = "the club's most votes are for another name"
        if why:
            unresolved.append(Unresolved(name, checkable, team, count, why))
        else:
            assert team is not None
            proposals.append(Proposal(name, team, count, checkable))
    return proposals, unresolved


RESULTS_SQL = """
SELECT season, match_date, home_team, away_team, home_goals, away_goals
  FROM training.match WHERE division = %s
"""

FIXTURES_SQL = """
SELECT s.label, (f.kickoff_at AT TIME ZONE 'UTC')::date, h.team_id::text, a.team_id::text,
       sc.home, sc.away
  FROM fixture f
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
  JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
  JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
 WHERE c.football_data_division = %s
"""

PROVIDER_IDS_SQL = """
SELECT internal_id::text, external_id FROM provider_mapping
 WHERE entity_type = 'team' AND provider = %s AND internal_id = ANY(%s::uuid[])
"""


def alias_lines(
    division: str, provider: str, proposals: Sequence[Proposal], external: dict[str, str]
) -> list[str]:
    """The list's lines (``provider,provider_team_id,division,training_name``), by name.

    A club with no id of ``provider`` cannot be written by the list, and is left out.
    """
    return [
        f"{provider},{external[p.team_id]},{division},{p.training_name}"
        for p in sorted(proposals, key=lambda p: p.training_name)
        if p.team_id in external
    ]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.training.aliases", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    pr = sub.add_parser("propose", help="print the alias list's lines for one division")
    pr.add_argument("--division", required=True)
    pr.add_argument("--provider", default="api_football")
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(RESULTS_SQL, (args.division,))
        results = [NamedResult(str(r[0]), r[1], str(r[2]), str(r[3]), int(r[4]), int(r[5]))
                   for r in cur.fetchall()]  # fmt: skip
        cur.execute(FIXTURES_SQL, (args.division,))
        fixtures = [OurFixture(str(r[0]), r[1], str(r[2]), str(r[3]), int(r[4]), int(r[5]))
                    for r in cur.fetchall()]  # fmt: skip
        proposals, unresolved = propose(results, fixtures)
        cur.execute(PROVIDER_IDS_SQL, (args.provider, [p.team_id for p in proposals]))
        external = {str(r[0]): str(r[1]) for r in cur.fetchall()}
    if not results or not fixtures:
        print(f"{args.division}: {len(results)} stored results, {len(fixtures)} of our fixtures;"
              " load the division and set a competition to it first", file=sys.stderr)  # fmt: skip
        return 1
    for line in alias_lines(args.division, args.provider, proposals, external):
        print(line)
    for u in unresolved:
        print(f"unresolved: {args.division} {u.training_name!r} ({u.checkable} checkable): {u.why}",
              file=sys.stderr)  # fmt: skip
    return 0


if __name__ == "__main__":
    sys.exit(main())
