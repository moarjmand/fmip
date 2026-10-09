"""Which Elo prior, if any, the candidate should fit with (T-922, D-111).

    python -m fmip_model.backtest.elo_prior --from 2025-08-01 --to 2026-06-30 \\
        --history-from 2023-07-01 --out reports

For every division the candidate names, the same walk-forward (the same
matches, the same weekly fit dates, the candidate's own per-division
constants) is run three times:

- ``none``: no prior, as every forecast since Club Elo stopped answering;
- ``clubelo``: Club Elo's last cached ratings -- per club, the newest rating
  the store holds from on or before the fit date, however old;
- ``own``: our own Elo (T-921), computed from the store's results as of the
  fit date and read by the division's training names.

Each is scored on the matches all three forecast, so a variant that skips a
match cannot look better for it. A variant with no ratings at all (no Club Elo
snapshot held) is reported as not run, never as the ``none`` numbers under
another name.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from pathlib import Path

import psycopg

from ..model.own_elo import RULES, EloMatch, compute, for_division
from ..model.version import PUBLISHED, ModelVersion, load_candidate
from ..training.own_elo import read_matches
from .__main__ import load_matches
from .walk_forward import BacktestMatch, BacktestResult, ScoredForecast, scorecard, walk_forward

VARIANTS: tuple[str, ...] = ("none", "clubelo", "own")

Conn = psycopg.Connection[tuple[object, ...]]
EloOn = Callable[[date], Mapping[str, float] | None]


@dataclass(frozen=True)
class VariantScore:
    variant: str
    ran: bool
    fits_with_prior: int
    log_loss: float | None
    brier: float | None


@dataclass(frozen=True)
class DivisionComparison:
    division: str
    xi: float
    ridge: float
    matches: int
    scores: list[VariantScore]


class OwnEloByDay:
    """Our own Elo as of any day, from one read of the store's results, cached per day."""

    def __init__(self, matches: Sequence[EloMatch], aliases: Mapping[str, Mapping[str, str]]):
        self.matches = list(matches)
        self.aliases = aliases
        self._days: dict[date, dict[str, float]] = {}

    def on(self, day: date, division: str) -> dict[str, float]:
        if day not in self._days:
            run = compute(self.matches, day, RULES)
            self._days[day] = {club: r.elo for club, r in run.ratings.items()}
        return for_division(self._days[day], division, self.aliases.get(division, {}))


def last_cached_clubelo(
    conn: psycopg.Connection[tuple[object, ...]], day: date
) -> dict[str, float]:
    """Per club, the newest Club Elo rating from on or before ``day``, however old."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (club) club, elo FROM training.elo
             WHERE from_date <= %s ORDER BY club, from_date DESC
            """,
            (day,),
        )
        return {str(r[0]): float(str(r[1])) for r in cur.fetchall()}


def key(forecast: ScoredForecast) -> tuple[date, str, str]:
    return (forecast.match.date, forecast.match.home, forecast.match.away)


def compare(
    results: Mapping[str, BacktestResult | None], prior_fits: Mapping[str, int]
) -> tuple[int, list[VariantScore]]:
    """Score every variant that ran on the matches all of them forecast."""
    ran = {v: r for v, r in results.items() if r is not None}
    common = set.intersection(*({key(f) for f in r.forecasts} for r in ran.values()))
    scores: list[VariantScore] = []
    for variant in VARIANTS:
        result = results.get(variant)
        if result is None:
            scores.append(VariantScore(variant, False, 0, None, None))
            continue
        kept = [f for f in result.forecasts if key(f) in common]
        card = scorecard([f.model for f in kept], [f.match.result for f in kept])
        scores.append(
            VariantScore(variant, True, prior_fits.get(variant, 0), card.log_loss, card.brier)
        )
    return len(common), scores


def run_division(
    division: str,
    version: ModelVersion,
    matches: Sequence[BacktestMatch],
    window: tuple[date, date],
    priors: Mapping[str, EloOn | None],
    min_history: int = 60,
) -> DivisionComparison:
    xi, ridge = version.constants_for(division)
    fitted = replace(version, xi=xi, ridge=ridge, per_division={})
    results: dict[str, BacktestResult | None] = {}
    prior_fits: dict[str, int] = {}
    for variant in VARIANTS:
        elo_on = priors.get(variant)
        if variant != "none" and elo_on is None:
            results[variant] = None
            continue
        with_prior = 0

        def counted(day: date, elo_on: EloOn | None = elo_on) -> Mapping[str, float] | None:
            nonlocal with_prior
            ratings = elo_on(day) if elo_on is not None else None
            if ratings:
                with_prior += 1
                return ratings
            return None

        result = walk_forward(
            matches,
            window_start=window[0],
            window_end=window[1],
            scope=f"{division} {variant}",
            min_history=min_history,
            version=fitted,
            elo_on=counted,
        )
        if variant != "none" and with_prior == 0:
            results[variant] = None  # no rating at any fit date: not run
            continue
        prior_fits[variant] = with_prior
        results[variant] = result
    count, scores = compare(results, prior_fits)
    return DivisionComparison(division, xi, ridge, count, scores)


def pooled(rows: Sequence[DivisionComparison]) -> dict[str, float | None]:
    """Match-weighted mean log loss per variant, over divisions where every variant ran."""
    out: dict[str, float | None] = {}
    for variant in VARIANTS:
        total, n = 0.0, 0
        for row in rows:
            score = next(s for s in row.scores if s.variant == variant)
            if score.log_loss is None:
                continue
            total += score.log_loss * row.matches
            n += row.matches
        out[variant] = None if n == 0 else round(total / n, 4)
    return out


def write(rows: Sequence[DivisionComparison], version: ModelVersion, window: tuple[date, date],
          out: Path, note: str) -> Path:  # fmt: skip
    folder = out / f"{version.name}-{version.version}"
    folder.mkdir(parents=True, exist_ok=True)
    stem = f"elo_prior_{window[0].isoformat()}..{window[1].isoformat()}"
    summary = pooled(rows)
    body = {
        "model_version": version.id,
        "own_elo_rules": RULES.id,
        "window": [window[0].isoformat(), window[1].isoformat()],
        "note": note,
        "pooled_log_loss": summary,
        "divisions": [
            {
                "division": r.division,
                "xi": r.xi,
                "ridge": r.ridge,
                "matches": r.matches,
                "scores": [s.__dict__ for s in r.scores],
            }
            for r in rows
        ],
    }
    (folder / f"{stem}.json").write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")

    def cell(s: VariantScore) -> str:
        return "not run" if s.log_loss is None else f"{s.log_loss:.4f}"

    lines = [
        f"# Elo prior for {version.id}, {window[0]} to {window[1]}",
        "",
        note,
        "",
        "Log loss on the matches every variant that ran forecast (lower is better).",
        "",
        "| Division | xi | ridge | Matches | none | Club Elo (last cached) | own |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        cells = " | ".join(cell(s) for s in r.scores)
        lines.append(f"| {r.division} | {r.xi} | {r.ridge} | {r.matches} | {cells} |")
    pooled_cells = " | ".join("not run" if v is None else f"{v:.4f}" for v in summary.values())
    lines.append(f"| **Pooled** | | | {sum(r.matches for r in rows)} | {pooled_cells} |")
    md = folder / f"{stem}.md"
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return md


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.backtest.elo_prior", description=__doc__)
    parser.add_argument("--divisions", nargs="*", help="default: the candidate's divisions")
    parser.add_argument("--from", dest="window_from", type=date.fromisoformat, required=True)
    parser.add_argument("--to", dest="window_to", type=date.fromisoformat, required=True)
    parser.add_argument("--history-from", type=date.fromisoformat, required=True)
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--note", default="", help="where and on what data this was run")
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    version = load_candidate() or PUBLISHED
    divisions = args.divisions or sorted(version.per_division)
    window = (args.window_from, args.window_to)

    with psycopg.connect(database_url) as conn:
        everything = read_matches(conn, args.window_to)
        with conn.cursor() as cur:
            cur.execute("SELECT division, team_id::text, training_name FROM training.team_alias")
            aliases: dict[str, dict[str, str]] = {}
            for division, team_id, name in cur.fetchall():
                aliases.setdefault(str(division), {})[str(team_id)] = str(name)
    own = OwnEloByDay(everything, aliases)

    def clubelo_on(day: date) -> dict[str, float] | None:
        with psycopg.connect(database_url) as conn:
            return last_cached_clubelo(conn, day) or None

    def own_on(division: str) -> EloOn:
        return lambda day: own.on(day, division) or None

    rows: list[DivisionComparison] = []
    for division in divisions:
        matches = load_matches(database_url, division, args.history_from, args.window_to)
        if not matches:
            print(f"{division}: no matches in the training store", file=sys.stderr)
            continue
        row = run_division(
            division,
            version,
            matches,
            window,
            {
                "none": None,
                "clubelo": clubelo_on,
                "own": own_on(division),
            },
        )
        rows.append(row)
        cells = ", ".join(
            f"{s.variant} {'not run' if s.log_loss is None else f'{s.log_loss:.4f}'}"
            for s in row.scores
        )
        print(f"{division}: {row.matches} matches; {cells}", flush=True)
    if not rows:
        return 1
    md = write(rows, version, window, args.out, args.note)
    print(f"pooled {pooled(rows)} -> {md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
