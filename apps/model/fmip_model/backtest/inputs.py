"""One harness for an input's backtest (T-1101, D-139).

    python -m fmip_model.backtest.inputs --input null --divisions E0 SP1 IR1 \\
        --from 2025-08-01 --to 2026-06-30 [--history-from 2023-07-01] [--note ...]

Per division, one walk-forward with the fit dates of ``backtest.elo_prior``
(fit the day before, refit at most weekly, 60 matches of history first)
scores three forecasters on the same matches:

- ``published``: the published version (``PUBLISHED``, D-191) with its own
  prior;
- ``candidate``: the current candidate (else the published version) with its
  own constants and prior;
- ``with_input``: the candidate's very fits, with the input's term fitted on
  the same history and applied to the match.

The input is judged against the candidate by D-139's bar (``BAR``), on the
matches where it can be read, separately for football-data.co.uk divisions
and our records' divisions. The report goes to
``reports/<candidate>/inputs_<name>_<from>..<to>.{md,json}``. Nothing is
published or promoted here; a verdict is evidence for a decision entry.

A recalibration of the three probabilities (``CalibrationInput``, T-1657,
D-308) is judged the same way. ``with_input`` is then the candidate's own
forecast passed through the calibration fitted at that refit, on the
candidate's out-of-sample forecasts of the division's matches up to the fit
date: those of the window already played, and those of a second walk-forward
of the candidate, the same in every respect, over ``--calibration-from`` to the
day before the window (default: a year after ``--history-from``). Its report
adds the draw's reliability, said against seen by bands of the gap
``|p_home - p_away|``, and each division's last fitted parameters. A term
input's run and report are what they were before T-1657.

For code: ``run_division`` (no database) and ``judge`` are the whole harness;
``main`` only reads the store and writes the report.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from bisect import bisect_right
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

import numpy as np
import psycopg
from numpy.typing import NDArray

from ..inputs import (
    Calibration,
    CalibrationInput,
    InputContext,
    ModelInput,
    PastForecast,
    Term,
    available,
    before,
    load,
)
from ..model.dixon_coles import FittedModel, MatchObservation
from ..model.poisson import outcome_from_matrix, score_matrix
from ..model.version import PUBLISHED, ModelVersion, load_candidate, load_candidates
from ..training.own_elo import read_matches
from .__main__ import load_matches
from .elo_prior import OwnEloByDay, last_cached_clubelo
from .metrics import Forecast
from .walk_forward import (
    BacktestMatch,
    BacktestResult,
    ScoredForecast,
    default_fitter,
    scorecard,
    walk_forward,
)

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
class CalibrationRecord:
    """What a recalibration (T-1657) was fitted on in one division."""

    #: The first day of the walk-forward before the window; ``None``: the window's own only.
    history_from: date | None
    #: Out-of-sample forecasts of matches before the window.
    before_window: int
    #: Refits of the window that had a calibration, of all of them.
    calibrated_refits: int
    refits: int
    #: The parameters of the window's last calibration ({} when there was none).
    last: Mapping[str, float]


@dataclass(frozen=True)
class DivisionRun:
    division: str
    group: Group
    scores: list[MatchScore]
    refits: int
    published_prior_fits: int
    candidate_prior_fits: int
    #: Set for a recalibration only (T-1657).
    calibration: CalibrationRecord | None = None


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
    model_input: ModelInput | CalibrationInput,
    published: ModelVersion = PUBLISHED,
    published_elo: EloOn | None = None,
    candidate_elo: EloOn | None = None,
    min_history: int = 60,
    refit_every_days: int = 7,
    calibration_from: date | None = None,
) -> DivisionRun:
    """Score the three forecasters on the matches of ``window`` all of them forecast.

    The input sees, at each refit, only the matches on or before its fit date,
    and for each match only the division's matches strictly before its day.
    ``calibration_from`` is read by a recalibration only (``_calibrated``).
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
    if isinstance(model_input, CalibrationInput):
        return _calibrated(
            division,
            group,
            ordered,
            window,
            cand,
            published_by,
            model_input,
            version=at(candidate),
            candidate_elo=candidate_elo,
            calibration_from=calibration_from,
            min_history=min_history,
            refit_every_days=refit_every_days,
            prior_fits=(pub_hits[0], cand_hits[0]),
        )
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


def _past(forecasts: Sequence[ScoredForecast]) -> list[PastForecast]:
    return [PastForecast(f.match, f.fit_date, f.model.as_tuple()) for f in forecasts]


def _calibrated(
    division: str,
    group: Group,
    ordered: Sequence[BacktestMatch],
    window: tuple[date, date],
    cand: BacktestResult,
    published_by: Mapping[tuple[date, str, str], Forecast],
    model_input: CalibrationInput,
    *,
    version: ModelVersion,
    candidate_elo: EloOn | None,
    calibration_from: date | None,
    min_history: int,
    refit_every_days: int,
    prior_fits: tuple[int, int],
) -> DivisionRun:
    """The candidate's forecasts through the calibration fitted at each refit (T-1657).

    A refit's calibration reads the candidate's out-of-sample forecasts of the
    division's matches on or before its fit date: the window's already played,
    and those of a second walk-forward with the candidate's constants and
    prior over ``calibration_from`` to the day before the window. The window's
    own walk-forward is the one every input is judged on, untouched.
    """
    earlier: list[PastForecast] = []
    history_from = (
        calibration_from if calibration_from is not None and calibration_from < window[0] else None
    )
    if history_from is not None:
        try:
            pre = walk_forward(
                ordered,
                window_start=history_from,
                window_end=window[0] - timedelta(days=1),
                scope=f"{division} calibration history",
                min_history=min_history,
                refit_every_days=refit_every_days,
                version=version,
                elo_on=candidate_elo,
            )
            earlier = _past(pre.forecasts)
        except ValueError:  # no match before the window could be forecast
            earlier = []
    # Oldest first: every earlier forecast is of a match before the window.
    history = earlier + _past(cand.forecasts)
    days = [h.match.date for h in history]
    calibrations: dict[date, Calibration | None] = {}
    scores: list[MatchScore] = []
    for forecast in cand.forecasts:
        match = forecast.match
        if _match_key(match) not in published_by:
            continue
        fit_date = forecast.fit_date
        if fit_date not in calibrations:
            seen = history[: bisect_right(days, fit_date)]
            calibrations[fit_date] = model_input.calibrate(division, seen, fit_date)
        calibration = calibrations[fit_date]
        scores.append(
            MatchScore(
                match=match,
                fit_date=fit_date,
                published=published_by[_match_key(match)],
                candidate=forecast.model,
                with_input=(
                    forecast.model
                    if calibration is None
                    else Forecast(*calibration.apply(forecast.model.as_tuple()))
                ),
                applied=calibration is not None,
            )
        )
    fitted = [calibrations[d] for d in sorted(calibrations) if calibrations[d] is not None]
    last = fitted[-1] if fitted else None
    record = CalibrationRecord(
        history_from,
        len(earlier),
        len(fitted),
        len(calibrations),
        {} if last is None else dict(last.parameters),
    )
    return DivisionRun(division, group, scores, cand.refits, *prior_fits, record)


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


#: The gaps ``|p_home - p_away|`` between the draw's reliability bands: the
#: live record's, where the over-forecast draw was seen (T-1657).
DRAW_BANDS: tuple[float, ...] = (0.10, 0.25, 0.45)
FORECASTERS = ("published", "candidate", "with_input")


@dataclass(frozen=True)
class DrawBand:
    """The draw said against seen on the matches whose candidate's gap is in [lower, upper)."""

    lower: float
    upper: float | None
    matches: int
    said_published: float | None = None
    said_candidate: float | None = None
    said_with_input: float | None = None
    seen: float | None = None
    #: The seen rate's 95% Wilson interval.
    seen_interval: tuple[float, float] | None = None


def wilson(hits: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    """The Wilson score interval of a rate (95% by default)."""
    rate = hits / n
    centre = (rate + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(rate * (1 - rate) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return round(centre - half, 4), round(centre + half, 4)


def _gap(f: Forecast) -> float:
    return abs(f.home - f.away)


def draw_reliability(
    scores: Sequence[MatchScore], bands: Sequence[float] = DRAW_BANDS
) -> list[DrawBand]:
    """The draw's reliability by bands of the candidate's gap, on ``scores``."""
    edges = [0.0, *bands]
    out: list[DrawBand] = []
    for i, lower in enumerate(edges):
        upper = edges[i + 1] if i + 1 < len(edges) else None
        mine = [
            s for s in scores
            if _gap(s.candidate) >= lower and (upper is None or _gap(s.candidate) < upper)
        ]  # fmt: skip
        if not mine:
            out.append(DrawBand(lower, upper, 0))
            continue
        draws = sum(1 for s in mine if s.match.result == "D")
        said = {
            k: round(float(np.mean([getattr(s, k).draw for s in mine])), 4) for k in FORECASTERS
        }
        out.append(
            DrawBand(
                lower,
                upper,
                len(mine),
                said["published"],
                said["candidate"],
                said["with_input"],
                round(draws / len(mine), 4),
                wilson(draws, len(mine)),
            )
        )
    return out


def draw_band_error(bands: Sequence[DrawBand]) -> dict[str, float | None]:
    """Per forecaster, |said - seen| over the bands, weighted by their matches."""
    filled = [b for b in bands if b.matches and b.seen is not None]
    total = sum(b.matches for b in filled)
    out: dict[str, float | None] = {}
    for k in FORECASTERS:
        gaps = [(b.matches, getattr(b, f"said_{k}"), b.seen) for b in filled]
        out[k] = (
            None
            if total == 0
            else round(sum(n * abs(said - seen) for n, said, seen in gaps) / total, 4)
        )
    return out


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
    body = _term_body(name, description, candidate, window, overall, groups, runs, note, bar)
    calibrated = [r for r in runs if r.calibration is not None]
    if not calibrated:
        return body
    # A recalibration (T-1657): the draw's reliability, and what each division fitted.
    body["calibrations"] = {
        r.division: _calibration_entry(r.calibration) for r in calibrated if r.calibration
    }
    reliability: dict[str, object] = {}
    for group in GROUPS:
        applied = [s for r in runs if r.group == group for s in r.scores if s.applied]
        if applied:
            bands = draw_reliability(applied)
            reliability[group] = {
                "bands": [asdict(b) for b in bands],
                "error": draw_band_error(bands),
            }
    body["draw_reliability"] = {"bands": list(DRAW_BANDS), "groups": reliability}
    return body


def _calibration_entry(record: CalibrationRecord) -> dict[str, object]:
    start = record.history_from
    return {**asdict(record), "history_from": None if start is None else start.isoformat()}


def _term_body(
    name: str,
    description: str,
    candidate: ModelVersion,
    window: tuple[date, date],
    overall: Verdict,
    groups: Sequence[GroupVerdict],
    runs: Sequence[DivisionRun],
    note: str,
    bar: Bar,
) -> dict[str, object]:
    return {
        "input": name,
        "description": description,
        "published": PUBLISHED.id,
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
    return "\n".join(lines + _calibration_lines(body)) + "\n"


def _percent(value: object) -> str:
    return "" if not isinstance(value, float | int) else f"{value:.1%}"


def _calibration_lines(body: Mapping[str, object]) -> list[str]:
    """A recalibration's sections (T-1657); none for a term input."""
    reliability = body.get("draw_reliability")
    calibrations = body.get("calibrations")
    if not isinstance(reliability, dict) or not isinstance(calibrations, dict):
        return []
    lines = [
        "",
        "## The draw by the gap between the sides",
        "",
        "The draw said against seen on the applied matches, in bands of the candidate's gap "
        "|p_home - p_away| (T-1657), the seen rate with its 95% Wilson interval.",
        "",
        "| Group | Gap | Matches | Draw said: published | candidate | with input "
        "| Seen [interval] |",
        "|---|---|---|---|---|---|---|",
    ]
    for group, entry in reliability["groups"].items():
        for b in entry["bands"]:
            band = (
                f"{b['lower']:.2f} and over"
                if b["upper"] is None
                else f"{b['lower']:.2f}–{b['upper']:.2f}"
            )
            seen = _percent(b["seen"])
            if b["seen_interval"] is not None:
                lo, hi = b["seen_interval"]
                seen += f" [{lo:.1%}, {hi:.1%}]"
            lines.append(
                f"| {group} | {band} | {b['matches']} "
                f"| {_percent(b['said_published'])} | {_percent(b['said_candidate'])} "
                f"| {_percent(b['said_with_input'])} | {seen} |"
            )
    for group, entry in reliability["groups"].items():
        e = entry["error"]
        lines.append(
            f"\n- {group}: |said - seen| over the bands, weighted by their matches: published "
            f"{_percent(e['published'])}, candidate {_percent(e['candidate'])}, with input "
            f"{_percent(e['with_input'])}."
        )
    lines += [
        "",
        "| Division | History from | Forecasts before the window | Refits calibrated "
        "| Last calibration |",
        "|---|---|---|---|---|",
    ]
    for division, c in calibrations.items():
        last = ", ".join(f"{k} {v:.4g}" for k, v in c["last"].items())
        lines.append(
            f"| {division} | {c['history_from'] or 'the window'} | {c['before_window']} "
            f"| {c['calibrated_refits']} of {c['refits']} | {last} |"
        )
    return lines


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
    parser.add_argument(
        "--calibration-from",
        type=date.fromisoformat,
        help="a recalibration's out-of-sample history starts here (T-1657); "
        "default: a year after --history-from",
    )
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    candidate = (
        load_candidates().get(args.candidate) if args.candidate else load_candidate() or PUBLISHED
    )
    if candidate is None:
        print(f"no candidate {args.candidate} to add an input to", file=sys.stderr)
        return 2
    window = (args.window_from, args.window_to)
    history_from = args.history_from or args.window_from - timedelta(days=730)
    calibration_from = args.calibration_from or history_from + timedelta(days=365)
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
                published_elo=prior_for(PUBLISHED, clubelo_on, own_on),
                candidate_elo=prior_for(candidate, clubelo_on, own_on),
                calibration_from=calibration_from,
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
