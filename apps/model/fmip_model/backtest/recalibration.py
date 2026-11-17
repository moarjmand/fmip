"""D-450's fitter (T-1876): the temperature and draw term, fitted once on the live record.

    python -m fmip_model.backtest.recalibration --export window.csv

reads the development window exported read-only from production by
``recalibration_export.sql`` (each finished match kicked off 2026-10-10 to
2026-11-17 UTC once, by its last pre-kick-off forecast: ``dixon-coles-elo@0.7.0``'s
where it made one, else ``0.6.0``'s published), and:

1. **The screen** (D-450, inside the window, before any shadow): fit on the
   first two thirds by kick-off, apply at half strength, score the last third
   against the stored forecasts; and fit on the whole window. It passes only
   when the screened log loss is lower than the stored forecasts' (a point
   estimate) **and** the whole window's fit has ``T̂ > 1`` and ``β̂_draw < 0``.
2. **Passed:** the whole window's pair, halved (``calibration.HALF``), is
   frozen into ``candidates/dixon-coles-elo-0.9.0.json``: the published 0.7.0's
   constants unchanged plus the ``calibration`` block. **Failed:** no version
   file is written (D-450: "a failed screen means no candidate").

Either way the report (``reports/dixon-coles-elo-0.9.0/recalibration_<window>.{md,json}``)
lists every match it read by fixture and forecast id. The fit is
deterministic: Newton's method on a concave log-likelihood from ``(1, 0)``,
rows in kick-off order, no randomness. Nothing here reads a database.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from ..model.calibration import HALF, KIND, at_strength, temperature_draw
from ..model.version import CANDIDATES_DIR, PUBLISHED_DIR

#: D-450's development window: kick-off days, UTC, both ends included.
WINDOW_FROM = date(2026, 10, 10)
WINDOW_TO = date(2026, 11, 17)
#: The version the map is applied to, and the one it freezes into.
BASE_FILE = PUBLISHED_DIR / "dixon-coles-elo-0.7.0.json"
TARGET_VERSION = "0.9.0"
#: Versions whose forecasts the window may hold (D-450: 0.7.0's, else 0.6.0's published).
WINDOW_VERSIONS = frozenset({"dixon-coles-elo@0.7.0", "dixon-coles-elo@0.6.0"})
OUTCOMES = ("home", "draw", "away")
#: The rounding of the frozen constants: fitted to 6 decimals, applied to 8.
FITTED_DIGITS = 6
APPLIED_DIGITS = 8
REPORTS_DIR = Path(__file__).resolve().parents[2] / "reports"


@dataclass(frozen=True)
class Row:
    """One match of the window, by its last pre-kick-off forecast."""

    fixture_id: str
    kickoff_at: datetime
    competition_id: str
    model_id: str
    role: str
    forecast_id: str
    p: tuple[float, float, float]
    #: 0 home, 1 draw, 2 away.
    outcome: int


@dataclass(frozen=True)
class Fit:
    temperature: float
    beta_draw: float
    matches: int
    iterations: int
    mean_log_loss: float


@dataclass(frozen=True)
class Screen:
    fit_matches: int
    scored_matches: int
    #: The pair fitted on the first two thirds, and at half strength.
    fitted: Fit
    applied: tuple[float, float]
    base_log_loss: float
    screened_log_loss: float
    #: The pair fitted on the whole window.
    whole: Fit

    @property
    def lower_log_loss(self) -> bool:
        return self.screened_log_loss < self.base_log_loss

    @property
    def directions(self) -> bool:
        return self.whole.temperature > 1.0 and self.whole.beta_draw < 0.0

    @property
    def passed(self) -> bool:
        return self.lower_log_loss and self.directions


def read_window(
    path: Path, window_from: date = WINDOW_FROM, window_to: date = WINDOW_TO
) -> list[Row]:
    """The export's rows in kick-off order (then fixture id), checked.

    Refuses a kick-off outside the window (D-450: the fitter "refuses any
    kick-off after 2026-11-17"), a fixture twice, a version the window may not
    hold, an unknown outcome, and probabilities that are not positive or do
    not total 1 to the stored rounding.
    """
    rows: list[Row] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8", newline="") as handle:
        for record in csv.DictReader(handle):
            kickoff = datetime.fromisoformat(record["kickoff_at"]).astimezone(UTC)
            day = kickoff.date()
            if not window_from <= day <= window_to:
                raise ValueError(
                    f"{record['fixture_id']} kicked off {kickoff.isoformat()}, outside "
                    f"{window_from}..{window_to}"
                )
            if record["fixture_id"] in seen:
                raise ValueError(f"{record['fixture_id']} is in the export twice")
            seen.add(record["fixture_id"])
            if record["model_id"] not in WINDOW_VERSIONS:
                raise ValueError(f"{record['fixture_id']}: {record['model_id']} is not 0.7.0/0.6.0")
            if record["outcome"] not in OUTCOMES:
                raise ValueError(f"{record['fixture_id']}: outcome {record['outcome']!r}")
            p = (float(record["p_home"]), float(record["p_draw"]), float(record["p_away"]))
            if min(p) <= 0 or abs(sum(p) - 1.0) > 1e-3:
                raise ValueError(f"{record['fixture_id']}: probabilities {p}")
            rows.append(
                Row(
                    fixture_id=record["fixture_id"],
                    kickoff_at=kickoff,
                    competition_id=record["competition_id"],
                    model_id=record["model_id"],
                    role=record["role"],
                    forecast_id=record["forecast_id"],
                    p=p,
                    outcome=OUTCOMES.index(record["outcome"]),
                )
            )
    rows.sort(key=lambda r: (r.kickoff_at, r.fixture_id))
    return rows


def _design(rows: Sequence[Row]) -> tuple[NDArray[np.float64], NDArray[np.int64]]:
    """Per match, per outcome, the two features: ``log p_k`` and "is the draw"."""
    logp = np.log(np.array([r.p for r in rows], dtype=np.float64))
    features = np.zeros((len(rows), 3, 2), dtype=np.float64)
    features[:, :, 0] = logp
    features[:, 1, 1] = 1.0
    return features, np.array([r.outcome for r in rows], dtype=np.int64)


def _log_likelihood(
    features: NDArray[np.float64], outcomes: NDArray[np.int64], theta: NDArray[np.float64]
) -> tuple[float, NDArray[np.float64], NDArray[np.float64]]:
    scores = features @ theta
    scores -= scores.max(axis=1, keepdims=True)
    log_q = scores - np.log(np.exp(scores).sum(axis=1, keepdims=True))
    q = np.exp(log_q)
    n = len(outcomes)
    picked = features[np.arange(n), outcomes]
    expected = np.einsum("nk,nkf->nf", q, features)
    gradient = (picked - expected).sum(axis=0)
    centred = features - expected[:, None, :]
    hessian = -np.einsum("nk,nkf,nkg->fg", q, centred, centred)
    return float(log_q[np.arange(n), outcomes].sum()), gradient, hessian


def fit_temperature_draw(rows: Sequence[Row], max_iterations: int = 100) -> Fit:
    """The maximum-likelihood ``(T, β_draw)`` of ``p_k' ∝ p_k**T · exp(β_k)``.

    A multinomial logit linear in the two parameters with ``log p_k`` as the
    feature, so the log-likelihood is concave; Newton's method from the
    identity ``(1, 0)``, each step halved until it does not lower the
    likelihood, to a step below 1e-12.
    """
    if len(rows) < 10:
        raise ValueError(f"too few matches to fit: {len(rows)}")
    features, outcomes = _design(rows)
    theta = np.array([1.0, 0.0])
    value, gradient, hessian = _log_likelihood(features, outcomes, theta)
    iterations = 0
    while True:
        iterations += 1
        if iterations > max_iterations:  # pragma: no cover - a concave fit converges fast
            raise RuntimeError("Newton's method did not converge")
        step = np.linalg.solve(hessian, -gradient)
        scale = 1.0
        while True:
            candidate = theta + scale * step
            new_value, new_gradient, new_hessian = _log_likelihood(features, outcomes, candidate)
            if new_value >= value - 1e-12 or scale < 1e-6:
                break
            scale /= 2
        theta, value, gradient, hessian = candidate, new_value, new_gradient, new_hessian
        if float(np.abs(scale * step).max()) < 1e-12:
            break
    return Fit(
        temperature=float(theta[0]),
        beta_draw=float(theta[1]),
        matches=len(rows),
        iterations=iterations,
        mean_log_loss=-value / len(rows),
    )


def mean_log_loss(rows: Sequence[Row], temperature: float = 1.0, beta_draw: float = 0.0) -> float:
    """Mean log loss of the rows' forecasts, mapped by ``(T, β_draw)`` (identity by default)."""
    total = 0.0
    for row in rows:
        mapped = temperature_draw(row.p, temperature, beta_draw)
        total -= math.log(mapped[row.outcome])
    return total / len(rows)


def screen(rows: Sequence[Row], strength: float = HALF) -> Screen:
    """D-450's screen: fit the first two thirds by kick-off, score the last third at strength."""
    cut = (2 * len(rows)) // 3
    first, last = rows[:cut], rows[cut:]
    fitted = fit_temperature_draw(first)
    applied = at_strength(fitted.temperature, fitted.beta_draw, strength)
    return Screen(
        fit_matches=len(first),
        scored_matches=len(last),
        fitted=fitted,
        applied=applied,
        base_log_loss=mean_log_loss(last),
        screened_log_loss=mean_log_loss(last, *applied),
        whole=fit_temperature_draw(rows),
    )


def frozen_pair(whole: Fit, strength: float = HALF) -> dict[str, float]:
    """The constants the version file stores: the fitted pair rounded, then at strength."""
    fitted_t = round(whole.temperature, FITTED_DIGITS)
    fitted_b = round(whole.beta_draw, FITTED_DIGITS)
    applied_t, applied_b = at_strength(fitted_t, fitted_b, strength)
    return {
        "fitted_temperature": fitted_t,
        "fitted_beta_draw": fitted_b,
        "temperature": round(applied_t, APPLIED_DIGITS),
        "beta_draw": round(applied_b, APPLIED_DIGITS),
    }


def _summary(rows: Sequence[Row], temperature: float, beta_draw: float) -> dict[str, float]:
    """Said and seen on the rows, in percent: the draw and the favourite (descriptive only)."""
    draw_said = fav_said = fav_seen = 0.0
    for row in rows:
        mapped = temperature_draw(row.p, temperature, beta_draw)
        draw_said += mapped[1]
        favourite = max((0, 2), key=lambda k: mapped[k])
        fav_said += mapped[favourite]
        fav_seen += float(row.outcome == favourite)
    n = len(rows)
    return {
        "log_loss": round(mean_log_loss(rows, temperature, beta_draw), 5),
        "draw_said": round(100 * draw_said / n, 2),
        "draw_seen": round(100 * sum(r.outcome == 1 for r in rows) / n, 2),
        "favourite_said": round(100 * fav_said / n, 2),
        "favourite_seen": round(100 * fav_seen / n, 2),
    }


def _fit_dict(fit: Fit) -> dict[str, object]:
    return {
        "temperature": round(fit.temperature, FITTED_DIGITS),
        "beta_draw": round(fit.beta_draw, FITTED_DIGITS),
        "matches": fit.matches,
        "iterations": fit.iterations,
        "mean_log_loss": round(fit.mean_log_loss, 5),
    }


def screen_dict(result: Screen) -> dict[str, object]:
    return {
        "rule": (
            "fit on the first two thirds by kick-off, apply at half strength, score the last "
            "third; pass when its log loss is below the stored forecasts' and the whole "
            "window's fit has temperature > 1 and beta_draw < 0 (D-450)"
        ),
        "fit_matches": result.fit_matches,
        "scored_matches": result.scored_matches,
        "fitted_on_first_two_thirds": _fit_dict(result.fitted),
        "applied_at_half": [
            round(result.applied[0], APPLIED_DIGITS),
            round(result.applied[1], APPLIED_DIGITS),
        ],
        "base_log_loss": round(result.base_log_loss, 5),
        "screened_log_loss": round(result.screened_log_loss, 5),
        "difference": round(result.screened_log_loss - result.base_log_loss, 5),
        "whole_window_fit": _fit_dict(result.whole),
        "lower_log_loss": result.lower_log_loss,
        "directions": result.directions,
        "passed": result.passed,
    }


def calibration_block(rows: Sequence[Row], result: Screen) -> dict[str, object]:
    """The version file's ``calibration`` block (read back by ``read_calibration``)."""
    pair = frozen_pair(result.whole)
    return {
        "kind": KIND,
        "temperature": pair["temperature"],
        "beta_draw": pair["beta_draw"],
        "strength": HALF,
        "fitted": {
            "temperature": pair["fitted_temperature"],
            "beta_draw": pair["fitted_beta_draw"],
        },
        "window": {
            "from": WINDOW_FROM.isoformat(),
            "to": WINDOW_TO.isoformat(),
            "matches": len(rows),
            "first_kickoff": rows[0].kickoff_at.isoformat().replace("+00:00", "Z"),
            "last_kickoff": rows[-1].kickoff_at.isoformat().replace("+00:00", "Z"),
        },
        "screen": {
            "passed": result.passed,
            "fit_matches": result.fit_matches,
            "scored_matches": result.scored_matches,
            "base_log_loss": round(result.base_log_loss, 5),
            "screened_log_loss": round(result.screened_log_loss, 5),
        },
        "decision": "D-450",
    }


def version_body(base: dict[str, object], block: dict[str, object]) -> dict[str, object]:
    """0.9.0's file: the base's every constant, a new version and source, and the block."""
    body: dict[str, object] = {}
    for key, value in base.items():
        body[key] = value
        if key == "version":
            body[key] = TARGET_VERSION
    body["source"] = (
        "T-1876, D-450: dixon-coles-elo@0.7.0 (every constant, division and the cross-league "
        "fit unchanged) with its three probabilities recalibrated after the score table by a "
        "temperature and a draw term, p_k' proportional to p_k^T exp(beta_k) with beta_home = "
        "beta_away = 0, fitted once by maximum likelihood on the live record's matches kicked "
        "off 2026-10-10..2026-11-17 (each by its last pre-kick-off forecast, 0.7.0's else "
        "0.6.0's published) and applied at half strength. Shadow only; judged once at 1,000 "
        "paired matches kicked off from 2026-11-18 by D-139's bar (D-450)."
    )
    body["calibration"] = block
    return body


def report_body(rows: Sequence[Row], result: Screen) -> dict[str, object]:
    pair = frozen_pair(result.whole)
    by_version: dict[str, int] = {}
    for row in rows:
        by_version[row.model_id] = by_version.get(row.model_id, 0) + 1
    return {
        "decision": "D-450",
        "task": "T-1876",
        "window": {"from": WINDOW_FROM.isoformat(), "to": WINDOW_TO.isoformat()},
        "matches": len(rows),
        "by_version": dict(sorted(by_version.items())),
        "screen": screen_dict(result),
        "frozen": pair if result.passed else None,
        "in_sample": {
            "stored": _summary(rows, 1.0, 0.0),
            "half_strength": _summary(rows, pair["temperature"], pair["beta_draw"]),
            "note": "in-sample, descriptive only: the verdict is the forward window's (D-450)",
        },
        "rows": [
            {
                "fixture_id": r.fixture_id,
                "forecast_id": r.forecast_id,
                "model_id": r.model_id,
                "kickoff_at": r.kickoff_at.isoformat().replace("+00:00", "Z"),
            }
            for r in rows
        ],
    }


def render(body: dict[str, object]) -> str:
    s = body["screen"]
    assert isinstance(s, dict)
    first = s["fitted_on_first_two_thirds"]
    whole = s["whole_window_fit"]
    assert isinstance(first, dict) and isinstance(whole, dict)
    in_sample = body["in_sample"]
    assert isinstance(in_sample, dict)
    lines = [
        f"# D-450 recalibration fit ({body['task']})",
        "",
        f"Window: matches kicked off {WINDOW_FROM}..{WINDOW_TO} UTC, each once by its last "
        f"pre-kick-off forecast: {body['matches']} matches ({body['by_version']}).",
        "",
        "## Screen",
        "",
        f"- Fit on the first {s['fit_matches']} by kick-off: T = {first['temperature']}, "
        f"beta_draw = {first['beta_draw']}; at half strength T = {s['applied_at_half'][0]}, "
        f"beta_draw = {s['applied_at_half'][1]}.",
        f"- Last {s['scored_matches']}: stored log loss {s['base_log_loss']}, mapped "
        f"{s['screened_log_loss']} (difference {s['difference']}).",
        f"- Whole window: T-hat = {whole['temperature']}, beta-hat_draw = {whole['beta_draw']} "
        f"({whole['iterations']} Newton steps).",
        f"- Lower log loss: {s['lower_log_loss']}; directions (T-hat > 1, beta-hat < 0): "
        f"{s['directions']}. **Screen {'passed' if s['passed'] else 'FAILED'}.**",
        "",
    ]
    frozen = body["frozen"]
    if isinstance(frozen, dict):
        lines += [
            "## Frozen (half strength)",
            "",
            f"- Fitted: T-hat = {frozen['fitted_temperature']}, "
            f"beta-hat_draw = {frozen['fitted_beta_draw']}.",
            f"- Applied: T* = {frozen['temperature']}, beta*_draw = {frozen['beta_draw']}.",
            "",
        ]
    else:
        lines += ["No version is written: a failed screen means no candidate (D-450).", ""]
    lines += [
        "## In sample (descriptive only)",
        "",
        "| | Log loss | Draw said | Draw seen | Favourite said | Favourite seen |",
        "|---|---|---|---|---|---|",
    ]
    for label in ("stored", "half_strength"):
        row = in_sample[label]
        assert isinstance(row, dict)
        lines.append(
            f"| {label} | {row['log_loss']} | {row['draw_said']} | {row['draw_seen']} | "
            f"{row['favourite_said']} | {row['favourite_seen']} |"
        )
    lines += ["", "Every match read is listed by fixture and forecast id in the JSON report."]
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m fmip_model.backtest.recalibration")
    parser.add_argument("--export", type=Path, required=True, help="recalibration_export.sql's CSV")
    parser.add_argument("--base", type=Path, default=BASE_FILE)
    parser.add_argument(
        "--out", type=Path, default=CANDIDATES_DIR / f"dixon-coles-elo-{TARGET_VERSION}.json"
    )
    parser.add_argument(
        "--reports", type=Path, default=REPORTS_DIR / f"dixon-coles-elo-{TARGET_VERSION}"
    )
    args = parser.parse_args(argv)

    rows = read_window(args.export)
    result = screen(rows)
    body = report_body(rows, result)
    args.reports.mkdir(parents=True, exist_ok=True)
    stem = f"recalibration_{WINDOW_FROM}..{WINDOW_TO}"
    (args.reports / f"{stem}.json").write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    (args.reports / f"{stem}.md").write_text(render(body), encoding="utf-8")
    print(render(body))
    if not result.passed:
        return 1
    base = json.loads(args.base.read_text(encoding="utf-8"))
    version = version_body(base, calibration_block(rows, result))
    args.out.write_text(json.dumps(version, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
