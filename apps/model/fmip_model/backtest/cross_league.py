"""The fit across leagues, judged on matches between clubs of different leagues (T-533).

    python -m fmip_model.backtest.cross_league \\
        --tune-from 2024-07-01 --tune-to 2025-06-30 \\
        --test-from 2025-07-01 --test-to 2026-06-30 --history-days 1100 --out reports

Only the matches of our own records that cross leagues (division ``XL``) are
forecast, each from a fit on every match before its day, refitted weekly --
the way the service fits. The constants are chosen on the tuning window and
the choice is scored once on the test window, against uniform and against the
tuning window's home/draw/away frequencies: a forecaster that knew nothing of
the clubs. Matches with a club of a league the model does not hold are also
scored on their own, because that is where the method is weakest.
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import sys
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from pathlib import Path

from ..model.cross_league import CROSS_LEAGUE, OTHER_GROUP, fit_joint, groups_for
from ..model.dixon_coles import FittedModel, MatchObservation
from ..model.version import CrossLeague
from .metrics import Forecast, Result, brier, log_loss

XI_GRID = (0.001, 0.002, 0.004)
TEAM_RIDGE_GRID = (0.05, 0.2, 1.0)
GROUP_RIDGE_GRID = (0.001, 0.01, 0.1)

Tagged = Sequence[tuple[str, MatchObservation]]


def result_of(m: MatchObservation) -> Result:
    return "H" if m.home_goals > m.away_goals else "A" if m.home_goals < m.away_goals else "D"


@dataclass(frozen=True)
class CrossForecast:
    match: MatchObservation
    forecast: Forecast
    #: Whether either club is in the ``other`` group: no domestic league held.
    outsider: bool


def forecast_window(
    tagged: Tagged,
    window: tuple[date, date],
    constants: CrossLeague,
    *,
    history_days: int,
    refit_every_days: int = 7,
    min_history: int = 60,
) -> tuple[list[CrossForecast], int]:
    """Every cross-league match in the window that can be forecast, and how many could not."""
    ordered = sorted(tagged, key=lambda dm: dm[1].date)
    targets = [m for d, m in ordered if d == CROSS_LEAGUE and window[0] <= m.date <= window[1]]
    out: list[CrossForecast] = []
    skipped = 0
    model: FittedModel | None = None
    groups: dict[str, str] = {}
    last_fit: date | None = None
    for match in targets:
        fit_date = match.date - timedelta(days=1)
        if model is None or last_fit is None or (fit_date - last_fit).days >= refit_every_days:
            since = fit_date - timedelta(days=history_days)
            history = [(d, m) for d, m in ordered if since < m.date <= fit_date]
            if len(history) < min_history:
                skipped += 1
                continue
            groups = groups_for(history)
            model = fit_joint(
                [m for _, m in history],
                groups,
                fit_date,
                xi=constants.xi,
                team_ridge=constants.team_ridge,
                group_ridge=constants.group_ridge,
            )
            last_fit = fit_date
        if match.home not in model.attack or match.away not in model.attack:
            skipped += 1
            continue
        outcome = model.predict(match.home, match.away)
        out.append(
            CrossForecast(
                match,
                Forecast(outcome.home_win, outcome.draw, outcome.away_win),
                outsider=OTHER_GROUP in (groups.get(match.home), groups.get(match.away)),
            )
        )
    return out, skipped


def frequencies(forecasts: Sequence[CrossForecast]) -> Forecast:
    """Home, draw and away as often as they happened: the forecaster that knows no club."""
    results = [result_of(f.match) for f in forecasts]
    n = len(results)
    return Forecast(results.count("H") / n, results.count("D") / n, results.count("A") / n)


@dataclass(frozen=True)
class Score:
    forecasts: int
    log_loss: float
    brier: float
    uniform_log_loss: float
    frequencies_log_loss: float


def score(forecasts: Sequence[CrossForecast], base: Forecast) -> Score:
    results = [result_of(f.match) for f in forecasts]
    model = [f.forecast for f in forecasts]
    return Score(
        forecasts=len(forecasts),
        log_loss=log_loss(model, results),
        brier=brier(model, results),
        uniform_log_loss=log_loss([Forecast(1 / 3, 1 / 3, 1 / 3)] * len(results), results),
        frequencies_log_loss=log_loss([base] * len(results), results),
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.backtest.cross_league", description=__doc__)
    parser.add_argument("--tune-from", type=date.fromisoformat, required=True)
    parser.add_argument("--tune-to", type=date.fromisoformat, required=True)
    parser.add_argument("--test-from", type=date.fromisoformat, required=True)
    parser.add_argument("--test-to", type=date.fromisoformat, required=True)
    parser.add_argument("--history-days", type=int, default=1100)
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--xi", type=float, nargs="+", default=list(XI_GRID))
    parser.add_argument("--team-ridge", type=float, nargs="+", default=list(TEAM_RIDGE_GRID))
    parser.add_argument("--group-ridge", type=float, nargs="+", default=list(GROUP_RIDGE_GRID))
    args = parser.parse_args(argv)
    if not args.tune_to < args.test_from:
        print("the test window must start after the tuning window ends", file=sys.stderr)
        return 2
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2

    import psycopg

    from ..model.data import every_match_before

    since = args.tune_from - timedelta(days=args.history_days + 1)
    with psycopg.connect(database_url) as conn:
        tagged = every_match_before(conn, args.test_to, since=since)
    if not any(d == CROSS_LEAGUE for d, _ in tagged):
        print(
            "no cross-league match in the training store: load records --divisions XL",
            file=sys.stderr,
        )
        return 1

    tuning: list[dict[str, object]] = []
    best: tuple[float, CrossLeague] | None = None
    for xi, team_ridge, group_ridge in itertools.product(
        args.xi, args.team_ridge, args.group_ridge
    ):
        constants = CrossLeague(xi, team_ridge, group_ridge)
        forecasts, skipped = forecast_window(
            tagged, (args.tune_from, args.tune_to), constants, history_days=args.history_days
        )
        if not forecasts:
            print("no tuning match could be forecast", file=sys.stderr)
            return 1
        loss = log_loss([f.forecast for f in forecasts], [result_of(f.match) for f in forecasts])
        tuning.append(
            {**asdict(constants), "log_loss": loss, "forecasts": len(forecasts), "skipped": skipped}
        )
        print(
            f"tune xi {xi} team {team_ridge} group {group_ridge}: {loss:.4f} ({len(forecasts)})",
            flush=True,
        )
        if best is None or loss < best[0]:
            best = (loss, constants)
    assert best is not None
    chosen = best[1]

    tuned, _ = forecast_window(
        tagged, (args.tune_from, args.tune_to), chosen, history_days=args.history_days
    )
    base = frequencies(tuned)
    tested, skipped = forecast_window(
        tagged, (args.test_from, args.test_to), chosen, history_days=args.history_days
    )
    overall = score(tested, base)
    outsiders = [f for f in tested if f.outsider]
    report = {
        "chosen": asdict(chosen),
        "history_days": args.history_days,
        "tune": {
            "from": args.tune_from.isoformat(),
            "to": args.tune_to.isoformat(),
            "grid": tuning,
        },
        "test": {
            "from": args.test_from.isoformat(),
            "to": args.test_to.isoformat(),
            "skipped": skipped,
            "all": asdict(overall),
            "with_an_outsider": asdict(score(outsiders, base)) if outsiders else None,
            "between_held_leagues": (
                asdict(score([f for f in tested if not f.outsider], base))
                if len(outsiders) < len(tested)
                else None
            ),
        },
    }
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"cross_league_{args.test_from.isoformat()}..{args.test_to.isoformat()}.json"
    path.write_text(json.dumps(report, indent=2))
    print(
        f"chosen {asdict(chosen)} | test {overall.log_loss:.4f} over {overall.forecasts} "
        f"(uniform {overall.uniform_log_loss:.4f}, frequencies {overall.frequencies_log_loss:.4f}, "
        f"skipped {skipped}) -> {path}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
