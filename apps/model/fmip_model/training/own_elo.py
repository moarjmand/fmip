"""Our own Elo in the training store (T-921, D-111): computed, stored, recomputed.

    python -m fmip_model.training.own_elo compute --day 2026-09-28
    python -m fmip_model.training.own_elo verify --day 2026-09-28

``compute`` reads every result in ``training.match`` on or before the day,
rates the clubs (``fmip_model.model.own_elo``) and writes one
``training.own_elo_run`` with its ratings, replacing that day's run under the
same rules. ``verify`` recomputes the day from the stored results and compares
the match hash and every rating with what was written; it exits 1 on a
difference. The model service computes yesterday's run itself, once a day.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

import psycopg
from psycopg import Connection

from ..model.own_elo import RULES, ClubElo, EloComputation, EloMatch, EloRules, compute

Conn = Connection[tuple[object, ...]]


def read_matches(conn: Conn, day: date) -> list[EloMatch]:
    """Every stored result on or before ``day``, clubs keyed through the bridge (D-080)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.division, m.match_date,
                   coalesce(ah.team_id::text, m.division || ':' || m.home_team),
                   coalesce(aa.team_id::text, m.division || ':' || m.away_team),
                   m.home_goals, m.away_goals
              FROM training.match m
              LEFT JOIN training.team_alias ah
                ON ah.division = m.division AND ah.training_name = m.home_team
              LEFT JOIN training.team_alias aa
                ON aa.division = m.division AND aa.training_name = m.away_team
             WHERE m.match_date <= %s
            """,
            (day,),
        )
        rows = cur.fetchall()
    return [
        EloMatch(
            division=str(r[0]),
            date=r[1],  # type: ignore[arg-type]
            home=str(r[2]),
            away=str(r[3]),
            home_goals=int(str(r[4])),
            away_goals=int(str(r[5])),
        )
        for r in rows
    ]


def compute_day(conn: Conn, day: date, rules: EloRules = RULES) -> EloComputation:
    return compute(read_matches(conn, day), day, rules)


def store_run(conn: Conn, run: EloComputation) -> str:
    """Write the run and its ratings, replacing the day's run under the same rules."""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM training.own_elo_run WHERE day = %s AND rules = %s",
            (run.day, run.rules.id),
        )
        cur.execute(
            """
            INSERT INTO training.own_elo_run (
              day, rules, match_count, first_match_date, last_match_date,
              matches_sha256, club_count
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id::text
            """,
            (
                run.day,
                run.rules.id,
                run.match_count,
                run.first_match_date,
                run.last_match_date,
                run.matches_sha256,
                len(run.ratings),
            ),
        )
        row = cur.fetchone()
        assert row is not None
        run_id = str(row[0])
        cur.executemany(
            """
            INSERT INTO training.own_elo (run_id, club, division, elo, matches, last_match_date)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [
                (run_id, r.club, r.division, r.elo, r.matches, r.last_match_date)
                for r in run.ratings.values()
            ],
        )
    conn.commit()
    return run_id


@dataclass(frozen=True)
class StoredRun:
    run_id: str
    day: date
    rules: str
    match_count: int
    matches_sha256: str
    ratings: dict[str, ClubElo]


def stored_run(conn: Conn, day: date, rules: EloRules = RULES) -> StoredRun | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, match_count, matches_sha256 FROM training.own_elo_run
             WHERE day = %s AND rules = %s
            """,
            (day, rules.id),
        )
        head = cur.fetchone()
        if head is None:
            return None
        cur.execute(
            """
            SELECT club, division, elo, matches, last_match_date FROM training.own_elo
             WHERE run_id = %s
            """,
            (head[0],),
        )
        rows = cur.fetchall()
    return StoredRun(
        run_id=str(head[0]),
        day=day,
        rules=rules.id,
        match_count=int(str(head[1])),
        matches_sha256=str(head[2]),
        ratings={
            str(r[0]): ClubElo(
                club=str(r[0]),
                division=str(r[1]),
                elo=float(str(r[2])),
                matches=int(str(r[3])),
                last_match_date=r[4],  # type: ignore[arg-type]
            )
            for r in rows
        },
    )


def ratings_on(conn: Conn, day: date, rules: EloRules = RULES) -> dict[str, float] | None:
    """The stored ratings of the day's run, by club; ``None`` when the day was not computed."""
    run = stored_run(conn, day, rules)
    return None if run is None else {club: r.elo for club, r in run.ratings.items()}


def differences(stored: StoredRun, again: EloComputation) -> list[str]:
    """What a recomputation disagrees with; empty when the stored run is reproduced."""
    problems: list[str] = []
    if stored.matches_sha256 != again.matches_sha256:
        problems.append(
            f"the matches differ: stored {stored.match_count} ({stored.matches_sha256[:12]}), "
            f"now {again.match_count} ({again.matches_sha256[:12]})"
        )
    for club in sorted(set(stored.ratings) | set(again.ratings)):
        a, b = stored.ratings.get(club), again.ratings.get(club)
        if a is None or b is None or a.elo != b.elo or a.matches != b.matches:
            problems.append(f"{club}: stored {a}, recomputed {b}")
    return problems


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.training.own_elo", description=__doc__)
    parser.add_argument("action", choices=["compute", "verify"])
    parser.add_argument("--day", required=True, help="ISO date: rate clubs as of this day")
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    day = date.fromisoformat(args.day)
    with psycopg.connect(database_url) as conn:
        run = compute_day(conn, day)
        if args.action == "compute":
            store_run(conn, run)
            print(
                f"{RULES.id} {day}: {len(run.ratings)} clubs from {run.match_count} matches "
                f"sha256={run.matches_sha256[:12]}"
            )
            return 0
        stored = stored_run(conn, day)
        if stored is None:
            print(f"no {RULES.id} run is stored for {day}", file=sys.stderr)
            return 1
        problems = differences(stored, run)
        for problem in problems[:20]:
            print(problem, file=sys.stderr)
        if problems:
            return 1
        print(f"{RULES.id} {day}: reproduced, {len(run.ratings)} clubs, {run.match_count} matches")
        return 0


if __name__ == "__main__":
    sys.exit(main())
