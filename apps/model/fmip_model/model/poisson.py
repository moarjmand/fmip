"""From expected goals to a scoreline matrix and the outcome probabilities."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

MAX_GOALS = 10


def dixon_coles_tau(x: int, y: int, lam: float, mu: float, rho: float) -> float:
    """The Dixon-Coles correction for the four low scores; 1 elsewhere."""
    if x == 0 and y == 0:
        return 1.0 - lam * mu * rho
    if x == 0 and y == 1:
        return 1.0 + lam * rho
    if x == 1 and y == 0:
        return 1.0 + mu * rho
    if x == 1 and y == 1:
        return 1.0 - rho
    return 1.0


def score_matrix(
    lam: float, mu: float, rho: float = 0.0, max_goals: int = MAX_GOALS
) -> NDArray[np.float64]:
    """P(home = i, away = j) for i, j in 0..max_goals, normalised to sum to 1.

    ``lam`` and ``mu`` are the expected home and away goals. Truncating at
    ``max_goals`` and renormalising keeps the matrix a probability distribution;
    the mass beyond ten goals is negligible at football rates.
    """
    if lam <= 0 or mu <= 0:
        raise ValueError("expected goals must be positive")

    home = np.array([math.exp(-lam) * lam**i / math.factorial(i) for i in range(max_goals + 1)])
    away = np.array([math.exp(-mu) * mu**j / math.factorial(j) for j in range(max_goals + 1)])
    matrix = np.outer(home, away)

    for x in range(2):
        for y in range(2):
            matrix[x, y] *= dixon_coles_tau(x, y, lam, mu, rho)

    matrix = np.clip(matrix, 0.0, None)
    total = float(matrix.sum())
    if total <= 0:
        raise ValueError("degenerate score matrix")
    return matrix / total


@dataclass(frozen=True)
class Scoreline:
    home: int
    away: int
    probability: float


@dataclass(frozen=True)
class Outcome:
    """Everything blueprint 6.2 asks a forecast to carry, read off one matrix."""

    home_win: float
    draw: float
    away_win: float
    expected_home_goals: float
    expected_away_goals: float
    most_likely: tuple[Scoreline, ...]

    def rounded(self, digits: int = 3) -> tuple[float, float, float]:
        """Three probabilities that sum to exactly 1 after rounding.

        Rounding each independently can total 0.999 or 1.001; the largest
        probability absorbs the difference, which is the convention that
        changes the displayed figures least.
        """
        values = [
            round(self.home_win, digits),
            round(self.draw, digits),
            round(self.away_win, digits),
        ]
        gap = round(1.0 - sum(values), digits)
        largest = max(range(3), key=lambda i: values[i])
        values[largest] = round(values[largest] + gap, digits)
        return values[0], values[1], values[2]


def outcome_from_matrix(matrix: NDArray[np.float64], top: int = 5) -> Outcome:
    n = matrix.shape[0]
    goals = np.arange(n, dtype=np.float64)

    home_win = float(np.tril(matrix, -1).sum())
    draw = float(np.trace(matrix))
    away_win = float(np.triu(matrix, 1).sum())

    flat = [(int(i), int(j), float(matrix[i, j])) for i in range(n) for j in range(n)]
    flat.sort(key=lambda t: t[2], reverse=True)

    return Outcome(
        home_win=home_win,
        draw=draw,
        away_win=away_win,
        expected_home_goals=float((matrix.sum(axis=1) * goals).sum()),
        expected_away_goals=float((matrix.sum(axis=0) * goals).sum()),
        most_likely=tuple(Scoreline(h, a, p) for h, a, p in flat[:top]),
    )
