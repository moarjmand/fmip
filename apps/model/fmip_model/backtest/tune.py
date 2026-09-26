"""Tune the constants D-029 left to the backtest, per division, out of sample (T-532).

    python -m fmip_model.backtest.tune --divisions E0 SP1 \\
        --tune-from 2024-08-01 --tune-to 2025-06-30 \\
        --test-from 2025-08-01 --test-to 2026-06-30 \\
        --history-from 2023-07-01 --no-elo --out reports

For each division every (xi, ridge) pair on the grid is walked forward over
the tuning window, and the pair with the lowest log loss there is then walked
over the test window -- a season the search never saw -- beside the published
constants. A tuned pair is adopted only where it also beats them on the test
window by at least ``MIN_GAIN``: a pair that wins only where it was chosen has
found noise, and the answer "keep the published constants" is allowed and
expected for most divisions.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import date
from pathlib import Path

from ..model.version import BASELINE, ModelVersion
from .walk_forward import BacktestMatch, walk_forward

#: Half-lives from about 58 to 347 days around the published 107.
XI_GRID: tuple[float, ...] = (0.002, 0.004, 0.0065, 0.009, 0.012)
RIDGE_GRID: tuple[float, ...] = (0.003, 0.01, 0.03)
#: The least improvement in test-window log loss worth a new constant.
MIN_GAIN = 0.002


@dataclass(frozen=True)
class DivisionTuning:
    division: str
    xi: float
    ridge: float
    tune_log_loss: float
    tune_baseline: float
    test_log_loss: float
    test_baseline: float
    test_forecasts: int
    adopted: bool


def best_pair(scores: Mapping[tuple[float, float], float]) -> tuple[float, float]:
    """The (xi, ridge) with the lowest log loss; ties go to the published constants' side."""
    if not scores:
        raise ValueError("no scores to choose from")
    published = (BASELINE.xi, BASELINE.ridge)
    return min(scores, key=lambda pair: (scores[pair], pair != published))


def adopt(test_baseline: float, test_tuned: float, min_gain: float = MIN_GAIN) -> bool:
    """Whether the tuned pair beats the published one on the unseen window by enough."""
    return test_baseline - test_tuned >= min_gain


def tune_division(
    division: str,
    matches: Sequence[BacktestMatch],
    *,
    tune: tuple[date, date],
    test: tuple[date, date],
    min_history: int = 60,
    refit_every_days: int = 7,
    xi_grid: Sequence[float] = XI_GRID,
    ridge_grid: Sequence[float] = RIDGE_GRID,
    elo_on: Callable[[date], Mapping[str, float] | None] | None = None,
) -> DivisionTuning:
    def log_loss(version: ModelVersion, window: tuple[date, date]) -> tuple[float, int]:
        result = walk_forward(
            matches,
            window_start=window[0],
            window_end=window[1],
            scope=f"{division} tuning",
            min_history=min_history,
            refit_every_days=refit_every_days,
            version=version,
            elo_on=elo_on,
        )
        return result.model.log_loss, len(result.forecasts)

    def candidate(xi: float, ridge: float) -> ModelVersion:
        return replace(BASELINE, xi=xi, ridge=ridge)

    scores = {
        (xi, ridge): log_loss(candidate(xi, ridge), tune)[0]
        for xi in xi_grid
        for ridge in ridge_grid
    }
    xi, ridge = best_pair(scores)
    tune_baseline = (
        scores[(BASELINE.xi, BASELINE.ridge)]
        if (BASELINE.xi, BASELINE.ridge) in scores
        else log_loss(BASELINE, tune)[0]
    )
    test_baseline, forecasts = log_loss(BASELINE, test)
    test_tuned = (
        test_baseline
        if (xi, ridge) == (BASELINE.xi, BASELINE.ridge)
        else log_loss(candidate(xi, ridge), test)[0]
    )
    return DivisionTuning(
        division=division,
        xi=xi,
        ridge=ridge,
        tune_log_loss=scores[(xi, ridge)],
        tune_baseline=tune_baseline,
        test_log_loss=test_tuned,
        test_baseline=test_baseline,
        test_forecasts=forecasts,
        adopted=adopt(test_baseline, test_tuned),
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.backtest.tune", description=__doc__)
    parser.add_argument("--divisions", nargs="+", required=True)
    parser.add_argument("--tune-from", type=date.fromisoformat, required=True)
    parser.add_argument("--tune-to", type=date.fromisoformat, required=True)
    parser.add_argument("--test-from", type=date.fromisoformat, required=True)
    parser.add_argument("--test-to", type=date.fromisoformat, required=True)
    parser.add_argument("--history-from", type=date.fromisoformat, required=True)
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--no-elo", action="store_true", help="fit without the Club Elo prior")
    args = parser.parse_args(argv)
    if not args.tune_to < args.test_from:
        print("the test window must start after the tuning window ends", file=sys.stderr)
        return 2

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2

    import psycopg

    from ..model.data import elo_on as store_elo_on
    from .__main__ import load_matches

    def elo_on(day: date) -> dict[str, float] | None:
        if args.no_elo:
            return None
        with psycopg.connect(database_url) as conn:
            ratings = store_elo_on(conn, day)
        return ratings or None

    results: list[DivisionTuning] = []
    for division in args.divisions:
        matches = load_matches(database_url, division, args.history_from, args.test_to)
        if not matches:
            print(f"{division}: no matches in the training store for that range", file=sys.stderr)
            return 1
        tuned = tune_division(
            division,
            matches,
            tune=(args.tune_from, args.tune_to),
            test=(args.test_from, args.test_to),
            elo_on=elo_on,
        )
        results.append(tuned)
        print(
            f"{division}: xi {tuned.xi} ridge {tuned.ridge} | tune {tuned.tune_log_loss:.4f} "
            f"(published {tuned.tune_baseline:.4f}) | test {tuned.test_log_loss:.4f} "
            f"(published {tuned.test_baseline:.4f}, {tuned.test_forecasts} forecasts) -> "
            f"{'adopt' if tuned.adopted else 'keep published'}"
        )

    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"tuning_{args.test_from.isoformat()}..{args.test_to.isoformat()}.json"
    path.write_text(
        json.dumps(
            {
                "published": BASELINE.as_dict(),
                "grid": {"xi": list(XI_GRID), "ridge": list(RIDGE_GRID)},
                "min_gain": MIN_GAIN,
                "elo": not args.no_elo,
                "divisions": [asdict(r) for r in results],
            },
            indent=2,
        )
    )
    print(f"-> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
