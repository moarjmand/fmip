"""Past seasons' absences as training data (T-1650, D-306).

The API's operator command (``dist/cli/absence-history.js``) asks the licensed
feed once per past season and writes ``absence_history``; this copies it into
``training.absence``, which only the Phase 14 experiments read. No version the
service publishes reads it (D-303: the shadow route), so a load changes no
forecast.

Every id is our catalogue's: the match, its competition, the club and, when
mapped, the player; a player the catalogue does not hold yet is carried by the
provider's id alone, never by a name (rule 1). ``public`` is only read here.
A competition and season with no row is one the provider listed no absences
for, not one where nobody was missing.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from psycopg import Connection

#: Where a load reads from: a description, not a download.
ABSENCES_URL = "records:public.absence_history"
#: One load copies the whole history: its scope is not a division.
ABSENCES_SCOPE = "absences"

RECORDED_ABSENCES_SQL = """
SELECT h.fixture_id::text, s.competition_id::text, s.label,
       (f.kickoff_at AT TIME ZONE 'UTC')::date, h.team_id::text, h.person_id::text,
       h.provider_person_id, h.status, h.kind
  FROM absence_history h
  JOIN fixture f ON f.id = h.fixture_id
  JOIN season s ON s.id = h.season_id
 ORDER BY f.kickoff_at, h.fixture_id, h.provider_person_id
"""


@dataclass(frozen=True)
class RecordedAbsence:
    fixture_id: str
    competition_id: str
    season: str
    match_date: date
    team_id: str
    # Our person id; None while the catalogue does not hold him.
    person_id: str | None
    provider_person_id: str
    status: str
    kind: str | None


def recorded_absences(conn: Connection[tuple[object, ...]]) -> list[RecordedAbsence]:
    """Every row of ``absence_history``, with its match's date, competition and season."""
    with conn.cursor() as cur:
        cur.execute(RECORDED_ABSENCES_SQL)
        rows = cur.fetchall()
    return [
        RecordedAbsence(
            fixture_id=str(row[0]),
            competition_id=str(row[1]),
            season=str(row[2]),
            match_date=row[3],  # type: ignore[arg-type]
            team_id=str(row[4]),
            person_id=None if row[5] is None else str(row[5]),
            provider_person_id=str(row[6]),
            status=str(row[7]),
            kind=None if row[8] is None else str(row[8]),
        )
        for row in rows
    ]


def as_text(absences: Sequence[RecordedAbsence]) -> str:
    """The load's content as CSV, so its hash says whether two loads read the same thing."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(
        ["fixture", "competition", "season", "date", "team", "person", "provider_person"]
        + ["status", "kind"]
    )
    for a in absences:
        writer.writerow(
            [
                a.fixture_id,
                a.competition_id,
                a.season,
                a.match_date.isoformat(),
                a.team_id,
                a.person_id or "",
                a.provider_person_id,
                a.status,
                a.kind or "",
            ]
        )
    return out.getvalue()


def upsert_absences(
    conn: Connection[tuple[object, ...]], load_id: str, absences: Sequence[RecordedAbsence]
) -> int:
    """Upserts on (fixture, provider's player) and drops what this load no longer holds.

    The copy is the history as it stands: every row points at the newest load,
    and a row the history lost (its match deleted) goes with the older load.
    Returns the rows written.
    """
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO training.absence (
              source_load_id, fixture_id, competition_id, season, match_date, team_id,
              person_id, provider_person_id, status, kind
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (fixture_id, provider_person_id) DO UPDATE SET
              source_load_id = EXCLUDED.source_load_id,
              competition_id = EXCLUDED.competition_id,
              season = EXCLUDED.season,
              match_date = EXCLUDED.match_date,
              team_id = EXCLUDED.team_id,
              person_id = EXCLUDED.person_id,
              status = EXCLUDED.status,
              kind = EXCLUDED.kind
            """,
            [
                (
                    load_id,
                    a.fixture_id,
                    a.competition_id,
                    a.season,
                    a.match_date,
                    a.team_id,
                    a.person_id,
                    a.provider_person_id,
                    a.status,
                    a.kind,
                )
                for a in absences
            ],
        )
        cur.execute("DELETE FROM training.absence WHERE source_load_id <> %s", (load_id,))
    return len(absences)
