"""Rendering a backtest as the report the decision gate reads."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from .metrics import ReliabilityBin
from .walk_forward import BacktestResult, Scorecard


def _table(bins: list[ReliabilityBin]) -> str:
    lines = ["| Forecast bin | n | Mean forecast | Observed |", "|---|---|---|---|"]
    for b in bins:
        cells = (
            f"{b.lower:.1f}–{b.upper:.1f}",
            b.count,
            f"{b.mean_forecast:.3f}",
            f"{b.observed_frequency:.3f}",
        )
        lines.append("| " + " | ".join(str(c) for c in cells) + " |")
    return "\n".join(lines)


def _scores(name: str, card: Scorecard | None) -> str:
    if card is None:
        return f"| {name} | — | — | — | — |"
    cells = (
        name,
        card.n,
        f"{card.log_loss:.4f}",
        f"{card.brier:.4f}",
        f"{card.calibration_error:.4f}",
    )
    return "| " + " | ".join(str(c) for c in cells) + " |"


# D-016: a model that cannot match the market's calibration is not ready to
# publish. Within this margin of the de-margined closing odds counts as matching.
PUBLISHABLE_LOG_LOSS_MARGIN = 0.02


def verdict(result: BacktestResult) -> str:
    if result.market is None:
        return "No market odds in this window; calibration is judged against uniform only."
    if result.model.log_loss <= result.market.log_loss + PUBLISHABLE_LOG_LOSS_MARGIN:
        return (
            f"Model log loss is **within {PUBLISHABLE_LOG_LOSS_MARGIN}** of the de-margined market."
        )
    return (
        f"Model log loss is **worse than the market** by more than {PUBLISHABLE_LOG_LOSS_MARGIN}; "
        "not ready to publish (D-016)."
    )


def render_markdown(result: BacktestResult, generated_at: datetime | None = None) -> str:
    generated_at = generated_at or datetime.now(UTC)
    return "\n".join(
        [
            f"# Backtest — {result.model_version.id} — {result.scope}",
            "",
            f"Generated {generated_at.isoformat(timespec='seconds')}. Window "
            f"{result.window_start.isoformat()} to {result.window_end.isoformat()}, "
            f"{len(result.forecasts)} forecasts, {result.refits} refits, "
            f"{result.matches_with_odds} matches with closing odds.",
            "",
            "Model constants: "
            + ", ".join(
                f"{k}={v}"
                for k, v in result.model_version.as_dict().items()
                if k not in ("id", "name", "version")
            )
            + ".",
            "",
            "## Scores (lower is better)",
            "",
            "| Forecaster | n | Log loss | Brier | Calibration error |",
            "|---|---|---|---|---|",
            _scores("Model", result.model),
            _scores("Market (de-margined closing odds)", result.market),
            _scores("Uniform 1/3", result.uniform),
            "",
            verdict(result),
            "",
            "## Reliability — home win",
            "",
            _table(result.model.reliability_home),
            "",
            "## Reliability — draw",
            "",
            _table(result.model.reliability_draw),
            "",
            "## Reliability — away win",
            "",
            _table(result.model.reliability_away),
            "",
        ]
    )


def as_json(result: BacktestResult, generated_at: datetime | None = None) -> str:
    generated_at = generated_at or datetime.now(UTC)
    payload = {
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "model_version": result.model_version.as_dict(),
        "scope": result.scope,
        "window": [result.window_start.isoformat(), result.window_end.isoformat()],
        "forecasts": len(result.forecasts),
        "refits": result.refits,
        "matches_with_odds": result.matches_with_odds,
        "model": _card(result.model),
        "market": _card(result.market) if result.market else None,
        "uniform": _card(result.uniform),
    }
    return json.dumps(payload, indent=2)


def _card(card: Scorecard) -> dict[str, object]:
    return {
        "n": card.n,
        "log_loss": round(card.log_loss, 6),
        "brier": round(card.brier, 6),
        "calibration_error": round(card.calibration_error, 6),
        "reliability": {
            "home": [asdict(b) for b in card.reliability_home],
            "draw": [asdict(b) for b in card.reliability_draw],
            "away": [asdict(b) for b in card.reliability_away],
        },
    }


def write_report(result: BacktestResult, directory: Path) -> tuple[Path, Path]:
    """``<dir>/<model id>/<scope>.md`` and ``.json``. Returns both paths."""
    target = directory / result.model_version.id.replace("@", "-")
    target.mkdir(parents=True, exist_ok=True)
    stem = result.scope.replace("/", "-").replace(" ", "_")
    generated_at = datetime.now(UTC)
    md = target / f"{stem}.md"
    js = target / f"{stem}.json"
    md.write_text(render_markdown(result, generated_at), encoding="utf-8")
    js.write_text(as_json(result, generated_at), encoding="utf-8")
    return md, js
