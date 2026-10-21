"""A candidate's new divisions, judged against uniform (T-1442, D-233).

    python -m fmip_model.backtest.new_divisions [--candidate <name>] [--divisions AT1 ...] \\
        [--from 2025-07-01] [--to 2026-10-20] [--history-from 2022-07-01] [--out reports]

A division the candidate forecasts and the published version does not has no
published record to beat, so the yardstick is the forecast that knows nothing:
uniform, one third each. Per division, the walk-forward of
``backtest.compare`` (fit the day before, refit at most weekly, 60 matches of
history first, the version's own history window and Elo prior) forecasts the
window once. Every match it forecast is scored -- the model, uniform, and the
closing odds (de-margined) on the matches that have them; our records'
divisions have none.

A division **passes** when the model's log loss is below uniform's and the 95%
paired bootstrap interval of the difference (D-139's, ``BAR``) lies wholly
below zero, on at least ``MIN_MATCHES`` matches; **fails** otherwise; and is
**insufficient** below ``MIN_MATCHES``. The report goes to
``reports/<name>-<version>/new_divisions_<from>..<to>.{md,json}``. It
publishes nothing: the candidate is in shadow once its file is merged, and is
promoted only on its own record before kick-off (D-082, D-140, D-191).

For code: ``judge_division`` (no database) is the verdict; ``main`` reads the
store with ``backtest.compare``'s job and writes the report.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import psycopg

from ..model.version import PUBLISHED, ModelVersion, load_candidate, load_candidates
from .compare import UNIFORM, DivisionResult, Job, Scores, _division_job, scores_of
from .inputs import BAR, Group, division_groups, paired_bootstrap

#: Matches below which a division gets no verdict. Smaller than D-139's 300,
#: which counts a whole group: one league's season is 180 to 540 matches, and
#: the interval, not the count, is the test.
MIN_MATCHES = 150
DEFAULT_FROM = date(2025, 7, 1)
DEFAULT_TO = date(2026, 10, 20)
DEFAULT_HISTORY_FROM = date(2022, 7, 1)


@dataclass(frozen=True)
class DivisionVerdict:
    division: str
    group: Group
    matches: int
    refits: int
    fits_with_prior: int
    model: Scores
    uniform: Scores
    #: The model's log loss minus uniform's: the point and the 95% interval.
    difference: float
    interval: tuple[float, float]
    #: The model and the closing odds on the matches that have them; ``None`` without odds.
    with_odds: tuple[Scores, Scores] | None
    verdict: str


def new_divisions(candidate: ModelVersion, published: ModelVersion = PUBLISHED) -> list[str]:
    """The divisions ``candidate`` forecasts that ``published`` does not."""
    if candidate.divisions is None:
        return []
    return sorted(d for d in candidate.divisions if not published.forecasts(d))


def judge_division(
    result: DivisionResult, group: Group, *, min_matches: int = MIN_MATCHES
) -> DivisionVerdict:
    """The candidate (the run's ``proposed``) against uniform on every match it forecast."""
    rows = result.rows
    if not rows:
        raise ValueError(f"{result.division}: nothing was forecast")
    model = scores_of(rows, "proposed")
    uniform = scores_of(rows, "uniform")
    boot = paired_bootstrap(
        [UNIFORM] * len(rows), [r.proposed for r in rows], [r.match.result for r in rows], BAR
    )
    priced = [r for r in rows if r.market is not None]
    with_odds = (scores_of(priced, "proposed"), scores_of(priced, "market")) if priced else None
    difference = round(model.log_loss - uniform.log_loss, 5)
    if len(rows) < min_matches:
        verdict = "insufficient"
    elif boot.log_loss[1] < 0:
        verdict = "passed"
    else:
        verdict = "failed"
    return DivisionVerdict(
        division=result.division,
        group=group,
        matches=len(rows),
        refits=result.refits,
        fits_with_prior=result.fits_with_prior.get("proposed", 0),
        model=model,
        uniform=uniform,
        difference=difference,
        interval=boot.log_loss,
        with_odds=with_odds,
        verdict=verdict,
    )


def report_body(
    candidate: ModelVersion,
    window: tuple[date, date],
    history_from: date,
    verdicts: Sequence[DivisionVerdict],
    note: str = "",
    generated_at: datetime | None = None,
) -> dict[str, object]:
    return {
        "task": "T-1442",
        "decision": "D-233",
        "candidate": candidate.as_dict(),
        "published": PUBLISHED.id,
        "window": [window[0].isoformat(), window[1].isoformat()],
        "history_from": history_from.isoformat(),
        "min_matches": MIN_MATCHES,
        "bootstrap": {"resamples": BAR.resamples, "level": BAR.level, "seed": BAR.seed},
        "note": note,
        "generated_at": (generated_at or datetime.now(UTC)).isoformat(timespec="seconds"),
        "divisions": [asdict(v) for v in verdicts],
        "passed": sorted(v.division for v in verdicts if v.verdict == "passed"),
    }


def render(body: Mapping[str, object]) -> str:
    candidate = body["candidate"]
    assert isinstance(candidate, dict)
    window = body["window"]
    assert isinstance(window, list)
    rows = body["divisions"]
    assert isinstance(rows, list)
    lines = [
        f"# {candidate['id']}: the new divisions against uniform",
        "",
        f"T-1442, D-233. Window {window[0]} to {window[1]}, history from "
        f"{body['history_from']}; the published version is {body['published']}, which does "
        "not forecast these divisions. Generated by `python -m fmip_model.backtest.new_divisions`"
        f" at {body['generated_at']}.",
        "",
    ]
    if body.get("note"):
        lines += [f"Data: {body['note']}", ""]
    lines += [
        f"A division passes when the model's log loss is below uniform's (one third each) with "
        f"the {BAR.level:.0%} paired bootstrap interval of the difference ({BAR.resamples} "
        f"resamples) wholly below zero, on at least {body['min_matches']} matches. The closing "
        "odds are a benchmark only, on the matches that have them; they are never shown.",
        "",
        "| Division | Source | Matches | Log loss | Uniform | Difference (95% interval) "
        "| Brier | Accuracy | Calibration | Model / market on priced matches | Verdict |",
        "|---|---|---:|---:|---:|---|---:|---:|---:|---|---|",
    ]
    for v in rows:
        assert isinstance(v, dict)
        model, uniform = v["model"], v["uniform"]
        lo, hi = v["interval"]
        odds = v["with_odds"]
        priced = (
            "--"
            if odds is None
            else f"{odds[0]['log_loss']:.4f} / {odds[1]['log_loss']:.4f} ({odds[0]['n']})"
        )
        source = "football-data" if v["group"] == "football_data" else "our records"
        lines.append(
            f"| {v['division']} | {source} | {v['matches']} | {model['log_loss']:.4f} "
            f"| {uniform['log_loss']:.4f} | {v['difference']:+.4f} ({lo:+.4f} to {hi:+.4f}) "
            f"| {model['brier']:.4f} | {model['accuracy']:.3f} | {model['calibration_error']:.4f} "
            f"| {priced} | {v['verdict']} |"
        )
    passed = body["passed"]
    assert isinstance(passed, list)
    lines += [
        "",
        f"Passed: {', '.join(passed) if passed else 'none'}. A division that did not pass "
        "should leave the candidate's `divisions` before it is merged.",
        "",
    ]
    return "\n".join(lines)


def write(body: Mapping[str, object], candidate: ModelVersion, out: Path) -> Path:
    window = body["window"]
    assert isinstance(window, list)
    directory = out / f"{candidate.name}-{candidate.version}"
    directory.mkdir(parents=True, exist_ok=True)
    stem = f"new_divisions_{window[0]}..{window[1]}"
    (directory / f"{stem}.json").write_text(
        json.dumps(body, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    md = directory / f"{stem}.md"
    md.write_text(render(body), encoding="utf-8")
    return md


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="fmip_model.backtest.new_divisions",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--candidate", help="a candidate's name; default: the newest in shadow")
    parser.add_argument("--divisions", nargs="+", help="default: those the published lacks")
    parser.add_argument("--from", dest="window_from", type=date.fromisoformat,
                        default=DEFAULT_FROM)  # fmt: skip
    parser.add_argument("--to", dest="window_to", type=date.fromisoformat, default=DEFAULT_TO)
    parser.add_argument("--history-from", type=date.fromisoformat, default=DEFAULT_HISTORY_FROM)
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--note", default="", help="where and on what data this was run")
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    candidate = load_candidates().get(args.candidate) if args.candidate else load_candidate()
    if candidate is None:
        print("no such candidate in fmip_model/model/candidates/", file=sys.stderr)
        return 2
    divisions = args.divisions or new_divisions(candidate)
    if not divisions:
        print(f"{candidate.id} forecasts no division {PUBLISHED.id} does not", file=sys.stderr)
        return 2
    window = (args.window_from, args.window_to)
    with psycopg.connect(database_url) as conn:
        groups = division_groups(conn, divisions)
    verdicts: list[DivisionVerdict] = []
    for division in divisions:
        job = Job(database_url, division, window, args.history_from, candidate, candidate,
                  require_odds=False)  # fmt: skip
        outcome = _division_job(job)
        if isinstance(outcome, str):
            print(outcome, file=sys.stderr, flush=True)
            continue
        group: Group = groups.get(division, "football_data")
        verdicts.append(judge_division(outcome, group))
        print(f"{division}: {verdicts[-1].matches} matches, {verdicts[-1].verdict}", flush=True)
    if not verdicts:
        print("nothing was forecast; are the divisions loaded?", file=sys.stderr)
        return 1
    body = report_body(candidate, window, args.history_from, verdicts, args.note)
    md = write(body, candidate, args.out)
    print(f"{candidate.id}: passed {body['passed']} -> {md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
