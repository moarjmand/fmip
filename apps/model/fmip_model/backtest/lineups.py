"""Fitting the line-up term on our own recorded matches (T-534, D-086).

    python -m fmip_model.backtest.lineups --divisions E0 SP1 D1 I1 F1 IR1 \\
        --split 2026-10-15 --until 2027-06-30 --out reports

Every finished match of these divisions whose two XIs can be measured the way
the API measures them before a kick-off is forecast by the candidate's
per-division fit on the matches before it, refitted weekly: its expected goals
are the offsets, and ``beta`` is the one number fitted on the matches before
``--split``. The matches after it are scored with and without the term, the
same matches both ways, so the gain is the term's alone.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from pathlib import Path

from ..model.dixon_coles import FittedModel, MatchObservation, fit
from ..model.lineups import LineupSample, RecordedXi, adjusted, fit_beta
from ..model.poisson import outcome_from_matrix, score_matrix
from ..model.version import BASELINE, ModelVersion, load_candidate
from .metrics import Forecast, Result, log_loss

REFIT_EVERY_DAYS = 7
MIN_HISTORY = 60


@dataclass(frozen=True)
class Dated:
    day: date
    sample: LineupSample


def pair(
    matches: Sequence[MatchObservation], xis: Sequence[RecordedXi]
) -> list[tuple[MatchObservation, RecordedXi]]:
    """Each measured XI pair with its training match: the same clubs, a day apart at most.

    A day, because the training data dates a match locally and our records in UTC.
    """
    by_clubs: dict[tuple[str, str], list[MatchObservation]] = {}
    for m in matches:
        by_clubs.setdefault((m.home, m.away), []).append(m)
    out: list[tuple[MatchObservation, RecordedXi]] = []
    for xi in xis:
        for m in by_clubs.get((xi.home_team_id, xi.away_team_id), []):
            if abs((m.date - xi.day).days) <= 1:
                out.append((m, xi))
                break
    return sorted(out, key=lambda mx: mx[0].date)


def samples_for(
    division: str,
    matches: Sequence[MatchObservation],
    xis: Sequence[RecordedXi],
    version: ModelVersion,
) -> list[Dated]:
    """The fitted model's expected goals for every paired match, from its past only."""
    ordered = sorted(matches, key=lambda m: m.date)
    xi_rate, ridge = version.constants_for(division)
    out: list[Dated] = []
    model: FittedModel | None = None
    last_fit: date | None = None
    for match, xi in pair(ordered, xis):
        fit_date = match.date - timedelta(days=1)
        if model is None or last_fit is None or (fit_date - last_fit).days >= REFIT_EVERY_DAYS:
            since = fit_date - timedelta(days=version.history_days)
            history = [m for m in ordered if since < m.date <= fit_date]
            if len(history) < MIN_HISTORY:
                continue
            model = fit(history, fit_date, xi=xi_rate, ridge=ridge)
            last_fit = fit_date
        try:
            lam, mu = model.expected_goals(match.home, match.away)
        except KeyError:
            continue
        out.append(
            Dated(
                match.date,
                LineupSample(lam, mu, model.rho, xi.difference, match.home_goals, match.away_goals),
            )
        )
    return out


def one_x_two(sample: LineupSample, beta: float) -> Forecast:
    lam, mu = adjusted(sample.lam, sample.mu, beta, sample.difference)
    outcome = outcome_from_matrix(score_matrix(lam, mu, sample.rho))
    return Forecast(outcome.home_win, outcome.draw, outcome.away_win)


def result_of(sample: LineupSample) -> Result:
    if sample.home_goals > sample.away_goals:
        return "H"
    return "A" if sample.home_goals < sample.away_goals else "D"


@dataclass(frozen=True)
class LineupReport:
    beta: float
    fitted_on: int
    tested_on: int
    test_log_loss_with: float
    test_log_loss_without: float

    @property
    def gain(self) -> float:
        return self.test_log_loss_without - self.test_log_loss_with


def evaluate(samples: Sequence[Dated], split: date) -> LineupReport:
    fitting = [d.sample for d in samples if d.day < split]
    testing = [d.sample for d in samples if d.day >= split]
    if not fitting or not testing:
        raise ValueError("both sides of the split need matches with both XIs measured")
    beta = fit_beta(fitting)
    results = [result_of(s) for s in testing]
    return LineupReport(
        beta=beta,
        fitted_on=len(fitting),
        tested_on=len(testing),
        test_log_loss_with=log_loss([one_x_two(s, beta) for s in testing], results),
        test_log_loss_without=log_loss([one_x_two(s, 0.0) for s in testing], results),
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.backtest.lineups", description=__doc__)
    parser.add_argument("--divisions", nargs="+", required=True)
    parser.add_argument("--split", type=date.fromisoformat, required=True)
    parser.add_argument("--until", type=date.fromisoformat, required=True)
    parser.add_argument("--out", type=Path, default=Path("reports"))
    args = parser.parse_args(argv)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2

    import psycopg

    from ..model.data import every_match_before
    from ..model.lineups import xi_before_kickoff

    version = load_candidate() or BASELINE
    with psycopg.connect(database_url) as conn:
        xis = xi_before_kickoff(conn, args.divisions)
        if not xis:
            print("no finished match with both XIs measured yet", file=sys.stderr)
            return 1
        since = min(x.day for x in xis) - timedelta(days=version.history_days + 1)
        tagged = every_match_before(conn, args.until, since=since)

    samples: list[Dated] = []
    per_division: dict[str, int] = {}
    for division in args.divisions:
        matches = [m for d, m in tagged if d == division]
        found = samples_for(division, matches, [x for x in xis if x.division == division], version)
        per_division[division] = len(found)
        samples.extend(found)
    samples.sort(key=lambda d: d.day)
    report = evaluate(samples, args.split)

    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"lineups_{args.split.isoformat()}.json"
    path.write_text(
        json.dumps(
            {
                "base_version": version.id,
                "split": args.split.isoformat(),
                "per_division": per_division,
                **asdict(report),
                "gain": report.gain,
            },
            indent=2,
        )
    )
    print(
        f"beta {report.beta:.4f} from {report.fitted_on} matches | test {report.tested_on}: "
        f"with {report.test_log_loss_with:.4f}, without {report.test_log_loss_without:.4f} "
        f"(gain {report.gain:+.4f}) -> {path}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
