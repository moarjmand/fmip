"""Run a backtest against the training store and write the report.

    python -m fmip_model.backtest --divisions E0 --from 2024-10-01 --to 2025-05-31 \
        --history-from 2024-07-01 --out reports

Every division is evaluated separately (one report each) because leagues
differ in home advantage and draw rate, and a pooled number would hide that.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Sequence
from datetime import date
from pathlib import Path

import psycopg

from ..model.data import elo_on as store_elo_on
from ..model.version import BASELINE
from .report import write_report
from .walk_forward import BacktestMatch, walk_forward


def load_matches(database_url: str, division: str, since: date, until: date) -> list[BacktestMatch]:
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT match_date, home_team, away_team, home_goals, away_goals,
                   odds_home, odds_draw, odds_away
              FROM training.match
             WHERE division = %s AND match_date >= %s AND match_date <= %s
             ORDER BY match_date
            """,
            (division, since, until),
        )
        rows = cur.fetchall()
    return [
        BacktestMatch(
            date=row[0],
            home=str(row[1]),
            away=str(row[2]),
            home_goals=int(str(row[3])),
            away_goals=int(str(row[4])),
            odds_home=row[5],
            odds_draw=row[6],
            odds_away=row[7],
        )
        for row in rows
    ]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.backtest", description=__doc__)
    parser.add_argument("--divisions", nargs="+", required=True)
    parser.add_argument("--from", dest="window_from", type=date.fromisoformat, required=True)
    parser.add_argument("--to", dest="window_to", type=date.fromisoformat, required=True)
    parser.add_argument("--history-from", type=date.fromisoformat, required=True)
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--refit-every", type=int, default=7)
    parser.add_argument("--min-history", type=int, default=60)
    parser.add_argument("--no-elo", action="store_true", help="fit without the Club Elo prior")
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2

    def elo_on(day: date) -> dict[str, float] | None:
        if args.no_elo:
            return None
        with psycopg.connect(database_url) as conn:
            ratings = store_elo_on(conn, day)
        return ratings or None

    for division in args.divisions:
        matches = load_matches(database_url, division, args.history_from, args.window_to)
        if not matches:
            print(f"{division}: no matches in the training store for that range", file=sys.stderr)
            return 1
        result = walk_forward(
            matches,
            window_start=args.window_from,
            window_end=args.window_to,
            scope=f"{division} {args.window_from.isoformat()}..{args.window_to.isoformat()}",
            min_history=args.min_history,
            refit_every_days=args.refit_every,
            version=BASELINE,
            elo_on=elo_on,
        )
        md, js = write_report(result, args.out)
        market = f"{result.market.log_loss:.4f}" if result.market else "n/a"
        print(
            f"{division}: {len(result.forecasts)} forecasts, "
            f"log loss model {result.model.log_loss:.4f} market {market} "
            f"uniform {result.uniform.log_loss:.4f} -> {md}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
