"""Backtest a proposed candidate file against the published version (T-1368, D-186).

    python -m fmip_model.backtest.compare --candidate-file path/to/<name>-<version>.json \\
        [--against <candidate name> | --against published] [--divisions E0 SP1 ...] \\
        [--from 2025-08-01] [--to 2026-06-30] [--history-from 2023-07-01] [--fetch] [--jobs N]

The collaborator's command: ``scripts/model-backtest.sh <file>`` runs it in the
model's Docker image (docs/15-model.md). Per division, one walk-forward with
the fit dates of ``backtest.inputs`` (fit the day before, refit at most weekly,
60 matches of history first) forecasts the same matches three times:

- ``published``: the published version (``BASELINE``) with its Club Elo prior
  as last cached (none on a store that holds no Club Elo snapshot);
- ``reference``: what the proposal must beat -- by default the newest other
  candidate in ``fmip_model/model/candidates/``, else the published version;
- ``proposed``: the file's version, with its own constants and prior.

Each fit reads only the matches of its version's ``history_days`` before the
fit date, as the service does. The closing odds (de-margined) and uniform
(one third each) are scored on the same matches, which are the ones every
version forecast and the market priced.

The proposal is judged against the reference by D-139's bar (``BAR`` in
``backtest.inputs``: lower log loss with a 95% paired bootstrap interval
below zero, calibration not demonstrably worse, worse in at most a third of
the divisions, at least 300 matches), football-data.co.uk divisions and our
records' divisions apart. The report goes to
``reports/<name>-<version>/compare_<from>..<to>.{md,json}``. Nothing is
published or promoted here: a candidate enters shadow when its file is merged,
and is promoted only on its own pre-kick-off record (D-082, D-140).

``--fetch`` first loads, from football-data.co.uk, every season of the window
and its history that the training store does not hold yet (the same load as
``python -m fmip_model.training.load football-data``).

For code: ``run_division`` (no database) and ``summarise`` are the whole
comparison; ``main`` only reads the store and writes the report.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass, replace
from datetime import date, timedelta
from pathlib import Path

import psycopg

from ..model.dixon_coles import FittedModel, MatchObservation
from ..model.version import BASELINE, ModelVersion, load_candidate, load_candidates
from ..training.own_elo import read_matches
from ..training.sources import FOOTBALL_DATA, season_label
from .__main__ import load_matches
from .elo_prior import OwnEloByDay, last_cached_clubelo
from .inputs import (
    BAR,
    Bar,
    DivisionRun,
    Group,
    GroupVerdict,
    MatchScore,
    Verdict,
    division_groups,
    judge,
    prior_for,
)
from .metrics import Forecast, Result
from .report import PUBLISHABLE_LOG_LOSS_MARGIN
from .walk_forward import (
    BacktestMatch,
    BacktestResult,
    Fitter,
    default_fitter,
    scorecard,
    walk_forward,
)

#: The football-data.co.uk divisions the product serves from the training store.
FOOTBALL_DATA_DIVISIONS: tuple[str, ...] = (
    "E0", "E1", "SP1", "D1", "I1", "F1", "N1", "P1", "T1", "B1", "SC0",
)  # fmt: skip
#: 2025/26 walked forward, with two seasons of history before it.
DEFAULT_FROM = date(2025, 8, 1)
DEFAULT_TO = date(2026, 6, 30)
DEFAULT_HISTORY_FROM = date(2023, 7, 1)

ROLES: tuple[str, ...] = ("published", "reference", "proposed")
#: Every forecaster the report scores, the three versions then the two yardsticks.
FORECASTERS: tuple[str, ...] = (*ROLES, "market", "uniform")
UNIFORM = Forecast(1 / 3, 1 / 3, 1 / 3)

EloOn = Callable[[date], Mapping[str, float] | None]


# --- one division, no database ----------------------------------------------------


@dataclass(frozen=True)
class Row:
    """One match, forecast by every version and priced by the market."""

    match: BacktestMatch
    published: Forecast
    reference: Forecast
    proposed: Forecast
    market: Forecast

    def of(self, forecaster: str) -> Forecast:
        if forecaster == "uniform":
            return UNIFORM
        forecast: Forecast = getattr(self, forecaster)
        return forecast


@dataclass(frozen=True)
class DivisionResult:
    division: str
    rows: list[Row]
    #: Matches every version forecast that had no closing odds, so were left out.
    without_odds: int
    refits: int
    #: Per role, the fits that had an Elo prior to read.
    fits_with_prior: dict[str, int]


def _at(version: ModelVersion, division: str) -> ModelVersion:
    """The version with the division's own constants as its only ones."""
    xi, ridge = version.constants_for(division)
    return replace(version, xi=xi, ridge=ridge, per_division={})


def _within_history(version: ModelVersion) -> Fitter:
    """The version's fit, reading only the ``history_days`` before the fit date."""
    base = default_fitter(version)

    def fit(
        history: Sequence[MatchObservation], fit_date: date, elo: Mapping[str, float] | None
    ) -> FittedModel:
        since = fit_date - timedelta(days=version.history_days)
        return base([m for m in history if m.date >= since], fit_date, elo)

    return fit


def _key(match: MatchObservation) -> tuple[date, str, str]:
    return (match.date, match.home, match.away)


def run_division(
    division: str,
    matches: Sequence[BacktestMatch],
    window: tuple[date, date],
    *,
    proposed: ModelVersion,
    reference: ModelVersion,
    published: ModelVersion = BASELINE,
    elo_for: Callable[[ModelVersion], EloOn | None] = lambda _version: None,
    min_history: int = 60,
    refit_every_days: int = 7,
) -> DivisionResult:
    """Forecast ``window`` with the three versions on the same fit dates.

    A version whose division constants, Elo weight, history and prior are the
    same as one already run reuses its forecasts rather than fitting again.
    """
    ordered = sorted(matches, key=lambda m: m.date)
    runs: dict[tuple[object, ...], tuple[BacktestResult, int]] = {}
    by_role: dict[str, tuple[BacktestResult, int]] = {}
    for role, version in zip(ROLES, (published, reference, proposed), strict=True):
        at = _at(version, division)
        same = (at.xi, at.ridge, at.elo_weight, at.elo_scale, at.history_days, at.elo_prior)
        if same not in runs:
            elo = elo_for(version)
            hits = [0]

            def counted(day: date, elo: EloOn | None = elo, hits: list[int] = hits
                        ) -> Mapping[str, float] | None:  # fmt: skip
                ratings = elo(day) if elo else None
                if ratings:
                    hits[0] += 1
                    return ratings
                return None

            result = walk_forward(
                ordered,
                window_start=window[0],
                window_end=window[1],
                scope=f"{division} {role}",
                min_history=min_history,
                refit_every_days=refit_every_days,
                version=at,
                elo_on=counted,
                fitter=_within_history(at),
            )
            runs[same] = (result, hits[0])
        by_role[role] = runs[same]

    forecasts = {
        role: {_key(f.match): f.model for f in result.forecasts}
        for role, (result, _) in by_role.items()
    }
    rows: list[Row] = []
    without_odds = 0
    for f in by_role["proposed"][0].forecasts:
        key = _key(f.match)
        if any(key not in forecasts[role] for role in ROLES):
            continue
        if f.market is None:
            without_odds += 1
            continue
        rows.append(
            Row(
                f.match,
                forecasts["published"][key],
                forecasts["reference"][key],
                forecasts["proposed"][key],
                f.market,
            )
        )
    return DivisionResult(
        division,
        rows,
        without_odds,
        by_role["proposed"][0].refits,
        {role: hits for role, (_, hits) in by_role.items()},
    )


# --- the scores and the verdict ---------------------------------------------------


def accuracy(forecasts: Sequence[Forecast], results: Sequence[Result]) -> float:
    """Share of matches whose result was the outcome given the highest probability.

    A tie at the top shares the credit (uniform scores one third), so a
    forecaster cannot gain by an arbitrary tie-break.
    """
    if len(forecasts) != len(results) or not forecasts:
        raise ValueError("need the same non-zero number of forecasts and results")
    total = 0.0
    for f, r in zip(forecasts, results, strict=True):
        probs = dict(zip("HDA", f.as_tuple(), strict=True))
        top = max(probs.values())
        leaders = [o for o, p in probs.items() if abs(p - top) < 1e-12]
        total += (1.0 / len(leaders)) if r in leaders else 0.0
    return total / len(forecasts)


@dataclass(frozen=True)
class Scores:
    n: int
    log_loss: float
    brier: float
    accuracy: float
    calibration_error: float


def scores_of(rows: Sequence[Row], forecaster: str) -> Scores:
    forecasts = [r.of(forecaster) for r in rows]
    results = [r.match.result for r in rows]
    card = scorecard(forecasts, results)
    return Scores(
        len(rows),
        round(card.log_loss, 5),
        round(card.brier, 5),
        round(accuracy(forecasts, results), 5),
        round(card.calibration_error, 5),
    )


def as_runs(results: Sequence[DivisionResult], groups: Mapping[str, Group]) -> list[DivisionRun]:
    """The rows in the shape D-139's judge reads: the reference as the candidate,
    the proposal as the candidate "with the input", read on every match."""
    return [
        DivisionRun(
            r.division,
            groups.get(r.division, "football_data"),
            [
                MatchScore(
                    row.match, row.match.date, row.published, row.reference, row.proposed, True
                )  # fmt: skip
                for row in r.rows
            ],
            r.refits,
            r.fits_with_prior["published"],
            r.fits_with_prior["reference"],
        )
        for r in results
    ]


def summarise(
    results: Sequence[DivisionResult], groups: Mapping[str, Group], bar: Bar = BAR
) -> tuple[Verdict, list[GroupVerdict], dict[str, Scores], dict[str, dict[str, Scores]]]:
    """The verdict per group and overall, the pooled scores, the scores per division."""
    overall, verdicts = judge(as_runs([r for r in results if r.rows], groups), bar)
    everything = [row for r in results for row in r.rows]
    pooled = {f: scores_of(everything, f) for f in FORECASTERS} if everything else {}
    per_division = {
        r.division: {f: scores_of(r.rows, f) for f in FORECASTERS} for r in results if r.rows
    }
    return overall, verdicts, pooled, per_division


def not_exercised(proposed: ModelVersion, reference: ModelVersion) -> list[str]:
    """What the proposal changes that a per-division walk-forward cannot test."""
    out: list[str] = []
    if proposed.cross_league != reference.cross_league:
        out.append(
            "cross_league: the cross-league fit is judged on cup matches by "
            "`python -m fmip_model.backtest.cross_league`, not here"
        )
    if proposed.lineup_beta != reference.lineup_beta:
        out.append(
            "lineup_beta: the line-up term is judged on our records by "
            "`python -m fmip_model.backtest.lineups`, not here"
        )
    return out


# --- the report -------------------------------------------------------------------


def report_body(
    proposed: ModelVersion,
    reference: ModelVersion,
    window: tuple[date, date],
    history_from: date,
    results: Sequence[DivisionResult],
    groups: Mapping[str, Group],
    note: str,
    bar: Bar = BAR,
) -> dict[str, object]:
    overall, verdicts, pooled, per_division = summarise(results, groups, bar)
    market_gap = (
        None if not pooled else round(pooled["proposed"].log_loss - pooled["market"].log_loss, 5)
    )
    return {
        "proposed": proposed.id,
        "reference": reference.id,
        "published": BASELINE.id,
        "window": [window[0].isoformat(), window[1].isoformat()],
        "history_from": history_from.isoformat(),
        "note": note,
        "bar": asdict(bar),
        "verdict": overall,
        "groups": [asdict(g) for g in verdicts],
        "pooled": {f: asdict(s) for f, s in pooled.items()},
        "market_gap": market_gap,
        "publishable_margin": PUBLISHABLE_LOG_LOSS_MARGIN,
        "divisions": [
            {
                "division": r.division,
                "matches": len(r.rows),
                "without_odds": r.without_odds,
                "refits": r.refits,
                "fits_with_prior": r.fits_with_prior,
                "scores": {f: asdict(s) for f, s in per_division.get(r.division, {}).items()},
            }
            for r in results
        ],
        "not_exercised": not_exercised(proposed, reference),
        "versions": {
            "published": BASELINE.as_dict(),
            "reference": reference.as_dict(),
            "proposed": proposed.as_dict(),
        },
    }


def _verdict_sentence(body: Mapping[str, object]) -> str:
    verdict = body["verdict"]
    if verdict == "passed":
        return (
            f"**Verdict: passed.** {body['proposed']} beats {body['reference']} by D-139's bar: "
            "it may enter shadow, where only its own pre-kick-off record can promote it (D-082)."
        )
    if verdict == "failed":
        return (
            f"**Verdict: failed.** {body['proposed']} does not beat {body['reference']} by "
            "D-139's bar (reasons below). It does not enter shadow as it stands."
        )
    return f"**Verdict: {verdict}.** Too few matches for a verdict; widen the window or divisions."


def render(body: Mapping[str, object]) -> str:
    pooled = body["pooled"]
    groups = body["groups"]
    divisions = body["divisions"]
    window = body["window"]
    assert isinstance(pooled, dict) and isinstance(groups, list)
    assert isinstance(divisions, list) and isinstance(window, list)
    lines = [
        f"# {body['proposed']} against {body['reference']}, {window[0]} to {window[1]}",
        "",
        _verdict_sentence(body),
        "",
        f"Published version for reference: {body['published']}. History read from "
        f"{body['history_from']}. Every number is on the same matches: those every version "
        "forecast and the market priced. Lower is better for log loss, Brier and calibration "
        "error; higher is better for accuracy. Uniform is one third each (log loss 1.0986).",
    ]
    if body["note"]:
        lines += ["", str(body["note"])]
    lines += [
        "",
        "| Forecaster | Matches | Log loss | Brier | Accuracy | Calibration error |",
        "|---|---|---|---|---|---|",
    ]
    labels = {
        "published": f"published {body['published']}",
        "reference": f"reference {body['reference']}",
        "proposed": f"proposed {body['proposed']}",
        "market": "market (closing odds)",
        "uniform": "uniform",
    }
    for name in FORECASTERS:
        s = pooled.get(name)
        if s is None:
            continue
        lines.append(
            f"| {labels[name]} | {s['n']} | {s['log_loss']:.4f} | {s['brier']:.4f} "
            f"| {s['accuracy']:.1%} | {s['calibration_error']:.4f} |"
        )
    gap = body["market_gap"]
    if isinstance(gap, float):
        margin = body["publishable_margin"]
        lines += [
            "",
            f"Proposed minus market log loss: {gap:+.4f} "
            + (
                f"(within {margin}: as good as the market, D-016)."
                if gap <= float(str(margin))
                else f"(more than {margin} worse than the market: not publishable by D-016)."
            ),
        ]
    lines += [
        "",
        "## D-139's bar, proposed against reference",
        "",
        "| Group | Verdict | Matches | Log loss reference | proposed | Difference [95% interval] |",
        "|---|---|---|---|---|---|",
    ]
    groups = [g for g in groups if g["verdict"] != "not run"]
    for g in groups:
        if g["candidate"] is None:
            lines.append(f"| {g['group']} | {g['verdict']} | {g['scored']} | | | |")
            continue
        lo, hi = g["interval"]
        lines.append(
            f"| {g['group']} | {g['verdict']} | {g['scored']} | {g['candidate']['log_loss']:.4f} "
            f"| {g['with_input']['log_loss']:.4f} | {g['difference']:+.5f} [{lo:+.5f}, {hi:+.5f}] |"
        )
    for g in groups:
        for reason in g["reasons"]:
            reason = reason.replace("matches where the input could be read", "matches scored")
            lines.append(f"\n- {g['group']}: {reason}")
    lines += [
        "",
        "## Per division (log loss)",
        "",
        "| Division | Matches | Published | Reference | Proposed | Market | Uniform "
        "| Proposed accuracy | Fits with an Elo prior (pub / ref / prop of refits) |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for d in divisions:
        s = d["scores"]
        prior = d["fits_with_prior"]
        cells = " | ".join(
            f"{s[f]['log_loss']:.4f}" if f in s else "" for f in FORECASTERS
        )  # fmt: skip
        acc = f"{s['proposed']['accuracy']:.1%}" if "proposed" in s else ""
        lines.append(
            f"| {d['division']} | {d['matches']} | {cells} | {acc} "
            f"| {prior['published']} / {prior['reference']} / {prior['proposed']} "
            f"of {d['refits']} |"
        )
    extra = body["not_exercised"]
    assert isinstance(extra, list)
    if extra:
        lines += ["", "## Not tested by this comparison", ""]
        lines += [f"- {item}" for item in extra]
    return "\n".join(lines) + "\n"


def write(body: Mapping[str, object], proposed: ModelVersion, out: Path) -> Path:
    folder = out / f"{proposed.name}-{proposed.version}"
    folder.mkdir(parents=True, exist_ok=True)
    window = body["window"]
    assert isinstance(window, list)
    stem = f"compare_{window[0]}..{window[1]}"
    (folder / f"{stem}.json").write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    md = folder / f"{stem}.md"
    md.write_text(render(body), encoding="utf-8")
    return md


# --- the store --------------------------------------------------------------------


def seasons_between(since: date, until: date) -> list[str]:
    """football-data.co.uk season codes (``"2526"``) of every season from July to June
    that overlaps ``[since, until]``."""
    first = since.year if since.month >= 7 else since.year - 1
    last = until.year if until.month >= 7 else until.year - 1
    return [f"{y % 100:02d}{(y + 1) % 100:02d}" for y in range(first, last + 1)]


def fetch_missing(database_url: str, divisions: Sequence[str], seasons: Sequence[str]) -> list[str]:
    """Load from football-data.co.uk every (division, season) with no succeeded load yet.

    Returns what was loaded. Only football-data.co.uk divisions are fetched.
    """
    from ..training.load import load_football_data
    from ..training.store import TrainingStore

    wanted = [d for d in divisions if d in FOOTBALL_DATA_DIVISIONS]
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT scope FROM training.source_load WHERE source = %s AND status = 'succeeded'",
            (FOOTBALL_DATA.id,),
        )
        held = {str(r[0]) for r in cur.fetchall()}
    loaded: list[str] = []
    store = TrainingStore.connect(database_url)
    try:
        for season in seasons:
            missing = [d for d in wanted if f"{d} {season_label(season)}" not in held]
            if missing:
                for result in load_football_data(store, [season], missing):
                    loaded.append(f"{result.scope}: {result.row_count} rows")
    finally:
        store.close()
    return loaded


@dataclass(frozen=True)
class Job:
    database_url: str
    division: str
    window: tuple[date, date]
    history_from: date
    proposed: ModelVersion
    reference: ModelVersion


def _division_job(job: Job) -> DivisionResult | str:
    """One division against the store; an error is returned as text, not raised."""
    matches = load_matches(job.database_url, job.division, job.history_from, job.window[1])
    if not matches:
        return f"{job.division}: no matches in the training store for that range"
    own: OwnEloByDay | None = None
    if any(v.elo_prior != "clubelo" for v in (job.proposed, job.reference)):
        with psycopg.connect(job.database_url) as conn:
            everything = read_matches(conn, job.window[1])
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT division, team_id::text, training_name FROM training.team_alias"
                )
                aliases: dict[str, dict[str, str]] = {}
                for division, team_id, name in cur.fetchall():
                    aliases.setdefault(str(division), {})[str(team_id)] = str(name)
        own = OwnEloByDay(everything, aliases)

    def clubelo_on(day: date) -> dict[str, float] | None:
        with psycopg.connect(job.database_url) as conn:
            return last_cached_clubelo(conn, day) or None

    def own_on(day: date) -> dict[str, float] | None:
        return (own.on(day, job.division) or None) if own else None

    try:
        return run_division(
            job.division,
            matches,
            job.window,
            proposed=job.proposed,
            reference=job.reference,
            elo_for=lambda version: prior_for(version, clubelo_on, own_on),
        )
    except ValueError as error:  # no match in the window could be forecast
        return f"{job.division}: {error}"


def choose_reference(proposed: ModelVersion, against: str | None) -> ModelVersion | None:
    """``--against``: a candidate's name, ``published``, or by default the newest
    candidate in shadow other than the proposal, else the published version."""
    if against == "published":
        return BASELINE
    candidates = load_candidates()
    if against:
        return candidates.get(against)
    others = [c for c in candidates.values() if c.id != proposed.id]
    if not others:
        return BASELINE
    return max(others, key=lambda v: tuple(int(p) for p in v.version.split(".")))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="fmip_model.backtest.compare",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--candidate-file", type=Path, required=True)
    parser.add_argument("--against", help="a candidate's name, or 'published'")
    parser.add_argument("--divisions", nargs="+", default=list(FOOTBALL_DATA_DIVISIONS))
    parser.add_argument("--from", dest="window_from", type=date.fromisoformat,
                        default=DEFAULT_FROM)  # fmt: skip
    parser.add_argument("--to", dest="window_to", type=date.fromisoformat, default=DEFAULT_TO)
    parser.add_argument("--history-from", type=date.fromisoformat, default=DEFAULT_HISTORY_FROM)
    parser.add_argument("--fetch", action="store_true",
                        help="load the football-data seasons the store lacks first")  # fmt: skip
    parser.add_argument("--jobs", type=int, default=0, help="divisions run at once (0: per CPU)")
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--note", default="", help="where and on what data this was run")
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    try:
        proposed = load_candidate(args.candidate_file)
    except (KeyError, ValueError) as error:
        print(f"{args.candidate_file}: {error}", file=sys.stderr)
        return 2
    if proposed is None:
        print(f"{args.candidate_file}: no such file, or it changes nothing", file=sys.stderr)
        return 2
    if args.candidate_file.stem != f"{proposed.name}-{proposed.version}":
        print(f"{args.candidate_file.name} describes {proposed.id}; name it "
              f"{proposed.name}-{proposed.version}.json", file=sys.stderr)  # fmt: skip
        return 2
    reference = choose_reference(proposed, args.against)
    if reference is None:
        print(f"no candidate named {args.against}", file=sys.stderr)
        return 2
    window = (args.window_from, args.window_to)

    if args.fetch:
        for line in fetch_missing(database_url, args.divisions,
                                  seasons_between(args.history_from, args.window_to)):  # fmt: skip
            print(f"loaded {line}", flush=True)

    with psycopg.connect(database_url) as conn:
        groups = division_groups(conn, args.divisions)
    print(f"{proposed.id} against {reference.id}, {window[0]} to {window[1]}, "
          f"{len(args.divisions)} divisions", flush=True)  # fmt: skip
    jobs = [Job(database_url, d, window, args.history_from, proposed, reference)
            for d in args.divisions]  # fmt: skip
    workers = args.jobs or min(len(jobs), os.cpu_count() or 1)
    results: list[DivisionResult] = []
    with ProcessPoolExecutor(max_workers=max(1, workers)) as pool:
        for outcome in pool.map(_division_job, jobs):
            if isinstance(outcome, str):
                print(outcome, file=sys.stderr, flush=True)
                continue
            results.append(outcome)
            print(f"{outcome.division}: {len(outcome.rows)} matches", flush=True)
    if not any(r.rows for r in results):
        print("nothing was forecast; is the store loaded? (try --fetch)", file=sys.stderr)
        return 1
    body = report_body(proposed, reference, window, args.history_from, results, groups,
                       args.note)  # fmt: skip
    md = write(body, proposed, args.out)
    print(f"{proposed.id}: {body['verdict']} against {reference.id} -> {md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
