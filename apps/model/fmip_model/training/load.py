"""The loader command (T-060).

    python -m fmip_model.training.load football-data --seasons 2324 2425 --divisions E0 SP1
    python -m fmip_model.training.load clubelo --days 2024-08-01 2025-08-01

Each (source, scope) is one ``source_load`` row: opened first, then the file
is fetched, hashed, parsed and upserted inside one transaction, then the load
is closed as succeeded with the hash and row count. A download or parse
failure closes it as failed with the error and writes no rows. Re-running is
repeatable: the same file produces the same rows under a new load id.

Network: ``httpx`` honours ``HTTPS_PROXY``/``HTTP_PROXY``, which is how the
maintainer's host reaches the sources (scripts/dev-proxy.sh).
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable, Sequence

import httpx

from .clubelo import parse_elo
from .football_data import parse_matches
from .sources import (
    CLUB_ELO,
    FOOTBALL_DATA,
    Source,
    clubelo_snapshot_url,
    football_data_url,
    season_label,
)
from .store import LoadResult, TrainingStore, sha256_of

Fetch = Callable[[str], str]


def fetch_text(url: str, *, timeout: float = 60.0) -> str:
    with httpx.Client(follow_redirects=True, timeout=timeout) as client:
        response = client.get(url)
        response.raise_for_status()
        return response.text


def load_one(
    store: TrainingStore,
    source: Source,
    scope: str,
    url: str,
    fetch: Fetch,
    write: Callable[[str, str], int],
) -> LoadResult:
    """One download, one load row, one data transaction."""
    load_id = store.open_load(source, scope, url)
    try:
        text = fetch(url)
        digest = sha256_of(text)
        count = write(load_id, text)
        store.conn.commit()
        store.close_load(load_id, content_sha256=digest, row_count=count)
        return LoadResult(load_id, source.id, scope, "succeeded", count, digest)
    except Exception as error:  # noqa: BLE001 - every failure must be recorded, then re-raised
        store.fail_load(load_id, f"{type(error).__name__}: {error}")
        raise


def load_football_data(
    store: TrainingStore,
    seasons: Sequence[str],
    divisions: Sequence[str],
    fetch: Fetch = fetch_text,
) -> list[LoadResult]:
    results: list[LoadResult] = []
    for season in seasons:
        label = season_label(season)
        for division in divisions:

            def write(load_id: str, text: str, label: str = label) -> int:
                return store.upsert_matches(load_id, label, parse_matches(text))

            results.append(
                load_one(
                    store,
                    FOOTBALL_DATA,
                    f"{division} {label}",
                    football_data_url(season, division),
                    fetch,
                    write,
                )
            )
    return results


def load_clubelo(
    store: TrainingStore, days: Sequence[str], fetch: Fetch = fetch_text
) -> list[LoadResult]:
    results: list[LoadResult] = []
    for day in days:

        def write(load_id: str, text: str) -> int:
            return store.upsert_elo(load_id, parse_elo(text))

        results.append(load_one(store, CLUB_ELO, day, clubelo_snapshot_url(day), fetch, write))
    return results


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.training.load", description=__doc__)
    sub = parser.add_subparsers(dest="source", required=True)

    fd = sub.add_parser("football-data", help="results and odds from football-data.co.uk")
    fd.add_argument("--seasons", nargs="+", required=True, help="four-digit codes, e.g. 2324 2425")
    fd.add_argument("--divisions", nargs="+", required=True, help="e.g. E0 SP1 D1 I1 F1")

    ce = sub.add_parser("clubelo", help="Club Elo snapshots")
    ce.add_argument("--days", nargs="+", required=True, help="ISO dates, e.g. 2025-08-01")

    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2

    store = TrainingStore.connect(database_url)
    try:
        if args.source == "football-data":
            results = load_football_data(store, args.seasons, args.divisions)
        else:
            results = load_clubelo(store, args.days)
    except Exception as error:  # noqa: BLE001
        print(f"load failed and was recorded as failed: {error}", file=sys.stderr)
        return 1
    finally:
        store.close()

    for result in results:
        digest = result.content_sha256[:12]
        print(f"{result.source} {result.scope}: {result.row_count} rows sha256={digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
