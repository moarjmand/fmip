"""Our records' match detail in the training store (T-1647, T-1648, D-305).

    python -m fmip_model.training.load records-stats [--into fmip_lab]
    python -m fmip_model.training.load records-lineups [--into fmip_lab]
    python -m fmip_model.training.fixture_detail coverage [--since 2023]

The model-factor experiments (D-303) need what ``training.match`` does not
hold: each side's expected goals, shots and shots on target (T-1647), and who
started and how long each player played (T-1648). Both are copied from our own
records of the licensed feed (D-083) into tables of their own,
``training.fixture_stat`` and ``training.fixture_lineup``. ``training.match``
is not touched, so neither the published version's fits nor our own Elo move,
and nothing published reads the new tables.

- Every finished match of every competition is copied, those kept out of
  ``training.match`` included (``competition.model_training``, D-304): the lab
  store needs the cups. Each row carries its competition's id, kind, scope and
  training division, since the lab store has no ``public`` to join.
- A figure the feed did not supply is ``None``, never 0, and a match without
  statistics or a side without a line-up has no row: a gap (rule 3).
- A load replaces every row of its table with what ``public`` holds now, in one
  transaction, streamed (the line-ups are about a million rows) and hashed in
  order, so two loads of the same records record the same hash.

``public`` is only read here, on a read-only connection of its own.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from collections.abc import Generator, Iterable, Sequence
from dataclasses import dataclass

import psycopg
from psycopg import Connection

Conn = Connection[tuple[object, ...]]

#: The provider our records come from (D-076): the feed the ingestion writes
#: ``fixture_stat``, ``lineup`` and ``fixture_player_stat`` from.
RECORDS_PROVIDER = "api_football"

STATS_SQL = """
WITH side AS (
  SELECT participant_id,
         max(value) FILTER (WHERE metric = 'expected_goals') AS xg,
         (max(value) FILTER (WHERE metric = 'shots'))::smallint AS shots,
         (max(value) FILTER (WHERE metric = 'shots_on_target'))::smallint AS on_target
    FROM fixture_stat
   WHERE metric IN ('expected_goals', 'shots', 'shots_on_target')
   GROUP BY participant_id
)
SELECT f.id, %(provider)s::text, c.id, c.kind, c.scope, c.football_data_division, s.label,
       (f.kickoff_at AT TIME ZONE 'UTC')::date, h.team_id, a.team_id,
       hs.xg, aw.xg, hs.shots, aw.shots, hs.on_target, aw.on_target
  FROM fixture f
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
  JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
  LEFT JOIN side hs ON hs.participant_id = h.id
  LEFT JOIN side aw ON aw.participant_id = a.id
 WHERE f.status = 'finished'
   -- A match with none of the three figures for either side is a gap, not a row.
   AND (hs.participant_id IS NOT NULL OR aw.participant_id IS NOT NULL)
 ORDER BY f.kickoff_at, f.id
"""

STATS_COLUMNS = (
    "fixture_id",
    "source",
    "competition_id",
    "competition_kind",
    "competition_scope",
    "division",
    "season",
    "match_date",
    "home_team_id",
    "away_team_id",
    "home_xg",
    "away_xg",
    "home_shots",
    "away_shots",
    "home_shots_on_target",
    "away_shots_on_target",
)

LINEUPS_SQL = """
SELECT f.id, p.team_id, l.person_id, %(provider)s::text, p.side,
       c.id, c.kind, c.scope, c.football_data_division, s.label,
       (f.kickoff_at AT TIME ZONE 'UTC')::date,
       l.role = 'starter', m.value::smallint, l.position
  FROM lineup l
  JOIN fixture_participant p ON p.id = l.participant_id
  JOIN fixture f ON f.id = p.fixture_id
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  -- No minutes row is no minutes (an unused substitute, or none supplied), never 0.
  LEFT JOIN fixture_player_stat m
    ON m.participant_id = l.participant_id AND m.person_id = l.person_id
   AND m.metric = 'minutes'
 WHERE f.status = 'finished'
 ORDER BY f.kickoff_at, f.id, p.side, l.person_id
"""

LINEUP_COLUMNS = (
    "fixture_id",
    "team_id",
    "person_id",
    "source",
    "side",
    "competition_id",
    "competition_kind",
    "competition_scope",
    "division",
    "season",
    "match_date",
    "started",
    "minutes",
    "position",
)


@dataclass(frozen=True)
class Detail:
    """One table of match detail and the records it is copied from."""

    #: The table in the ``training`` schema.
    table: str
    #: The load's scope: a table name, never a division code (no code has ``_``).
    scope: str
    #: Where the load reads: a description, not a download.
    url: str
    select: str
    columns: tuple[str, ...]
    #: What an empty load found none of, for its refusal.
    what: str


STATS = Detail(
    table="fixture_stat",
    scope="fixture_stat",
    url="records:public.fixture_stat",
    select=STATS_SQL,
    columns=STATS_COLUMNS,
    what="finished match with team statistics",
)

LINEUPS = Detail(
    table="fixture_lineup",
    scope="fixture_lineup",
    url="records:public.lineup",
    select=LINEUPS_SQL,
    columns=LINEUP_COLUMNS,
    what="finished match with a line-up",
)


def content_line(row: Sequence[object]) -> str:
    """One row as the load's hash reads it: ``None`` is empty, so 0 and "not supplied" differ."""
    return "\t".join("" if value is None else str(value) for value in row) + "\n"


def connect_reader(database_url: str) -> Conn:
    """A read-only connection to ``public``: the loads never write it."""
    conn = psycopg.connect(database_url)
    conn.read_only = True
    return conn


def read_rows(reader: Conn, detail: Detail) -> Generator[tuple[object, ...]]:
    """The records' rows in the table's column order, from a server-side cursor."""
    with reader.cursor(name=f"training_{detail.table}") as cur:
        cur.itersize = 5000
        cur.execute(detail.select, {"provider": RECORDS_PROVIDER})
        yield from cur


def replace_rows(
    target: Conn, detail: Detail, load_id: str, rows: Iterable[Sequence[object]]
) -> tuple[int, str]:
    """Every row of the table replaced by ``rows``, in ``target``'s open transaction.

    Returns the row count and the sha256 of the rows' content in order. The
    caller commits, or rolls back and keeps the rows held before.
    """
    digest = hashlib.sha256()
    count = 0
    columns = ", ".join(("source_load_id", *detail.columns))
    with target.cursor() as cur:
        cur.execute(f"DELETE FROM training.{detail.table}")
        with cur.copy(f"COPY training.{detail.table} ({columns}) FROM STDIN") as copy:
            for row in rows:
                digest.update(content_line(row).encode("utf-8"))
                copy.write_row((load_id, *row))
                count += 1
    return count, digest.hexdigest()


# ---------------------------------------------------------------------------
# Coverage: what the two tables hold, against our finished matches.
# ---------------------------------------------------------------------------

COVERAGE_SQL = """
WITH finished AS (
  SELECT f.id, c.id AS competition_id, c.name, c.football_data_division AS division,
         s.label AS season
    FROM fixture f
    JOIN season s ON s.id = f.season_id
    JOIN competition c ON c.id = s.competition_id
   WHERE f.status = 'finished'
     AND EXISTS (SELECT 1 FROM fixture_participant p WHERE p.fixture_id = f.id AND p.side = 'home')
     AND EXISTS (SELECT 1 FROM fixture_participant p WHERE p.fixture_id = f.id AND p.side = 'away')
     AND (%(since)s::text IS NULL OR s.label >= %(since)s::text)
),
lineups AS (
  SELECT fixture_id,
         count(DISTINCT side) AS sides,
         count(DISTINCT side) FILTER (WHERE minutes IS NOT NULL) AS sides_with_minutes
    FROM training.fixture_lineup
   GROUP BY fixture_id
)
SELECT fi.name, fi.division, fi.season,
       count(*),
       count(st.fixture_id),
       count(*) FILTER (WHERE st.home_xg IS NOT NULL AND st.away_xg IS NOT NULL),
       count(*) FILTER (WHERE st.home_shots IS NOT NULL AND st.away_shots IS NOT NULL),
       count(*) FILTER (WHERE lu.sides = 2),
       count(*) FILTER (WHERE lu.sides_with_minutes = 2)
  FROM finished fi
  LEFT JOIN training.fixture_stat st ON st.fixture_id = fi.id
  LEFT JOIN lineups lu ON lu.fixture_id = fi.id
 GROUP BY fi.competition_id, fi.name, fi.division, fi.season
 ORDER BY fi.division NULLS LAST, fi.name, fi.season
"""


@dataclass(frozen=True)
class Coverage:
    """One competition-season: our finished matches, and how many the tables hold.

    A match counts for xG, shots, line-ups or minutes only when both sides have
    them: one side's figure is not a match's.
    """

    competition: str
    division: str | None
    season: str
    finished: int
    with_stats: int
    with_xg: int
    with_shots: int
    with_lineups: int
    with_minutes: int


def read_coverage(conn: Conn, since: str | None = None) -> list[Coverage]:
    """Per competition and season, from ``since`` (a label such as 2023 or 2023/24) on."""
    with conn.cursor() as cur:
        cur.execute(COVERAGE_SQL, {"since": since})
        rows = cur.fetchall()
    return [
        Coverage(
            competition=str(r[0]),
            division=None if r[1] is None else str(r[1]),
            season=str(r[2]),
            finished=int(str(r[3])),
            with_stats=int(str(r[4])),
            with_xg=int(str(r[5])),
            with_shots=int(str(r[6])),
            with_lineups=int(str(r[7])),
            with_minutes=int(str(r[8])),
        )
        for r in rows
    ]


def total(rows: Iterable[Coverage]) -> Coverage:
    items = list(rows)
    return Coverage(
        competition="all",
        division=None,
        season="",
        finished=sum(r.finished for r in items),
        with_stats=sum(r.with_stats for r in items),
        with_xg=sum(r.with_xg for r in items),
        with_shots=sum(r.with_shots for r in items),
        with_lineups=sum(r.with_lineups for r in items),
        with_minutes=sum(r.with_minutes for r in items),
    )


def share(part: int, whole: int) -> str:
    """``part`` of ``whole`` as a whole percentage; ``-`` when there is nothing to share."""
    return "-" if whole == 0 else f"{round(100 * part / whole)}%"


COVERAGE_HEADER = (
    "competition",
    "division",
    "season",
    "finished",
    "stats",
    "xg",
    "shots",
    "lineups",
    "minutes",
)


def format_coverage(rows: Sequence[Coverage]) -> str:
    """Tab-separated, one line per competition-season and one for all of them."""
    lines = ["\t".join(COVERAGE_HEADER)]
    for r in (*rows, total(rows)):
        counts = (r.with_stats, r.with_xg, r.with_shots, r.with_lineups, r.with_minutes)
        cells = [r.competition, r.division or "-", r.season or "-", str(r.finished)]
        cells += [f"{n} ({share(n, r.finished)})" for n in counts]
        lines.append("\t".join(cells))
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.training.fixture_detail", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    cov = sub.add_parser(
        "coverage", help="per competition and season: finished matches, and the share held"
    )
    cov.add_argument("--since", help="the first season label kept, e.g. 2023 or 2023/24")
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    with connect_reader(database_url) as conn:
        rows = read_coverage(conn, args.since)
    sys.stdout.write(format_coverage(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
