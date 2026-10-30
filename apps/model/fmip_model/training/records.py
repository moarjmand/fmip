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
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date

from psycopg import Connection

from ..model.cross_league import FixtureKey, home_group, is_uefa
from .football_data import MatchRow

RECORDED_MATCHES_SQL = """
SELECT s.label, (f.kickoff_at AT TIME ZONE 'UTC')::date, h.team_id::text, a.team_id::text,
       sc.home, sc.away, h.coach_id::text, a.coach_id::text
  FROM fixture f
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
  JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
  JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
 WHERE f.status = 'finished'
   -- A competition kept out of the training store (T-1649, D-304) feeds no division.
   AND c.model_training
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
    # The coach each side's line-up named, as a person id (T-1130, D-147);
    # None when it named none. Never a name (rule 1), never carried forward.
    home_coach_id: str | None = None
    away_coach_id: str | None = None


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
            home_coach_id=None if row[6] is None else str(row[6]),
            away_coach_id=None if row[7] is None else str(row[7]),
        )
        for row in rows
    ]


#: Every fixture across leagues (as ``XL`` reads them) from one UTC day to
#: another, any status, with its competition's scope and kind (T-1654).
ACROSS_LEAGUES_FIXTURES_SQL = """
SELECT (f.kickoff_at AT TIME ZONE 'UTC')::date, h.team_id::text, a.team_id::text,
       c.id::text, c.scope, c.kind
  FROM fixture f
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
  JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
 WHERE (c.kind <> 'league' OR c.scope <> 'domestic')
   AND (f.kickoff_at AT TIME ZONE 'UTC')::date BETWEEN %s AND %s
"""

#: Per continental competition and country, its clubs that play a domestic
#: league of that country: how the catalogue places a continental competition
#: (D-301), here over every season held.
CONTINENTAL_CLUB_COUNTRIES_SQL = """
WITH clubs AS (
  SELECT DISTINCT s.competition_id, fp.team_id
    FROM competition c
    JOIN season s ON s.competition_id = c.id
    JOIN fixture f ON f.season_id = s.id
    JOIN fixture_participant fp ON fp.fixture_id = f.id
   WHERE c.scope = 'continental'
), homes AS (
  SELECT DISTINCT dp.team_id, co.code
    FROM fixture_participant dp
    JOIN fixture df ON df.id = dp.fixture_id
    JOIN season ds ON ds.id = df.season_id
    JOIN competition dc ON dc.id = ds.competition_id
    JOIN country co ON co.id = dc.country_id
   WHERE dc.scope = 'domestic' AND dc.kind = 'league'
     AND dp.team_id IN (SELECT team_id FROM clubs)
)
SELECT clubs.competition_id::text, homes.code, count(*)::int
  FROM clubs
  JOIN homes ON homes.team_id = clubs.team_id
 GROUP BY clubs.competition_id, homes.code
"""


def continental_tallies(conn: Connection[tuple[object, ...]]) -> dict[str, dict[str, int]]:
    """Per continental competition id, its placed clubs by country (``is_uefa``'s input)."""
    with conn.cursor() as cur:
        cur.execute(CONTINENTAL_CLUB_COUNTRIES_SQL)
        tallies: dict[str, dict[str, int]] = {}
        for competition, code, clubs in cur.fetchall():
            tallies.setdefault(str(competition), {})[str(code)] = int(str(clubs))
    return tallies


def across_leagues_groups(
    conn: Connection[tuple[object, ...]],
    since: date,
    until: date,
    tallies: Mapping[str, Mapping[str, int]] | None = None,
) -> dict[FixtureKey, str]:
    """Each fixture across leagues from ``since`` to ``until`` (UTC days, both included),
    keyed as ``XL``'s training rows name it, to its competition's home group (D-309).

    The key is the UTC day and the two clubs' ids, which is how the records
    load writes an ``XL`` row. A key two fixtures of different groups share is
    left out: the fit then gives that match the shared home advantage.
    ``tallies`` (``continental_tallies``) may be passed when already read.
    """
    if tallies is None:
        tallies = continental_tallies(conn)
    with conn.cursor() as cur:
        cur.execute(ACROSS_LEAGUES_FIXTURES_SQL, (since, until))
        rows = cur.fetchall()
    out: dict[FixtureKey, str] = {}
    clashes: set[FixtureKey] = set()
    for day, home, away, competition, scope, kind in rows:
        key: FixtureKey = (day, str(home), str(away))  # type: ignore[assignment]
        group = home_group(str(scope), str(kind), uefa=is_uefa(tallies.get(str(competition), {})))
        if out.get(key, group) != group:
            clashes.add(key)
        out[key] = group
    for key in clashes:
        del out[key]
    return out


def as_text(matches: Sequence[RecordedMatch]) -> str:
    """The load's content as CSV, so its hash says whether two loads read the same thing.

    The coaches are not in it: ``training.match`` does not store them, so a
    line-up filled in later is not a different load of the same results.
    """
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
