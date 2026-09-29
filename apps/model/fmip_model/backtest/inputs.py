"""One harness for an input's backtest (T-1101, D-139).

    python -m fmip_model.backtest.inputs --input null --divisions E0 SP1 IR1 \\
        --from 2025-08-01 --to 2026-06-30 [--history-from 2023-07-01] [--note ...]

Per division, one walk-forward with the fit dates of ``backtest.elo_prior``
(fit the day before, refit at most weekly, 60 matches of history first)
scores three forecasters on the same matches:

- ``published``: the published version (``BASELINE``) with its Club Elo prior
  (the newest rating cached on or before each fit date);
- ``candidate``: the current candidate with its own constants and prior;
- ``with_input``: the candidate's very fits, with the input's term fitted on
  the same history and applied to the match.

The input is judged against the candidate by D-139's bar (``BAR``), on the
matches where it can be read, separately for football-data.co.uk divisions
and our records' divisions. The report goes to
``reports/<candidate>/inputs_<name>_<from>..<to>.{md,json}``. Nothing is
published or promoted here; a verdict is evidence for a decision entry.

For code: ``run_division`` (no database) and ``judge`` are the whole harness;
``main`` only reads the store and writes the report.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

import numpy as np
import psycopg
from numpy.typing import NDArray

from ..inputs import InputContext, ModelInput, Term, available, before, load
from ..model.dixon_coles import FittedModel, MatchObservation
from ..model.poisson import outcome_from_matrix, score_matrix
from ..model.version import BASELINE, ModelVersion, load_candidate, load_candidates
from ..training.own_elo import read_matches
from .__main__ import load_matches
from .elo_prior import OwnEloByDay, last_cached_clubelo
from .metrics import Forecast
from .walk_forward import BacktestMatch, default_fitter, scorecard, walk_forward

Group = Literal["football_data", "our_records"]
GROUPS: tuple[Group, ...] = ("football_data", "our_records")
Verdict = Literal["passed", "failed", "insufficient", "not run"]
EloOn = Callable[[date], Mapping[str, float] | None]


@dataclass(frozen=True)
class Bar:
    """D-139: what an input must show against the current candidate, per group."""

    #: Matches the input could be read on, in the group, below which there is no verdict.
    min_applied: int = 300
    #: The paired bootstrap of the mean log-loss difference (input minus candidate).
    resamples: int = 2000
    level: float = 0.95
    seed: int = 1101
    #: Calibration error (mean over H/D/A of the ten-bin expected calibration
    #: error) is not worse unless the same paired bootstrap puts the whole
    #: interval of its rise above zero: a few hundred matches make it too
    #: noisy to ask for a point estimate that did not move.
    #: Divisions with at least this many applied matches are judged one by one...
    min_division_applied: int = 50
    #: ...and the input may be worse (higher log loss) in at most this share of them.
    max_worse_share: float = 1 / 3


BAR = Bar()


@dataclass(frozen=True)
class MatchScore:
    match: BacktestMatch
    fit_date: date
    published: Forecast
    candidate: Forecast
    with_input: Forecast
    applied: bool


@dataclass(frozen=True)
class DivisionRun:
    division: str
    group: Group
    scores: list[MatchScore]
    refits: int
    published_prior_fits: int
    candidate_prior_fits: int


def _counting(elo_on: EloOn | None) -> tuple[EloOn | None, list[int]]:
    hits = [0]
    if elo_on is None:
        return None, hits

    def counted(day: date) -> Mapping[str, float] | None:
        ratings = elo_on(day)
        if ratings:
            hits[0] += 1
            return ratings
        return None

    return counted, hits


def _match_key(m: MatchObservation) -> tuple[date, str, str]:
    return (m.date, m.home, m.away)


def _shifted(model: FittedModel, match: BacktestMatch, shift: tuple[float, float]) -> Forecast:
    lam, mu = model.expected_goals(match.home, match.away)
    outcome = outcome_from_matrix(
        score_matrix(lam * float(np.exp(shift[0])), mu * float(np.exp(shift[1])), model.rho)
    )
    return Forecast(outcome.home_win, outcome.draw, outcome.away_win)


def run_division(
    division: str,
    group: Group,
    matches: Sequence[BacktestMatch],
    window: tuple[date, date],
    *,
    candidate: ModelVersion,
    model_input: ModelInput,
    published: ModelVersion = BASELINE,
    published_elo: EloOn | None = None,
    candidate_elo: EloOn | None = None,
    min_history: int = 60,
    refit_every_days: int = 7,
) -> DivisionRun:
    """Score the three forecasters on the matches of ``window`` all of them forecast.

    The input sees, at each refit, only the matches on or before its fit date,
    and for each match only the division's matches strictly before its day.
    """
    ordered = sorted(matches, key=lambda m: m.date)

    def at(version: ModelVersion) -> ModelVersion:
        xi, ridge = version.constants_for(division)
        return replace(version, xi=xi, ridge=ridge, per_division={})

    pub_elo, pub_hits = _counting(published_elo)
    pub = walk_forward(
        ordered,
        window_start=window[0],
        window_end=window[1],
        scope=f"{division} published",
        min_history=min_history,
        refit_every_days=refit_every_days,
        version=at(published),
        elo_on=pub_elo,
    )

    fits: dict[date, FittedModel] = {}
    base = default_fitter(at(candidate))

    def keeping(
        history: Sequence[MatchObservation], fit_date: date, elo: Mapping[str, float] | None
    ) -> FittedModel:
        fits[fit_date] = base(history, fit_date, elo)
        return fits[fit_date]

    cand_elo, cand_hits = _counting(candidate_elo)
    cand = walk_forward(
        ordered,
        window_start=window[0],
        window_end=window[1],
        scope=f"{division} candidate",
        min_history=min_history,
        refit_every_days=refit_every_days,
        version=at(candidate),
        elo_on=cand_elo,
        fitter=keeping,
    )

    published_by = {_match_key(f.match): f.model for f in pub.forecasts}
    terms: dict[date, Term] = {}
    scores: list[MatchScore] = []
    for forecast in cand.forecasts:
        match = forecast.match
        if _match_key(match) not in published_by:
            continue
        model = fits[forecast.fit_date]
        if forecast.fit_date not in terms:
            history = before(ordered, forecast.fit_date + timedelta(days=1))
            terms[forecast.fit_date] = model_input.fit(division, history, forecast.fit_date, model)
        shift = terms[forecast.fit_date].shift(match, before(ordered, match.date))
        scores.append(
            MatchScore(
                match=match,
                fit_date=forecast.fit_date,
                published=published_by[_match_key(match)],
                candidate=forecast.model,
                with_input=forecast.model if shift is None else _shifted(model, match, shift),
                applied=shift is not None,
            )
        )
    return DivisionRun(division, group, scores, cand.refits, pub_hits[0], cand_hits[0])


@dataclass(frozen=True)
class Scores:
    log_loss: float
    brier: float
    calibration_error: float


def _scores(forecasts: Sequence[Forecast], matches: Sequence[BacktestMatch]) -> Scores:
    card = scorecard(forecasts, [m.result for m in matches])
    return Scores(round(card.log_loss, 5), round(card.brier, 5), round(card.calibration_error, 5))


@dataclass(frozen=True)
class DivisionSummary:
    division: str
    scored: int
    applied: int
    log_loss_candidate: float | None
    log_loss_with_input: float | None
    judged: bool
    worse: bool


@dataclass(frozen=True)
class GroupVerdict:
    group: Group
    verdict: Verdict
    reasons: list[str]
    scored: int
    applied: int
    published: Scores | None = None
    candidate: Scores | None = None
    with_input: Scores | None = None
    #: Mean log loss with the input minus the candidate's, on the applied matches.
    difference: float | None = None
    interval: tuple[float, float] | None = None
    #: The same resamples' interval for the rise in calibration error.
    calibration_interval: tuple[float, float] | None = None
    divisions: list[DivisionSummary] = field(default_factory=list)

    @property
    def share_applied(self) -> float:
        return 0.0 if self.scored == 0 else self.applied / self.scored


@dataclass(frozen=True)
class Bootstrap:
    """Percentile intervals over the same resamples of the applied matches."""

    log_loss: tuple[float, float]
    calibration_error: tuple[float, float]


def _probs(forecasts: Sequence[Forecast]) -> NDArray[np.float64]:
    return np.array([f.as_tuple() for f in forecasts], dtype=np.float64)


def _calibration(
    weights: NDArray[np.float64], probs: NDArray[np.float64], hits: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Ten-bin expected calibration error, mean over H/D/A, per row of ``weights``.

    A bin's contribution is |sum of p - sum of hits| over the matches in it,
    so each resample is one matrix product.
    """
    n = probs.shape[0]
    total = np.zeros(weights.shape[0])
    for k in range(3):
        bins = np.minimum((probs[:, k] * 10).astype(np.int64), 9)
        onehot = np.zeros((n, 10))
        onehot[np.arange(n), bins] = probs[:, k] - hits[:, k]
        total += np.abs(weights @ onehot).sum(axis=1) / weights.sum(axis=1)
    return total / 3


def paired_bootstrap(
    candidate: Sequence[Forecast],
    with_input: Sequence[Forecast],
    results: Sequence[str],
    bar: Bar = BAR,
) -> Bootstrap:
    """Resample the matches with replacement ``bar.resamples`` times (fixed seed),
    and take the input-minus-candidate difference of mean log loss and of
    calibration error on each resample."""
    n = len(results)
    pc, pi = _probs(candidate), _probs(with_input)
    hits = np.array([[r == o for o in "HDA"] for r in results], dtype=np.float64)
    ll_diff = -np.log(np.maximum((pi * hits).sum(1), 1e-12)) + np.log(
        np.maximum((pc * hits).sum(1), 1e-12)
    )
    rng = np.random.default_rng(bar.seed)
    lls = np.empty(bar.resamples)
    cals = np.empty(bar.resamples)
    chunk = max(1, 4_000_000 // max(1, n))
    for start in range(0, bar.resamples, chunk):
        stop = min(bar.resamples, start + chunk)
        weights = rng.multinomial(n, np.full(n, 1 / n), size=stop - start).astype(np.float64)
        lls[start:stop] = weights @ ll_diff / n
        cals[start:stop] = _calibration(weights, pi, hits) - _calibration(weights, pc, hits)
    tail = (1 - bar.level) / 2 * 100

    def interval(values: NDArray[np.float64]) -> tuple[float, float]:
        lo, hi = np.percentile(values, [tail, 100 - tail])
        return round(float(lo), 6), round(float(hi), 6)

    return Bootstrap(interval(lls), interval(cals))


def _log_losses(
    forecasts: Sequence[Forecast], matches: Sequence[BacktestMatch]
) -> NDArray[np.float64]:
    return -np.log(np.maximum([f.of(m.result) for f, m in zip(forecasts, matches, strict=True)],
                              1e-12))  # fmt: skip


def judge_group(group: Group, runs: Sequence[DivisionRun], bar: Bar = BAR) -> GroupVerdict:
    scored = [s for r in runs for s in r.scores]
    applied = [s for s in scored if s.applied]
    if not runs:
        return GroupVerdict(group, "not run", ["no division of this group was run"], 0, 0)
    divisions: list[DivisionSummary] = []
    for run in runs:
        mine = [s for s in run.scores if s.applied]
        ms = [s.match for s in mine]
        judged = len(mine) >= bar.min_division_applied
        ll_c = float(_log_losses([s.candidate for s in mine], ms).mean()) if mine else None
        ll_i = float(_log_losses([s.with_input for s in mine], ms).mean()) if mine else None
        divisions.append(
            DivisionSummary(
                run.division,
                len(run.scores),
                len(mine),
                None if ll_c is None else round(ll_c, 5),
                None if ll_i is None else round(ll_i, 5),
                judged,
                judged and ll_c is not None and ll_i is not None and ll_i > ll_c,
            )
        )
    if len(applied) < bar.min_applied:
        return GroupVerdict(
            group,
            "insufficient",
            [
                f"{len(applied)} matches where the input could be read; the bar needs "
                f"{bar.min_applied}"
            ],  # fmt: skip
            len(scored),
            len(applied),
            divisions=divisions,
        )
    ms = [s.match for s in applied]
    cand_ll = _log_losses([s.candidate for s in applied], ms)
    inp_ll = _log_losses([s.with_input for s in applied], ms)
    diff = inp_ll - cand_ll
    boot = paired_bootstrap(
        [s.candidate for s in applied], [s.with_input for s in applied], [m.result for m in ms], bar
    )
    interval = boot.log_loss
    published = _scores([s.published for s in applied], ms)
    candidate = _scores([s.candidate for s in applied], ms)
    with_input = _scores([s.with_input for s in applied], ms)
    reasons: list[str] = []
    if not (diff.mean() < 0 and interval[1] < 0):
        reasons.append(
            f"log loss difference {diff.mean():+.5f}, {bar.level:.0%} interval "
            f"[{interval[0]:+.5f}, {interval[1]:+.5f}] does not exclude zero on the better side"
        )
    if boot.calibration_error[0] > 0:
        reasons.append(
            f"calibration error {with_input.calibration_error:.5f} against "
            f"{candidate.calibration_error:.5f}, worse across the whole interval "
            f"[{boot.calibration_error[0]:+.5f}, {boot.calibration_error[1]:+.5f}]"
        )
    counted = [d for d in divisions if d.judged]
    worse = [d for d in counted if d.worse]
    if counted and len(worse) / len(counted) > bar.max_worse_share:
        reasons.append(
            f"worse in {len(worse)} of {len(counted)} divisions judged "
            f"({', '.join(d.division for d in worse)}), more than {bar.max_worse_share:.0%}"
        )
    return GroupVerdict(
        group,
        "failed" if reasons else "passed",
        reasons,
        len(scored),
        len(applied),
        published,
        candidate,
        with_input,
        round(float(diff.mean()), 6),
        interval,
        boot.calibration_error,
        divisions,
    )


def judge(runs: Sequence[DivisionRun], bar: Bar = BAR) -> tuple[Verdict, list[GroupVerdict]]:
    """Per group, then overall: passed when one group passed and none failed."""
    groups = [judge_group(g, [r for r in runs if r.group == g], bar) for g in GROUPS]
    verdicts = {g.verdict for g in groups}
    if "failed" in verdicts:
        overall: Verdict = "failed"
    elif "passed" in verdicts:
        overall = "passed"
    elif "insufficient" in verdicts:
        overall = "insufficient"
    else:
        overall = "not run"
    return overall, groups


# --- the store and the report ---------------------------------------------------


def division_groups(conn: psycopg.Connection[tuple[object, ...]], divisions: Sequence[str]
                    ) -> dict[str, Group]:  # fmt: skip
    """Each division's group, by the source of its loads: our records, else football-data."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT m.division, l.source
              FROM training.match m JOIN training.source_load l ON l.id = m.source_load_id
             WHERE m.division = ANY(%s)
            """,
            (list(divisions),),
        )
        rows = cur.fetchall()
    out: dict[str, Group] = {}
    for division, source in rows:
        if str(source) == "our_records":
            out[str(division)] = "our_records"
        else:
            out.setdefault(str(division), "football_data")
    return out


def report_body(
    name: str,
    description: str,
    candidate: ModelVersion,
    window: tuple[date, date],
    overall: Verdict,
    groups: Sequence[GroupVerdict],
    runs: Sequence[DivisionRun],
    note: str,
    bar: Bar = BAR,
) -> dict[str, object]:
    return {
        "input": name,
        "description": description,
        "published": BASELINE.id,
        "candidate": candidate.id,
        "window": [window[0].isoformat(), window[1].isoformat()],
        "note": note,
        "bar": asdict(bar),
        "verdict": overall,
        "groups": [{**asdict(g), "share_applied": round(g.share_applied, 4)} for g in groups],
        "fits_with_prior": {
            r.division: {
                "refits": r.refits,
                "published": r.published_prior_fits,
                "candidate": r.candidate_prior_fits,
            }  # fmt: skip
            for r in runs
        },
    }


def render(body: Mapping[str, object]) -> str:
    groups = body["groups"]
    priors = body["fits_with_prior"]
    assert isinstance(groups, list) and isinstance(priors, dict)
    prior_cells = "; ".join(
        f"{d} {p['published']} and {p['candidate']} of {p['refits']}" for d, p in priors.items()
    )
    lines = [
        f"# Input `{body['input']}` against {body['candidate']}, "
        f"{body['window'][0]} to {body['window'][1]}",  # type: ignore[index]
        "",
        str(body["description"]),
        "",
        str(body["note"]),
        "",
        f"**Verdict: {body['verdict']}** (D-139). Published version for reference: "
        f"{body['published']}.",
        "",
        "Fits with an Elo prior, published and candidate (a published version with none "
        f"had no Club Elo rating cached): {prior_cells}.",
        "",
        "Scored on the matches where the input could be read; lower is better.",
        "",
        "| Group | Verdict | Scored | Applied | Log loss published | candidate | with input "
        "| Difference [interval] | Brier candidate / with input | Calibration candidate / "
        "with input |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for g in groups:
        if g["published"] is None:
            lines.append(
                f"| {g['group']} | {g['verdict']} | {g['scored']} | {g['applied']} | | | | | | |"
            )
            continue
        lo, hi = g["interval"]
        lines.append(
            f"| {g['group']} | {g['verdict']} | {g['scored']} | {g['applied']} "
            f"({g['share_applied']:.0%}) | {g['published']['log_loss']:.4f} "
            f"| {g['candidate']['log_loss']:.4f} | {g['with_input']['log_loss']:.4f} "
            f"| {g['difference']:+.5f} [{lo:+.5f}, {hi:+.5f}] "
            f"| {g['candidate']['brier']:.4f} / {g['with_input']['brier']:.4f} "
            f"| {g['candidate']['calibration_error']:.4f} / "
            f"{g['with_input']['calibration_error']:.4f} |"
        )
    for g in groups:
        for reason in g["reasons"]:
            lines.append(f"\n- {g['group']}: {reason}")
    lines += [
        "",
        "| Division | Group | Scored | Applied | Log loss candidate | with input "
        "| Judged | Worse |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for g in groups:
        for d in g["divisions"]:
            cells = [
                "" if d[k] is None else f"{d[k]:.4f}"
                for k in ("log_loss_candidate", "log_loss_with_input")
            ]
            lines.append(
                f"| {d['division']} | {g['group']} | {d['scored']} | {d['applied']} "
                f"| {cells[0]} | {cells[1]} | {'yes' if d['judged'] else 'no'} "
                f"| {'yes' if d['worse'] else 'no'} |"
            )
    return "\n".join(lines) + "\n"


def write(body: Mapping[str, object], candidate: ModelVersion, out: Path) -> Path:
    folder = out / f"{candidate.name}-{candidate.version}"
    folder.mkdir(parents=True, exist_ok=True)
    window = body["window"]
    assert isinstance(window, list)
    stem = f"inputs_{body['input']}_{window[0]}..{window[1]}"
    (folder / f"{stem}.json").write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    md = folder / f"{stem}.md"
    md.write_text(render(body), encoding="utf-8")
    return md


def prior_for(version: ModelVersion, clubelo: EloOn, own: EloOn) -> EloOn:
    if version.elo_prior == "own":
        return own
    if version.elo_prior == "clubelo":
        return clubelo
    return lambda day: clubelo(day) or own(day)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fmip_model.backtest.inputs", description=__doc__)
    parser.add_argument("--input", required=True, help=f"one of: {', '.join(available())}")
    parser.add_argument("--divisions", nargs="+", required=True)
    parser.add_argument("--from", dest="window_from", type=date.fromisoformat, required=True)
    parser.add_argument("--to", dest="window_to", type=date.fromisoformat, required=True)
    parser.add_argument("--history-from", type=date.fromisoformat,
                        help="default: two years before --from")  # fmt: skip
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--note", default="", help="where and on what data this was run")
    parser.add_argument(
        "--candidate", help="a candidate's name (T-1102); default: the newest version in shadow"
    )
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    candidate = load_candidates().get(args.candidate) if args.candidate else load_candidate()
    if candidate is None:
        print(f"no candidate {args.candidate} to add an input to", file=sys.stderr)
        return 2
    window = (args.window_from, args.window_to)
    history_from = args.history_from or args.window_from - timedelta(days=730)
    try:
        model_input = load(
            args.input, InputContext(database_url, tuple(args.divisions), args.window_to)
        )
    except LookupError as error:
        print(str(error), file=sys.stderr)
        return 2

    with psycopg.connect(database_url) as conn:
        groups = division_groups(conn, args.divisions)
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

    runs: list[DivisionRun] = []
    for division in args.divisions:
        matches = load_matches(database_url, division, history_from, args.window_to)
        if not matches or division not in groups:
            print(f"{division}: no matches in the training store", file=sys.stderr)
            continue

        def own_on(day: date, division: str = division) -> dict[str, float] | None:
            return own.on(day, division) or None

        try:
            run = run_division(
                division,
                groups[division],
                matches,
                window,
                candidate=candidate,
                model_input=model_input,
                published_elo=prior_for(BASELINE, clubelo_on, own_on),
                candidate_elo=prior_for(candidate, clubelo_on, own_on),
            )
        except ValueError as error:  # no match in the window could be forecast
            print(f"{division}: {error}", file=sys.stderr)
            continue
        runs.append(run)
        applied = sum(1 for s in run.scores if s.applied)
        print(f"{division} ({run.group}): {len(run.scores)} scored, {applied} applied", flush=True)
    if not runs:
        return 1
    overall, verdicts = judge(runs)
    body = report_body(
        model_input.name, model_input.description, candidate, window, overall, verdicts, runs,
        args.note,
    )  # fmt: skip
    md = write(body, candidate, args.out)
    print(f"{args.input}: {overall} -> {md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
