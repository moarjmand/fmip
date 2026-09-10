"""Proper scoring rules and calibration for three-way forecasts."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

Result = Literal["H", "D", "A"]
RESULTS: tuple[Result, Result, Result] = ("H", "D", "A")


@dataclass(frozen=True)
class Forecast:
    """Probabilities for home win, draw, away win; must sum to one."""

    home: float
    draw: float
    away: float

    def __post_init__(self) -> None:
        total = self.home + self.draw + self.away
        if not math.isclose(total, 1.0, abs_tol=1e-6):
            raise ValueError(f"probabilities sum to {total}, not 1")
        if min(self.home, self.draw, self.away) < 0:
            raise ValueError("a probability is negative")

    def of(self, result: Result) -> float:
        return {"H": self.home, "D": self.draw, "A": self.away}[result]

    def as_tuple(self) -> tuple[float, float, float]:
        return self.home, self.draw, self.away


UNIFORM = Forecast(1 / 3, 1 / 3, 1 / 3)


def log_loss(forecasts: Sequence[Forecast], results: Sequence[Result]) -> float:
    """Mean negative log probability of what happened. Lower is better; uniform is ln 3 ≈ 1.0986."""
    if len(forecasts) != len(results) or not forecasts:
        raise ValueError("need the same non-zero number of forecasts and results")
    return -sum(
        math.log(max(f.of(r), 1e-12)) for f, r in zip(forecasts, results, strict=True)
    ) / len(forecasts)


def brier(forecasts: Sequence[Forecast], results: Sequence[Result]) -> float:
    """Mean squared error over the three outcome indicators. Lower is better; uniform is 2/3."""
    if len(forecasts) != len(results) or not forecasts:
        raise ValueError("need the same non-zero number of forecasts and results")
    total = 0.0
    for f, r in zip(forecasts, results, strict=True):
        for outcome, p in zip(RESULTS, f.as_tuple(), strict=True):
            total += (p - (1.0 if outcome == r else 0.0)) ** 2
    return total / len(forecasts)


@dataclass(frozen=True)
class ReliabilityBin:
    lower: float
    upper: float
    count: int
    mean_forecast: float
    observed_frequency: float


def reliability(
    forecasts: Sequence[Forecast],
    results: Sequence[Result],
    outcome: Result,
    bins: int = 10,
) -> list[ReliabilityBin]:
    """The reliability curve for one outcome: forecast probability vs observed rate.

    Each forecast's probability of ``outcome`` falls into one of ``bins`` equal
    bins; a bin reports its mean forecast and how often the outcome actually
    happened. A calibrated forecaster's points lie on the diagonal. Empty bins
    are omitted rather than reported as zero.
    """
    if bins < 1:
        raise ValueError("bins must be positive")
    sums: list[list[float]] = [[0.0, 0.0, 0.0] for _ in range(bins)]  # n, sum p, sum hit
    for f, r in zip(forecasts, results, strict=True):
        p = f.of(outcome)
        index = min(int(p * bins), bins - 1)
        sums[index][0] += 1
        sums[index][1] += p
        sums[index][2] += 1.0 if r == outcome else 0.0

    out: list[ReliabilityBin] = []
    for i, (n, sp, sh) in enumerate(sums):
        if n == 0:
            continue
        out.append(ReliabilityBin(i / bins, (i + 1) / bins, int(n), sp / n, sh / n))
    return out


def expected_calibration_error(bins: Sequence[ReliabilityBin]) -> float:
    """Count-weighted mean gap between forecast and observed frequency across bins."""
    total = sum(b.count for b in bins)
    if total == 0:
        return 0.0
    return sum(b.count * abs(b.mean_forecast - b.observed_frequency) for b in bins) / total
