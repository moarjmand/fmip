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

``--candidate <file>`` tunes on top of a candidate instead of the published
version (T-1372): every pair is fitted with the candidate's history window,
Elo weight and prior, reading only its ``history_days`` before each fit date,
and is judged against the candidate's own constants for the division.
``--test-grid`` also walks every pair over the test window, so the report
shows whether the chosen pair's neighbours agree. The report goes to
``--out`` (``/tmp`` when run on the production server, which keeps no file).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import date
from pathlib import Path

from ..model.version import BASELINE, ModelVersion, load_candidate
from .walk_forward import BacktestMatch, Fitter, walk_forward

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
    #: The version tuned on top of, and its constants for the division ("published" above).
    base: str = BASELINE.id
    base_xi: float = BASELINE.xi
    base_ridge: float = BASELINE.ridge
    #: ``[xi, ridge, log loss]`` of every pair on the tuning window, and on the
    #: test window when it was walked for every pair (``--test-grid``).
    tune_grid: list[tuple[float, float, float]] = field(default_factory=list)
    test_grid: list[tuple[float, float, float]] = field(default_factory=list)


def best_pair(
    scores: Mapping[tuple[float, float], float], prefer: tuple[float, float] | None = None
) -> tuple[float, float]:
    """The (xi, ridge) with the lowest log loss; ties go to ``prefer``, by default
    the published constants."""
    if not scores:
        raise ValueError("no scores to choose from")
    published = prefer or (BASELINE.xi, BASELINE.ridge)
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
    base: ModelVersion = BASELINE,
    fitter_for: Callable[[ModelVersion], Fitter] | None = None,
    test_grid: bool = False,
) -> DivisionTuning:
    """Tune ``(xi, ridge)`` for one division on top of ``base`` (the published
    version unless told another), fitting with ``fitter_for(version)`` when given."""

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
            fitter=fitter_for(version) if fitter_for else None,
        )
        return result.model.log_loss, len(result.forecasts)

    def candidate(xi: float, ridge: float) -> ModelVersion:
        return replace(base, xi=xi, ridge=ridge, per_division={})

    pairs = [(xi, ridge) for xi in xi_grid for ridge in ridge_grid]
    own = base.constants_for(division)
    scores = {pair: log_loss(candidate(*pair), tune)[0] for pair in pairs}
    xi, ridge = best_pair(scores, own)
    tune_baseline = scores[own] if own in scores else log_loss(candidate(*own), tune)[0]
    tests: dict[tuple[float, float], tuple[float, int]] = {}
    if test_grid:
        tests = {pair: log_loss(candidate(*pair), test) for pair in pairs}
    if own not in tests:
        tests[own] = log_loss(candidate(*own), test)
    if (xi, ridge) not in tests:
        tests[(xi, ridge)] = log_loss(candidate(xi, ridge), test)
    test_baseline, forecasts = tests[own]
    test_tuned = tests[(xi, ridge)][0]
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
        base=base.id,
        base_xi=own[0],
        base_ridge=own[1],
        tune_grid=[(x, r, round(ll, 5)) for (x, r), ll in scores.items()],
        test_grid=([(x, r, round(tests[(x, r)][0], 5)) for (x, r) in pairs] if test_grid else []),
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
    parser.add_argument(
        "--candidate",
        type=Path,
        help="tune on top of this candidate file (its window, Elo weight and prior)",
    )
    parser.add_argument(
        "--test-grid", action="store_true", help="also walk every pair over the test window"
    )
    parser.add_argument(
        "--xi", type=float, nargs="+", default=list(XI_GRID), help="the xi values to try"
    )
    parser.add_argument(
        "--ridge", type=float, nargs="+", default=list(RIDGE_GRID), help="the ridge values to try"
    )
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

    base = BASELINE
    if args.candidate is not None:
        loaded = load_candidate(args.candidate)
        if loaded is None:
            print(f"{args.candidate}: no such file, or it changes nothing", file=sys.stderr)
            return 2
        base = loaded

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
        prior: Callable[[date], Mapping[str, float] | None] | None = elo_on
        fitter_for: Callable[[ModelVersion], Fitter] | None = None
        if args.candidate is not None:
            prior = None if args.no_elo else candidate_prior(database_url, base, division,
                                                             args.test_to)  # fmt: skip
            fitter_for = within_history
        tuned = tune_division(
            division,
            matches,
            tune=(args.tune_from, args.tune_to),
            test=(args.test_from, args.test_to),
            xi_grid=args.xi,
            ridge_grid=args.ridge,
            elo_on=prior,
            base=base,
            fitter_for=fitter_for,
            test_grid=args.test_grid,
        )
        results.append(tuned)
        for x, r, ll in tuned.tune_grid:
            test = {(tx, tr): tll for tx, tr, tll in tuned.test_grid}.get((x, r))
            print(f"{division}: xi {x} ridge {r} | tune {ll:.4f}"
                  + ("" if test is None else f" | test {test:.4f}"), flush=True)  # fmt: skip
        print(
            f"{division}: xi {tuned.xi} ridge {tuned.ridge} | tune {tuned.tune_log_loss:.4f} "
            f"({base.id} {tuned.tune_baseline:.4f}) | test {tuned.test_log_loss:.4f} "
            f"({base.id} {tuned.test_baseline:.4f}, {tuned.test_forecasts} forecasts) -> "
            f"{'adopt' if tuned.adopted else 'keep ' + base.id}"
        )

    args.out.mkdir(parents=True, exist_ok=True)
    grid = f"xi{min(args.xi)}-{max(args.xi)}"
    path = args.out / f"tuning_{args.test_from.isoformat()}..{args.test_to.isoformat()}_{grid}.json"
    path.write_text(
        json.dumps(
            {
                "published": BASELINE.as_dict(),
                "base": base.as_dict(),
                "grid": {"xi": list(args.xi), "ridge": list(args.ridge)},
                "min_gain": MIN_GAIN,
                "elo": not args.no_elo,
                "divisions": [asdict(r) for r in results],
            },
            indent=2,
        )
    )
    print(f"-> {path}")
    return 0


def within_history(version: ModelVersion) -> Fitter:
    """The version's fit over its ``history_days`` only, as the service and
    ``backtest.compare`` fit it."""
    from .compare import _within_history

    return _within_history(version)


def candidate_prior(
    database_url: str, version: ModelVersion, division: str, until: date
) -> Callable[[date], Mapping[str, float] | None]:
    """The Elo prior ``version`` reads for ``division``, from the store, as
    ``backtest.compare`` reads it."""
    import psycopg

    from ..training.own_elo import read_matches
    from .elo_prior import OwnEloByDay, last_cached_clubelo
    from .inputs import prior_for

    with psycopg.connect(database_url) as conn:
        everything = read_matches(conn, until)
        with conn.cursor() as cur:
            cur.execute("SELECT division, team_id::text, training_name FROM training.team_alias")
            aliases: dict[str, dict[str, str]] = {}
            for alias_division, team_id, name in cur.fetchall():
                aliases.setdefault(str(alias_division), {})[str(team_id)] = str(name)
    own = OwnEloByDay(everything, aliases)

    def clubelo_on(day: date) -> dict[str, float] | None:
        with psycopg.connect(database_url) as conn:
            return last_cached_clubelo(conn, day) or None

    def own_on(day: date) -> dict[str, float] | None:
        return own.on(day, division) or None

    return prior_for(version, clubelo_on, own_on)


if __name__ == "__main__":
    sys.exit(main())
