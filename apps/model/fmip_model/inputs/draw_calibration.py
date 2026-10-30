"""The draw recalibrated by the gap between the sides (T-1657, D-308).

The live record of the published version shows draws over-forecast where the
sides are 10 to 25 points apart (27% said, 19% seen) and 25 to 45 apart (25%,
20%), and calibrated where they are even or one is a big favourite. The
scoreline table cannot be told to say fewer draws there without moving goals,
so this input is the harness's second kind (``CalibrationInput``): it acts on
the three probabilities.

With ``g = |p_home - p_away|``, the forecast's own gap,

    w = p_draw * exp(a + b*g + c*g**2)
    (p_home', p_draw', p_away') = (p_home, w, p_away) / (p_home + w + p_away)

so the draw moves by the factor on its odds, ``logit(p_draw') = logit(p_draw) +
a + b*g + c*g**2``, and home and away share what is left in their own ratio. The
three outcomes' likelihood in ``(a, b, c)`` is therefore a logistic regression
of "drawn" with ``logit(p_draw)`` as its offset and ``(1, g, g**2)`` as its
features: which side won says nothing about ``(a, b, c)`` once the ratio is
kept.

At each refit, ``(a, b, c)`` is fitted by maximum likelihood on the division's
past forecasts the harness hands over (out of sample, every match counted
alike), with ``RIDGE * (a**2 + b**2 + c**2)`` pulling toward no change, by
Newton's method (the objective is concave in the parameters, so its maximum is
unique). Fewer than ``MIN_HISTORY`` past forecasts: no calibration (not read).

The constants were set before any run on the store (D-308), on synthetic
forecasts only.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

import numpy as np
from numpy.typing import NDArray

from . import InputContext, PastForecast, Probabilities

#: The ridge on ``(a, b, c)``, against the sum (not the mean) of the log-likelihood.
#: Chosen on synthetic forecasts only (D-308): of 0, 0.01, 0.1, 0.3 and 1, the one
#: whose error in the fitted draw is least worse than the best in both a world
#: shaped like the live record and a calibrated one, at 1,000 to 1,500 past
#: forecasts (a division's history). At 1, the live record's correction (which
#: needs ``|b|, |c|`` of 3 to 6) is mostly penalised away.
RIDGE = 0.1
#: Past forecasts a calibration needs.
MIN_HISTORY = 300
#: Newton's method stops when no parameter moves by more than this.
TOLERANCE = 1e-10
MAX_ITERATIONS = 100


def gap(p: Probabilities) -> float:
    """``|p_home - p_away|``: how far apart the forecast puts the sides."""
    return abs(p[0] - p[2])


@dataclass(frozen=True)
class DrawCalibration:
    a: float
    b: float
    c: float
    #: Past forecasts it was fitted on.
    samples: int

    @property
    def parameters(self) -> Mapping[str, float]:
        return {"a": self.a, "b": self.b, "c": self.c, "samples": float(self.samples)}

    def factor(self, g: float) -> float:
        """The factor on the draw's odds at gap ``g``."""
        return math.exp(self.a + self.b * g + self.c * g * g)

    def apply(self, p: Probabilities) -> Probabilities:
        home, draw, away = p
        w = draw * self.factor(gap(p))
        total = home + w + away
        return home / total, w / total, away / total


def _penalised(
    theta: NDArray[np.float64],
    offset: NDArray[np.float64],
    x: NDArray[np.float64],
    drawn: NDArray[np.float64],
    ridge: float,
) -> float:
    z = offset + x @ theta
    return float(np.sum(drawn * z - np.logaddexp(0.0, z)) - ridge * float(theta @ theta))


def fit_draw(
    probabilities: NDArray[np.float64], drawn: NDArray[np.float64], ridge: float = RIDGE
) -> NDArray[np.float64]:
    """``(a, b, c)`` by penalised maximum likelihood.

    ``probabilities`` is one row (home, draw, away) per past forecast and
    ``drawn`` is 1 where the match was drawn, 0 otherwise.
    """
    p_draw = np.clip(probabilities[:, 1], 1e-9, 1 - 1e-9)
    offset = np.log(p_draw) - np.log1p(-p_draw)
    g = np.abs(probabilities[:, 0] - probabilities[:, 2])
    x = np.stack([np.ones_like(g), g, g * g], axis=1)
    theta = np.zeros(3)
    current = _penalised(theta, offset, x, drawn, ridge)
    for _ in range(MAX_ITERATIONS):
        q = 1.0 / (1.0 + np.exp(-(offset + x @ theta)))
        gradient = x.T @ (drawn - q) - 2 * ridge * theta
        hessian = (x * (q * (1 - q))[:, None]).T @ x + 2 * ridge * np.eye(3)
        step = np.linalg.solve(hessian, gradient)
        t = 1.0
        while t > 1e-6:
            proposed = _penalised(theta + t * step, offset, x, drawn, ridge)
            if proposed >= current:
                break
            t /= 2
        theta = theta + t * step
        current = _penalised(theta, offset, x, drawn, ridge)
        if float(np.max(np.abs(t * step))) < TOLERANCE:
            break
    return theta


class DrawCalibrationInput:
    name = "draw_calibration"
    description = (
        "The draw's odds moved by exp(a + b*g + c*g^2), g = |p_home - p_away|, home and away "
        f"keeping their ratio; (a, b, c) fitted per refit on the division's out-of-sample "
        f"forecasts, ridge {RIDGE}, at least {MIN_HISTORY} of them (T-1657, D-308)."
    )

    def __init__(self, min_history: int = MIN_HISTORY, ridge: float = RIDGE) -> None:
        self.min_history = min_history
        self.ridge = ridge

    def calibrate(
        self, division: str, history: Sequence[PastForecast], fit_date: date
    ) -> DrawCalibration | None:
        rows = [h for h in history if h.match.date <= fit_date]
        if len(rows) < self.min_history:
            return None
        probabilities = np.array([h.probabilities for h in rows], dtype=np.float64)
        drawn = np.array([1.0 if h.result == "D" else 0.0 for h in rows])
        a, b, c = (float(v) for v in fit_draw(probabilities, drawn, self.ridge))
        return DrawCalibration(a, b, c, len(rows))


def build(context: InputContext) -> DrawCalibrationInput:
    return DrawCalibrationInput()
