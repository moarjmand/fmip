"""A version's recalibration of its three probabilities (D-450, T-1876).

The map acts on the probabilities after the Dixon-Coles table; expected goals
and every other input stay as they are. ``temperature_draw`` is D-450's
option 2::

    p_k' ∝ p_k ** T · exp(β_k),   β_home = β_away = 0,   β_draw free

``T > 1`` sharpens (the favourite up, the underdog and the draw down);
``β_draw < 0`` lowers the draw on its own. ``T = 1`` and ``β_draw = 0`` is the
identity.

The constants are frozen in the version file at a fixed strength: the fitted
``(T̂, β̂_draw)`` are moved toward the identity in parameter space,
``T* = 1 + (T̂ - 1)·s`` and ``β* = β̂·s`` with ``s = 1/2`` (D-450: "half,
fixed now"). The file names both the fitted and the applied pair, and loading
refuses a file whose applied pair is not the fitted one at that strength, so
the halving cannot drift from the fit.

A refit is a new version (D-450: "the map is frozen").
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

import numpy as np
from numpy.typing import NDArray

#: The only kind a version may carry (D-450 chose option 2).
KIND = "temperature_draw"
#: D-450's strength, decided before any fit and never tuned.
HALF = 0.5
#: The strength each decision fixed before its fit (D-450: half). A block must
#: name one of these decisions and carry exactly its strength, so a file cannot
#: drift to another strength without a decision that says so.
FIXED_STRENGTH: Mapping[str, float] = {"D-450": HALF}
#: How closely the applied pair must equal the fitted one at the strength: the
#: file stores both rounded, so equality is to the rounding, not exact.
TOLERANCE = 1e-7


@dataclass(frozen=True)
class Calibration:
    """The frozen map of one version, as its file's ``calibration`` block names it."""

    temperature: float
    beta_draw: float
    #: The maximum-likelihood pair on the development window, before the strength.
    fitted_temperature: float
    fitted_beta_draw: float
    strength: float
    #: The development window: kick-off days, UTC, both ends included.
    window_from: date
    window_to: date
    matches: int
    decision: str
    kind: str = KIND

    def apply(self, p: tuple[float, float, float]) -> tuple[float, float, float]:
        """(home, draw, away) mapped; each must be positive, and the three sum to 1."""
        return temperature_draw(p, self.temperature, self.beta_draw)

    def rescale(self, matrix: NDArray[np.float64]) -> NDArray[np.float64]:
        """The score table with each outcome's cells scaled by ``p_k' / p_k``.

        Home wins below the diagonal, draws on it, away wins above, as
        ``outcome_from_matrix`` reads them: the table then totals 1 and its
        three sums are the mapped probabilities, so the most likely scores
        shown stay consistent with the three figures.
        """
        home_mask = np.tril(np.ones_like(matrix, dtype=bool), -1)
        draw_mask = np.eye(matrix.shape[0], dtype=bool)
        away_mask = np.triu(np.ones_like(matrix, dtype=bool), 1)
        base = (
            float(matrix[home_mask].sum()),
            float(matrix[draw_mask].sum()),
            float(matrix[away_mask].sum()),
        )
        mapped = self.apply(base)
        out = matrix.copy()
        for mask, before, after in zip(
            (home_mask, draw_mask, away_mask), base, mapped, strict=True
        ):
            out[mask] = matrix[mask] * (after / before)
        return out

    def as_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "temperature": self.temperature,
            "beta_draw": self.beta_draw,
            "strength": self.strength,
            "fitted": {
                "temperature": self.fitted_temperature,
                "beta_draw": self.fitted_beta_draw,
            },
            "window": {
                "from": self.window_from.isoformat(),
                "to": self.window_to.isoformat(),
                "matches": self.matches,
            },
            "decision": self.decision,
        }


def temperature_draw(
    p: tuple[float, float, float], temperature: float, beta_draw: float
) -> tuple[float, float, float]:
    """``p_k' ∝ p_k ** T · exp(β_k)`` with only the draw's ``β``, normalised to 1.

    Computed in log space with the largest score subtracted, so it neither
    overflows nor gives exactly 0 or 1 for any positive input.
    """
    if temperature <= 0:
        raise ValueError("the temperature must be positive")
    if any(not (x > 0) for x in p):
        raise ValueError(f"every probability must be positive, not {p}")
    scores = (
        temperature * math.log(p[0]),
        temperature * math.log(p[1]) + beta_draw,
        temperature * math.log(p[2]),
    )
    top = max(scores)
    weights = [math.exp(s - top) for s in scores]
    total = sum(weights)
    return weights[0] / total, weights[1] / total, weights[2] / total


def at_strength(
    fitted_temperature: float, fitted_beta_draw: float, strength: float
) -> tuple[float, float]:
    """The applied pair: the fitted one moved toward the identity, ``1 + (T̂-1)·s`` and ``β̂·s``."""
    if not 0 < strength <= 1:
        raise ValueError("the strength is a share of the fitted map: in (0, 1]")
    return 1.0 + (fitted_temperature - 1.0) * strength, fitted_beta_draw * strength


def read_calibration(block: Mapping[str, object]) -> Calibration:
    """A version file's ``calibration`` block, checked."""
    kind = str(block.get("kind", ""))
    if kind != KIND:
        raise ValueError(f"calibration.kind must be {KIND!r}, not {kind!r}")
    fitted = block.get("fitted")
    window = block.get("window")
    if not isinstance(fitted, Mapping) or not isinstance(window, Mapping):
        raise ValueError("calibration must name its fitted pair and its window")
    try:
        calibration = Calibration(
            temperature=float(str(block["temperature"])),
            beta_draw=float(str(block["beta_draw"])),
            fitted_temperature=float(str(fitted["temperature"])),
            fitted_beta_draw=float(str(fitted["beta_draw"])),
            strength=float(str(block["strength"])),
            window_from=date.fromisoformat(str(window["from"])),
            window_to=date.fromisoformat(str(window["to"])),
            matches=int(str(window["matches"])),
            decision=str(block.get("decision", "")),
        )
    except KeyError as error:  # a version file's problems are ValueErrors, as the loader's
        raise ValueError(f"calibration lacks {error.args[0]!r}") from error
    fixed = FIXED_STRENGTH.get(calibration.decision)
    if fixed is None:
        raise ValueError(
            f"calibration.decision must be one that fixed a strength {sorted(FIXED_STRENGTH)}, "
            f"not {calibration.decision!r}"
        )
    if calibration.strength != fixed:
        raise ValueError(
            f"calibration.strength is fixed at {fixed} by {calibration.decision}, "
            f"not {calibration.strength}"
        )
    if calibration.temperature <= 0 or calibration.fitted_temperature <= 0:
        raise ValueError("calibration temperatures must be positive")
    if calibration.window_to < calibration.window_from or calibration.matches <= 0:
        raise ValueError("calibration.window must be a non-empty span")
    expected = at_strength(
        calibration.fitted_temperature, calibration.fitted_beta_draw, calibration.strength
    )
    if (
        abs(expected[0] - calibration.temperature) > TOLERANCE
        or abs(expected[1] - calibration.beta_draw) > TOLERANCE
    ):
        raise ValueError(
            "calibration's temperature and beta_draw must be the fitted pair at its strength: "
            f"{expected}, not {(calibration.temperature, calibration.beta_draw)}"
        )
    return calibration
