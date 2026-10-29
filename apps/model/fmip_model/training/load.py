"""The loader command (T-060).

    python -m fmip_model.training.load football-data --seasons 2324 2425 --divisions E0 SP1
    python -m fmip_model.training.load clubelo --days 2024-08-01 2025-08-01
    python -m fmip_model.training.load records --divisions IR1
    python -m fmip_model.training.load football-data-extra --divisions AT1 US1 --since 2020/21
    python -m fmip_model.training.load records-stats [--into fmip_lab]
    python -m fmip_model.training.load records-lineups [--into fmip_lab]

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
from psycopg.conninfo import make_conninfo

from .clubelo import parse_elo
from .fixture_detail import (
    LINEUPS,
    STATS,
    Conn,
    Detail,
    connect_reader,
    read_rows,
    replace_rows,
)
from .football_data import MatchRow, parse_extra_matches, parse_matches
from .records import RecordedMatch, as_text, by_season, recorded_matches, team_ids
from .sources import (
    CLUB_ELO,
    FOOTBALL_DATA,
    OUR_RECORDS,
    Source,
    clubelo_snapshot_url,
    football_data_extra_url,
    football_data_url,
    records_url,
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


def load_football_data_extra(
    store: TrainingStore,
    divisions: Sequence[str],
    *,
    since: str,
    fetch: Fetch = fetch_text,
) -> list[LoadResult]:
    """An extra league's one file (T-1442, D-233), the seasons from ``since`` on.

    One load per division, its scope the division itself (the service's daily
    reload looks loads up by it, as it does our records'). A division another
    source holds is refused, as ``records`` refuses one.
    """
    if len(since) != 7 or since[4] != "/":
        raise ValueError(f"since must be a season label such as 2020/21, received {since!r}")
    results: list[LoadResult] = []
    for division in divisions:

        def write(load_id: str, text: str, division: str = division) -> int:
            foreign = store.foreign_division(division, FOOTBALL_DATA.id)
            if foreign is not None:
                raise ValueError(f"division {division} already holds {foreign} rows")
            seasons: dict[str, list[MatchRow]] = {}
            for season, row in parse_extra_matches(text, division):
                if season >= since:
                    seasons.setdefault(season, []).append(row)
            if not seasons:
                raise ValueError(f"no completed match from {since} in the file of {division}")
            return sum(store.upsert_matches(load_id, s, rows) for s, rows in seasons.items())

        results.append(
            load_one(
                store, FOOTBALL_DATA, division, football_data_extra_url(division), fetch, write
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


def load_records(store: TrainingStore, divisions: Sequence[str]) -> list[LoadResult]:
    """Our own finished matches for each division (T-512, D-083), one load per division.

    Refused, and recorded as failed, for a division another source holds or one
    no competition is set to.
    """
    results: list[LoadResult] = []
    for division in divisions:
        matches = recorded_matches(store.conn, division)

        def write(
            load_id: str,
            _text: str,
            division: str = division,
            matches: list[RecordedMatch] = matches,
        ) -> int:
            foreign = store.foreign_division(division, OUR_RECORDS.id)
            if foreign is not None:
                raise ValueError(f"division {division} already holds {foreign} rows")
            if not matches:
                raise ValueError(
                    f"no finished match in our records for division {division}: "
                    "is a competition set to it (catalog.mjs --set-division)?"
                )
            count = 0
            for season, rows in by_season(division, matches).items():
                count += store.upsert_matches(load_id, season, rows)
            store.upsert_identity_aliases(division, team_ids(matches))
            return count

        text = as_text(matches)

        def read(_url: str, text: str = text) -> str:
            return text

        results.append(load_one(store, OUR_RECORDS, division, records_url(division), read, write))
    return results


def load_records_detail(store: TrainingStore, reader: Conn, detail: Detail) -> LoadResult:
    """Our records' team statistics or line-ups (T-1647, T-1648, D-305): every row replaced.

    One load, scope the table's name. The rows are read from ``reader``
    (``public``, read-only, a connection of its own) and written to the store's
    ``training`` schema, which may be another database on the same server (the
    lab store, D-303). A load that finds no row is refused and recorded as
    failed, and the rows already held stay.
    """
    load_id = store.open_load(OUR_RECORDS, detail.scope, detail.url)
    rows = read_rows(reader, detail)
    try:
        count, digest = replace_rows(store.conn, detail, load_id, rows)
        if count == 0:
            raise ValueError(f"no {detail.what} in our records: the rows held are kept")
        store.conn.commit()
        store.close_load(load_id, content_sha256=digest, row_count=count)
        return LoadResult(load_id, OUR_RECORDS.id, detail.scope, "succeeded", count, digest)
    except Exception as error:  # noqa: BLE001 - every failure must be recorded, then re-raised
        store.fail_load(load_id, f"{type(error).__name__}: {error}")
        raise
    finally:
        rows.close()  # the server-side cursor, if the copy stopped before its end
        reader.rollback()


def target_database(database_url: str, into: str | None) -> str:
    """The database a load writes: ``DATABASE_URL``'s own, or ``into`` on the same server."""
    return database_url if into is None else make_conninfo(database_url, dbname=into)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.training.load", description=__doc__)
    sub = parser.add_subparsers(dest="source", required=True)

    fd = sub.add_parser("football-data", help="results and odds from football-data.co.uk")
    fd.add_argument("--seasons", nargs="+", required=True, help="four-digit codes, e.g. 2324 2425")
    fd.add_argument("--divisions", nargs="+", required=True, help="e.g. E0 SP1 D1 I1 F1")

    ce = sub.add_parser("clubelo", help="Club Elo snapshots")
    ce.add_argument("--days", nargs="+", required=True, help="ISO dates, e.g. 2025-08-01")

    rc = sub.add_parser("records", help="our own finished matches, per division (D-083)")
    rc.add_argument("--divisions", nargs="+", required=True, help="e.g. IR1")

    fx = sub.add_parser(
        "football-data-extra", help="football-data.co.uk's extra leagues, one file each (D-233)"
    )
    fx.add_argument("--divisions", nargs="+", required=True, help="e.g. AT1 CH1 US1")
    fx.add_argument("--since", required=True, help="the first season kept, e.g. 2020/21")

    for name, what in (
        ("records-stats", "our finished matches' team statistics, every competition (T-1647)"),
        ("records-lineups", "our finished matches' line-ups and minutes (T-1648)"),
    ):
        rd = sub.add_parser(name, help=what)
        rd.add_argument(
            "--into",
            help="write into this database on the same server (the lab store, fmip_lab), "
            "reading our records from DATABASE_URL's",
        )

    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2

    store = TrainingStore.connect(target_database(database_url, getattr(args, "into", None)))
    reader: Conn | None = None
    try:
        if args.source in ("records-stats", "records-lineups"):
            reader = connect_reader(database_url)
            detail = STATS if args.source == "records-stats" else LINEUPS
            results = [load_records_detail(store, reader, detail)]
        elif args.source == "football-data":
            results = load_football_data(store, args.seasons, args.divisions)
        elif args.source == "football-data-extra":
            results = load_football_data_extra(store, args.divisions, since=args.since)
        elif args.source == "records":
            results = load_records(store, args.divisions)
        else:
            results = load_clubelo(store, args.days)
    except Exception as error:  # noqa: BLE001
        print(f"load failed and was recorded as failed: {error}", file=sys.stderr)
        return 1
    finally:
        store.close()
        if reader is not None:
            reader.close()

    for result in results:
        digest = result.content_sha256[:12]
        print(f"{result.source} {result.scope}: {result.row_count} rows sha256={digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
