"""Writing to the training store (schema ``training``, D-028).

Every load is a ``source_load`` row: opened before the download, closed as
succeeded (with the content hash and row count) or failed (with the error).
Rows are upserted on their natural key, so reloading a season is repeatable:
the same file twice leaves the same rows, pointed at the newer load.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass

import psycopg
from psycopg import Connection

from .clubelo import EloRow
from .football_data import MatchRow
from .sources import Source


@dataclass(frozen=True)
class LoadResult:
    load_id: str
    source: str
    scope: str
    status: str
    row_count: int
    content_sha256: str


def sha256_of(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class TrainingStore:
    def __init__(self, conn: Connection[tuple[object, ...]]) -> None:
        self.conn = conn

    @classmethod
    def connect(cls, database_url: str) -> TrainingStore:
        return cls(psycopg.connect(database_url))

    def open_load(self, source: Source, scope: str, url: str) -> str:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO training.source_load (source, scope, url, licence_url, licence_note)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id::text
                """,
                (source.id, scope, url, source.licence_url, source.licence_note),
            )
            row = cur.fetchone()
        self.conn.commit()
        assert row is not None
        return str(row[0])

    def close_load(self, load_id: str, *, content_sha256: str, row_count: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE training.source_load
                   SET status = 'succeeded', content_sha256 = %s, row_count = %s,
                       finished_at = now()
                 WHERE id = %s
                """,
                (content_sha256, row_count, load_id),
            )
        self.conn.commit()

    def fail_load(self, load_id: str, error: str) -> None:
        # A failure is its own transaction so it is recorded even though the
        # data transaction was rolled back.
        self.conn.rollback()
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE training.source_load
                   SET status = 'failed', error = %s, finished_at = now()
                 WHERE id = %s
                """,
                (error[:2000], load_id),
            )
        self.conn.commit()

    def upsert_matches(self, load_id: str, season: str, rows: Sequence[MatchRow]) -> int:
        """Upserts on (division, match_date, home_team, away_team). Returns rows written."""
        with self.conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO training.match (
                  source_load_id, division, season, match_date, home_team, away_team,
                  home_goals, away_goals, result, ht_home_goals, ht_away_goals,
                  home_shots, away_shots, home_shots_on_target, away_shots_on_target,
                  odds_home, odds_draw, odds_away, odds_source
                ) VALUES (
                  %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s,
                  %s, %s, %s, %s
                )
                ON CONFLICT (division, match_date, home_team, away_team) DO UPDATE SET
                  source_load_id = EXCLUDED.source_load_id,
                  season = EXCLUDED.season,
                  home_goals = EXCLUDED.home_goals,
                  away_goals = EXCLUDED.away_goals,
                  result = EXCLUDED.result,
                  ht_home_goals = EXCLUDED.ht_home_goals,
                  ht_away_goals = EXCLUDED.ht_away_goals,
                  home_shots = EXCLUDED.home_shots,
                  away_shots = EXCLUDED.away_shots,
                  home_shots_on_target = EXCLUDED.home_shots_on_target,
                  away_shots_on_target = EXCLUDED.away_shots_on_target,
                  odds_home = EXCLUDED.odds_home,
                  odds_draw = EXCLUDED.odds_draw,
                  odds_away = EXCLUDED.odds_away,
                  odds_source = EXCLUDED.odds_source
                """,
                [
                    (
                        load_id,
                        r.division,
                        season,
                        r.match_date,
                        r.home_team,
                        r.away_team,
                        r.home_goals,
                        r.away_goals,
                        r.result,
                        r.ht_home_goals,
                        r.ht_away_goals,
                        r.home_shots,
                        r.away_shots,
                        r.home_shots_on_target,
                        r.away_shots_on_target,
                        r.odds_home,
                        r.odds_draw,
                        r.odds_away,
                        r.odds_source,
                    )
                    for r in rows
                ],
            )
        return len(rows)

    def upsert_elo(self, load_id: str, rows: Sequence[EloRow]) -> int:
        """Upserts on (club, from_date). Returns rows written."""
        with self.conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO training.elo (
                  source_load_id, club, country, level, elo, rank, from_date, to_date
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (club, from_date) DO UPDATE SET
                  source_load_id = EXCLUDED.source_load_id,
                  country = EXCLUDED.country,
                  level = EXCLUDED.level,
                  elo = EXCLUDED.elo,
                  rank = EXCLUDED.rank,
                  to_date = EXCLUDED.to_date
                """,
                [
                    (load_id, r.club, r.country, r.level, r.elo, r.rank, r.from_date, r.to_date)
                    for r in rows
                ],
            )
        return len(rows)

    def count(self, table: str) -> int:
        if table not in ("match", "elo", "source_load"):
            raise ValueError(table)
        with self.conn.cursor() as cur:
            cur.execute(f"SELECT count(*) FROM training.{table}")  # noqa: S608
            row = cur.fetchone()
        assert row is not None
        return int(str(row[0]))

    def close(self) -> None:
        self.conn.close()
