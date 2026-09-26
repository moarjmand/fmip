"""Our own records as training data (T-512, D-083).

The feed the product licenses (D-076) is the only source for leagues
football-data.co.uk does not cover, and the maintainer allowed training on it
(D-083). It reaches the model through our tables, never a second connection to
the provider: finished matches are read from ``fixture``, its participants and
its full-time score, for the competitions set to a division, and written to
``training.match`` with our team ids as the team names -- so the aliases the
forecaster reads are identity rows, written by the same load.

``public`` is only read here. The score is the full-time one, so a cup tie's
extra time and penalties are not goals the model learns from.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

from psycopg import Connection

from .football_data import MatchRow

RECORDED_MATCHES_SQL = """
SELECT s.label, (f.kickoff_at AT TIME ZONE 'UTC')::date, h.team_id::text, a.team_id::text,
       sc.home, sc.away
  FROM fixture f
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
  JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
  JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
 WHERE f.status = 'finished'
   AND CASE WHEN %s = 'XL'
            -- Across leagues: every competition that is not one domestic league (T-533).
            THEN c.kind <> 'league' OR c.scope <> 'domestic'
            ELSE c.football_data_division = %s END
 ORDER BY f.kickoff_at, f.id
"""


@dataclass(frozen=True)
class RecordedMatch:
    season: str
    match_date: date
    home_team_id: str
    away_team_id: str
    home_goals: int
    away_goals: int


def recorded_matches(conn: Connection[tuple[object, ...]], division: str) -> list[RecordedMatch]:
    """Every finished match we hold for the competitions set to ``division``.

    ``XL`` is not a competition's division but the matches between clubs of
    different leagues: every competition that is not one domestic league, as
    the API decides it (T-503, T-533).
    """
    with conn.cursor() as cur:
        cur.execute(RECORDED_MATCHES_SQL, (division, division))
        rows = cur.fetchall()
    return [
        RecordedMatch(
            season=str(row[0]),
            match_date=row[1],  # type: ignore[arg-type]
            home_team_id=str(row[2]),
            away_team_id=str(row[3]),
            home_goals=int(str(row[4])),
            away_goals=int(str(row[5])),
        )
        for row in rows
    ]


def as_text(matches: Sequence[RecordedMatch]) -> str:
    """The load's content as CSV, so its hash says whether two loads read the same thing."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["season", "date", "home", "away", "home_goals", "away_goals"])
    for m in matches:
        writer.writerow(
            [
                m.season,
                m.match_date.isoformat(),
                m.home_team_id,
                m.away_team_id,
                m.home_goals,
                m.away_goals,
            ]
        )
    return out.getvalue()


def result_of(home_goals: int, away_goals: int) -> str:
    return "H" if home_goals > away_goals else "A" if home_goals < away_goals else "D"


def by_season(division: str, matches: Iterable[RecordedMatch]) -> dict[str, list[MatchRow]]:
    """Training rows by season, as the store writes them; nothing the records lack is invented."""
    seasons: dict[str, list[MatchRow]] = {}
    for m in matches:
        seasons.setdefault(m.season, []).append(
            MatchRow(
                division=division,
                match_date=m.match_date,
                home_team=m.home_team_id,
                away_team=m.away_team_id,
                home_goals=m.home_goals,
                away_goals=m.away_goals,
                result=result_of(m.home_goals, m.away_goals),
                ht_home_goals=None,
                ht_away_goals=None,
                home_shots=None,
                away_shots=None,
                home_shots_on_target=None,
                away_shots_on_target=None,
                odds_home=None,
                odds_draw=None,
                odds_away=None,
                odds_source=None,
            )
        )
    return seasons


def team_ids(matches: Iterable[RecordedMatch]) -> list[str]:
    return sorted({t for m in matches for t in (m.home_team_id, m.away_team_id)})
